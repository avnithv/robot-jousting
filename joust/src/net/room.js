// The room client, shared by the big screen (the host) and the phones.
//
// Architecture: the big screen is the HOST and the only place the rules run. It publishes a view of the
// fight to server.py, which is a mailbox and a relay; the phones render that view and post their choices
// back. Nothing on the wire is authoritative except what the host publishes.
//
//   host:   const room = await createRoom();            // POST /api/mp/rooms  -> code, tokens, urls
//           room.publish(pub, { a, b });                 // rev++ , wakes both phones
//           room.onAct(act => ...); room.listen();       // long-poll the players' actions
//   phone:  const p = new PlayerClient(token);
//           p.onState((pub, priv, meta) => render(...));  p.listen();   p.act({ type: 'lock', chain });
//
// The published view (also the contract the phone client and the match integration share):
//
//   public = {
//     phase: 'lobby' | 'deck' | 'plan' | 'exchange' | 'result',
//     turn, beat,                       // beat = -1 before the first beat of the turn
//     players: { a: { name, joined, ready }, b: {...} },
//     hp: { a, b }, max: { a, b },
//     status: { a: {...}, b: {...} },   // the rules.js status objects: voltage, counter, staggered, ...
//     locked: { a: bool, b: bool },     // who has locked their chain this turn
//     beats: [ { a, b, playedA, playedB, outcome } ],   // ONLY the beats already revealed on the big screen
//     result: null | { winner: 'a' | 'b' },
//     note: ''                          // a line of prose for the banner, e.g. 'Waiting for Bluebell'
//   }
//   private.<side> = { hand: [cardId], energy, beats, deck: [cardId], swaps }   // that side's cards only
//
// Actions a phone may post: { type: 'join', name } | { type: 'deck', deck } | { type: 'lock', chain, turn }
//                           | { type: 'ready' }
// The server stamps `side`, `seq` and `t` on each one.

const J = { 'Content-Type': 'application/json' };
export const SIDES = ['a', 'b'];
export const SIDE_NAME = { a: 'Red knight', b: 'Blue knight' };
export const SIDE_COLOR = { a: 'red', b: 'blue' };

async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) { const e = new Error(url + ' -> ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

/** Host: make a room. Resolves with { code, tokens: {a,b}, urls: {a,b}, base }. */
export async function createRoom(base = '') {
  const r = await jfetch(base + '/api/mp/rooms', { method: 'POST', headers: J, body: '{}' });
  return new HostRoom({ ...r, base });
}

/** Host: take an existing room back after the big screen was reloaded. The server keeps a room for three
 *  hours and hands the tokens (and so the QR links) back, so the phones never have to do anything.
 *  Throws (status 404) when the room has expired: the caller then offers a plain title screen. */
export async function adoptRoom(code, base = '') {
  const r = await jfetch(`${base}/api/mp/rooms/${code}/adopt`, { method: 'POST', headers: J, body: '{}' });
  const room = new HostRoom({ ...r, base });
  room.rev = r.rev || 0; room.seq = r.seq || 0;      // carry on the numbering instead of fighting the phones
  room.seen = r.seen || { a: 0, b: 0 }; room.now = r.now || 0;
  return room;
}

/** The QR image URL for a link (server-side SVG; see server.py qr_svg). */
export function qrSrc(text, base = '') { return base + '/api/mp/qr.svg?text=' + encodeURIComponent(text); }

export class HostRoom {
  constructor({ code, tokens, urls, base = '' }) {
    Object.assign(this, { code, tokens, urls, base });
    this.rev = 0; this.seq = 0; this.stop = false; this.handlers = [];
    this.pub = null; this.priv = { a: {}, b: {} };
    // When each phone was last heard from, straight off the server (it stamps every poll and every action).
    // `now` is the server's clock at the same instant, so the age is computed without trusting this machine's.
    this.seen = { a: 0, b: 0 }; this.now = 0; this.seenAt = 0;
    this.onSeen = null;      // the Host Controls panel subscribes here
  }
  onAct(fn) { this.handlers.push(fn); return this; }
  /** How many seconds ago that side's phone last spoke to the server; null if it never has. */
  age(side) {
    const t = this.seen?.[side]; if (!t) return null;
    const drift = (Date.now() - this.seenAt) / 1000;              // time since we last read the server clock
    return Math.max(0, (this.now - t) + (this.seenAt ? drift : 0));
  }
  noteSeen(seen, now) {
    if (!seen) return;
    this.seen = seen; this.now = now || this.now; this.seenAt = Date.now();
    try { this.onSeen?.(this); } catch (e) {}
  }
  /** A cheap poll for the panel: who is still out there, and how stale (no tokens, no view). */
  async state() {
    const r = await jfetch(`${this.base}/api/mp/rooms/${this.code}/state`);
    this.noteSeen(r.seen, r.now); if (r.urls) this.urls = r.urls;
    return r;
  }
  /** Kick and reissue one seat: the server mints a new ticket and retires the old one, so the old phone is
   *  told "this seat was reissued" instead of looping. The seat's name, deck and state stay with the host. */
  async reissue(side) {
    const r = await jfetch(`${this.base}/api/mp/rooms/${this.code}/reissue`,
      { method: 'POST', headers: J, body: JSON.stringify({ side }) });
    this.tokens = r.tokens || this.tokens; this.urls = r.urls || this.urls;
    this.seen = { ...this.seen, [side]: 0 };
    return r;
  }
  /** The two phones trade colours (lobby only). The tickets move on the server; the host swaps its own
   *  per-side names and decks to match, so each player keeps their name and deck and changes seat. */
  async swap() {
    const r = await jfetch(`${this.base}/api/mp/rooms/${this.code}/swap`, { method: 'POST', headers: J, body: '{}' });
    this.tokens = r.tokens || this.tokens; this.urls = r.urls || this.urls;
    this.seen = { a: this.seen.b, b: this.seen.a };
    return r;
  }
  /** Push a new view. Returns the rev it was published as. Never throws: a dropped publish is retried by
   *  the next one, and the phones long-poll their way back to the latest state anyway. */
  async publish(pub, priv = {}) {
    this.pub = pub; this.priv = { a: priv.a || {}, b: priv.b || {} };
    const rev = ++this.rev;
    try {
      await jfetch(`${this.base}/api/mp/rooms/${this.code}/publish`,
        { method: 'POST', headers: J, body: JSON.stringify({ rev, public: pub, private: this.priv }) });
    } catch (e) { console.warn('publish failed', e); }
    return rev;
  }
  /** Republish the last view with a patch applied to `public` (the common case: a phase or a note change). */
  patch(fields) { return this.publish({ ...(this.pub || {}), ...fields }, this.priv); }
  /** Long-poll the players' actions forever; every one goes to every onAct handler. */
  async listen() {
    if (this.listening) return; this.listening = true;
    while (!this.stop) {
      try {
        const r = await jfetch(`${this.base}/api/mp/rooms/${this.code}/acts?since=${this.seq}&wait=25`);
        this.seq = r.seq; this.noteSeen(r.seen, r.now);
        for (const a of r.acts || []) for (const fn of this.handlers) { try { fn(a); } catch (e) { console.warn(e); } }
      } catch (e) { if (this.stop) break; await new Promise(r => setTimeout(r, 1000)); }
    }
    this.listening = false;
  }
  close() { this.stop = true; }
  /** Resolve with the first action for which `test` is true (with an optional timeout in ms). */
  next(test, ms = 0) {
    return new Promise((resolve, reject) => {
      let t = null;
      const fn = a => { if (!test(a)) return; cleanup(); resolve(a); };
      const cleanup = () => { this.handlers = this.handlers.filter(h => h !== fn); if (t) clearTimeout(t); };
      this.handlers.push(fn);
      if (ms) t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    });
  }
}

export class PlayerClient {
  constructor(token, base = '') { this.token = token; this.base = base; this.rev = 0; this.stop = false; this.fns = []; this.errFns = []; }
  onState(fn) { this.fns.push(fn); return this; }
  onError(fn) { this.errFns.push(fn); return this; }
  /** Long-poll our own view. Reconnects for ever: a phone that sleeps, loses Wi-Fi or is reloaded just
   *  picks the latest rev back up (the token lives in the URL, so a reload costs nothing). */
  async listen() {
    if (this.listening) return; this.listening = true;
    let fails = 0;
    while (!this.stop) {
      try {
        const v = await jfetch(`${this.base}/api/mp/p/${this.token}?rev=${this.rev}&wait=25`);
        fails = 0; this.rev = v.rev; this.side = v.side; this.code = v.code;
        for (const fn of this.fns) { try { fn(v.public || {}, v.private || {}, v); } catch (e) { console.warn(e); } }
      } catch (e) {
        if (this.stop) break;
        fails++; for (const fn of this.errFns) { try { fn(e, fails); } catch (_) {} }
        // 410: the host reissued this seat from its Host Controls. This ticket will never work again, so
        // stop polling and let the phone say so instead of spinning on a dead token.
        if (e.status === 410) { this.reissued = true; this.stop = true; break; }
        if (e.status === 404) { await new Promise(r => setTimeout(r, 3000)); }
        else await new Promise(r => setTimeout(r, Math.min(5000, 500 * fails)));
      }
    }
    this.listening = false;
  }
  close() { this.stop = true; }
  async act(obj) {
    try { return await jfetch(`${this.base}/api/mp/p/${this.token}/act`, { method: 'POST', headers: J, body: JSON.stringify(obj) }); }
    catch (e) { console.warn('act failed', e); return null; }
  }
}

// ---- deck validation (the host trusts nothing a phone sends) --------------------------------------------
export const MAX_SWAPS = 2;

/** Cards a player may put in a deck: everything in the catalogue except the resource card ('counter'),
 *  which is not a deck card -- the match puts it in the hand while that side is holding one. */
export function deckPool(CARDS) { return Object.keys(CARDS).filter(id => id !== 'counter' && id !== 'mirror'); }

/** Count how many cards differ between two decks, as a multiset. */
export function deckDiff(deck, base) {
  const bag = list => list.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
  const A = bag(deck), B = bag(base);
  let removed = 0;   // cards in the base that the new deck no longer has = the number of swaps made
  for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) removed += Math.max(0, (B[id] || 0) - (A[id] || 0));
  return removed;
}

/** Host-side validation of a { type: 'deck' } action: the same size as the starter deck, only real cards,
 *  never the resource card, and at most MAX_SWAPS cards changed. Returns the deck to use (the base on any
 *  violation, so a broken or hostile phone simply plays the starter deck). */
export function validateDeck(deck, base, CARDS) {
  if (!Array.isArray(deck) || deck.length !== base.length) return [...base];
  const ok = deckPool(CARDS);
  if (!deck.every(id => ok.includes(id))) return [...base];
  if (deckDiff(deck, base) > MAX_SWAPS) return [...base];
  return [...deck];
}

/** The deck manager's bookkeeping, shared by the big screen (screens.deck) and the phone. A swap takes one
 *  card out of the deck and puts one from the pool in, so the deck never changes size; MAX_SWAPS of them,
 *  each undoable. The UI is written twice (a tavern table vs a phone), the rules only once. */
export class DeckEdit {
  constructor(base, pool) { this.base = [...base]; this.deck = [...base]; this.pool = [...pool]; this.history = []; }
  get swapsLeft() { return MAX_SWAPS - this.history.length; }
  get dirty() { return this.history.length > 0; }
  /** Counts, in a stable order: [[id, n], ...] */
  counts(list = this.deck) {
    const m = new Map();
    for (const id of list) m.set(id, (m.get(id) || 0) + 1);
    return [...m.entries()];
  }
  can(outId, inId) { return this.swapsLeft > 0 && this.deck.includes(outId) && this.pool.includes(inId); }
  swap(outId, inId) {
    if (!this.can(outId, inId)) return false;
    this.deck.splice(this.deck.indexOf(outId), 1); this.deck.push(inId);
    this.history.push([outId, inId]); return true;
  }
  undo() {
    const last = this.history.pop(); if (!last) return false;
    const [outId, inId] = last;
    const k = this.deck.lastIndexOf(inId); if (k >= 0) this.deck.splice(k, 1);
    this.deck.push(outId); return true;
  }
  reset() { this.deck = [...this.base]; this.history = []; }
}
