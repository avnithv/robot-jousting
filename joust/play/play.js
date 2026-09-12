// The phone client: a thin renderer for whatever the big screen publishes, plus the four things a player
// can send back (join, deck, lock, ready). No rules live here -- the host owns them. The token in the URL
// says which side you are, so a reload costs nothing and nobody can see the other hand.
import { PlayerClient, DeckEdit, deckPool, MAX_SWAPS, SIDE_NAME, SIDE_COLOR } from '../src/net/room.js';
import { CARDS, STARTER_DECK, card, ENERGY_PER_TURN, BEATS_PER_TURN } from '../src/game/cards.js';
import { cardEl } from '../src/ui/battle.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const other = s => (s === 'a' ? 'b' : 'a');
const safeCard = id => { try { return id ? card(id) : null; } catch (e) { return null; } };
const buzz = ms => { try { navigator.vibrate?.(ms); } catch (e) {} };

const token = new URLSearchParams(location.search).get('t') || '';
const app = $('p-app'), oppEl = $('p-opp'), meEl = $('p-me'), bannerEl = $('p-banner'), mainEl = $('p-main'), modalEl = $('p-modal');
const conn = el('div', 'p-conn', document.body, 'reconnecting…'); conn.hidden = true;
// The plan countdown and the host's paused banner ride just under the phase banner, where the thumb is not.
const clockEl = el('div', 'p-clock', null, '<b></b><span>to lock in</span>'); clockEl.hidden = true;
bannerEl.after(clockEl);
const pausedEl = el('div', 'p-paused', null, '<b>Paused</b><span>the host has the fight held</span>'); pausedEl.hidden = true;
clockEl.after(pausedEl);

// ---- local state -----------------------------------------------------------------------------------------
const L = {
  side: null, pub: {}, priv: {}, rev: 0,
  name: localStorage.getItem('tilt.mp.name') || '',
  joining: false, plan: null, readySent: false, deckSent: null, view: '',
  timer: null,      // { left, total, at } -- the host's countdown, ticked locally between publishes
  paused: false,
};

if (!token) {
  bannerEl.textContent = 'No ticket';
  el('div', 'p-note', mainEl, 'This link is missing its token. Scan the QR code on the big screen again.');
} else {
  boot();
}

function boot() {
  const client = new PlayerClient(token);
  L.client = client;
  client.onError((e, n) => {
    // 410: the host kicked this seat and minted a new ticket. This phone is done -- say so plainly, because
    // the player is about to be handed a fresh QR code and should not sit here waiting.
    if (e.status === 410) return viewReissued();
    conn.hidden = false; conn.textContent = e.status === 404 ? 'this room has closed' : 'reconnecting…';
    if (n > 2) bannerEl.classList.add('p-wait');
  });
  client.onState((pub, priv) => {
    conn.hidden = true;
    L.pub = pub || {}; L.priv = priv || {}; L.side = client.side; L.rev = client.rev;
    // The countdown is published once a second; between publishes the phone ticks it down itself so the
    // number never looks stuck, and a pause freezes it exactly as it freezes the big screen's.
    const t = L.pub.timer;
    L.timer = t && t.left != null ? { left: t.left, total: t.total, at: Date.now() } : null;
    L.paused = !!L.pub.paused;
    render();
  });
  client.listen();
  setInterval(paintClock, 250);
}

/** The seat was reissued: stop everything and hand the screen over to the message. */
function viewReissued() {
  L.reissued = true;
  try { L.client?.close(); } catch (e) {}
  oppEl.hidden = meEl.hidden = true; clockEl.hidden = true; pausedEl.hidden = true; conn.hidden = true;
  modalEl.hidden = true; modalEl.innerHTML = '';
  banner('This seat was reissued', 'The host handed your place to a new phone', 'p-lose');
  L.view = 'reissued'; mainEl.innerHTML = '';
  el('p', 'p-note', mainEl, 'Your ticket no longer opens this room. Scan the new code on the big screen to take the seat back — your name, your deck and your cards are all still there, waiting.');
}

/** The countdown and the paused banner, repainted four times a second off the last published numbers. */
function paintClock() {
  if (L.reissued) return;
  pausedEl.hidden = !L.paused;
  const t = L.timer, planning = L.pub.phase === 'plan' && !(L.pub.locked || {})[L.side];
  if (!t || !planning) { clockEl.hidden = true; return; }
  // While the host has it paused, the number stands still: the timer is not running on the big screen either.
  const left = L.paused ? t.left : Math.max(0, t.left - (Date.now() - t.at) / 1000);
  const n = Math.max(0, Math.round(left));
  clockEl.hidden = false;
  clockEl.querySelector('b').textContent = n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : String(n);
  clockEl.classList.toggle('urgent', n <= 10 && !L.paused);
}

// ---- the two fighter strips ------------------------------------------------------------------------------
function fighter(box, side, isMe) {
  const P = L.pub, players = P.players || {}, me = players[side] || {};
  const hp = (P.hp || {})[side], max = (P.max || {})[side] || 1;
  const st = (P.status || {})[side] || {};
  box.className = 'p-fighter ' + side;
  box.innerHTML = '';
  const row = el('div', 'p-row', box);
  el('div', 'p-name', row, `${me.name || (isMe ? 'You' : 'Waiting…')}<span class="p-who">${isMe ? 'you' : 'opponent'} · ${SIDE_NAME[side]}</span>`);
  if (hp != null) el('div', 'p-hpnum', row, `${hp} / ${max}`);
  if (hp != null) {
    const bar = el('div', 'p-hp' + (hp / max <= 0.3 ? ' low' : ''), box);
    el('i', '', bar).style.transform = `scaleX(${Math.max(0, hp / max)})`;
  }
  const chips = el('div', 'p-chips', box);
  if (isMe || (me.joined && st.voltage != null)) {   // nothing to report about an empty chair
    const v = el('div', 'p-chip volt', chips, '<b>VOLTAGE</b>');
    const dots = el('span', 'p-volt', v);
    for (let i = 0; i < 2; i++) el('i', i < (st.voltage || 0) ? 'on' : '', dots);
  }
  if (st.counter) el('div', 'p-chip', chips, `Counter × ${st.counter}`);
  if (st.staggered) el('div', 'p-chip bad', chips, 'Staggered');
  if (st.exposed) el('div', 'p-chip bad', chips, 'Exposed');
  if (st.riposte) el('div', 'p-chip', chips, 'Riposte +2');
  if (st.windup) el('div', 'p-chip', chips, 'Wind up +3');
  if (st.parry) el('div', 'p-chip', chips, 'Parry ×2');
  if (st.flourish) el('div', 'p-chip', chips, `Flourish +${st.flourish} cards`);
  if ((P.locked || {})[side] && P.phase === 'plan') el('div', 'p-chip', chips, 'Locked in');
}

function banner(title, sub = '', cls = '') {
  bannerEl.className = cls;
  bannerEl.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
}

// ---- the card face, at phone size ------------------------------------------------------------------------
function mini(c, { color = 'red', k = 0.62, count = 0, onTap = null, cls = '' } = {}) {
  const box = el('div', 'p-cardbox ' + cls); box.style.setProperty('--k', k);
  box.appendChild(cardEl(c, { color }));
  if (count > 1) el('div', 'p-count', box, '×' + count);
  if (onTap) box.addEventListener('click', onTap);
  return box;
}

// ---- render ----------------------------------------------------------------------------------------------
function render() {
  const P = L.pub, side = L.side;
  if (L.reissued) return;
  paintClock();
  if (!side) return;
  const them = other(side);
  const players = P.players || {};
  const meJoined = (players[side] || {}).joined;
  const oppName = (players[them] || {}).name || 'the other knight';

  fighter(oppEl, them, false);
  fighter(meEl, side, true);
  oppEl.hidden = meEl.hidden = !meJoined;

  if (!meJoined) return viewJoin();
  const phase = P.phase || 'lobby';
  if (phase === 'result') return viewResult(oppName);
  if (phase === 'exchange') return viewExchange(oppName);
  if (phase === 'plan') return (P.locked || {})[side] ? viewLocked(oppName) : viewPlan(oppName);
  return viewLobby(oppName, players[them] || {});
}

/** Keep a DOM subtree alive across re-renders when only the strips changed. */
function setView(key, build) {
  if (L.view === key && mainEl.firstChild) return false;
  L.view = key; mainEl.innerHTML = ''; build(mainEl); return true;
}

function viewJoin() {
  oppEl.hidden = meEl.hidden = true;
  banner('The Tilt of Tiltford', `You are the ${SIDE_NAME[L.side]}`);
  setView('join', box => {
    el('p', 'p-note', box, 'Give the herald a name and take your place in the lists. Your cards stay on this phone; the fight plays out on the big screen.');
    const input = el('input', 'p-field', box); input.type = 'text'; input.maxLength = 16;
    input.placeholder = 'Your name'; input.value = L.name; input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'go');
    const btn = el('button', 'p-btn', box, 'Enter the lists');
    const go = () => {
      const name = (input.value || '').trim().slice(0, 16) || SIDE_NAME[L.side];
      L.name = name; localStorage.setItem('tilt.mp.name', name);
      btn.disabled = true; btn.textContent = 'Entering…'; L.joining = true; buzz(20);
      L.client.act({ type: 'join', name });
    };
    btn.onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    setTimeout(() => input.focus(), 150);
  });
}

function viewLobby(oppName, opp) {
  const waiting = !opp.joined;
  banner(waiting ? 'Waiting for the other knight' : 'Ready when the herald is', waiting ? 'They scan the other QR code on the big screen' : `${oppName} is here. The big screen starts the fight.`, 'p-wait');
  setView('lobby:' + (waiting ? 'w' : 'r'), box => {
    el('p', 'p-note', box, 'While you wait you may swap up to two cards in your deck. Everything else is decided in the arena.');
    const btn = el('button', 'p-btn quiet', box, 'Adjust your deck');
    btn.onclick = () => openDeck();
    el('div', 'p-note', box, `Room ${L.pub.code || L.client.code || ''} · you are the ${SIDE_NAME[L.side]}`);
  });
  const b = mainEl.querySelector('.p-btn'); if (b) b.textContent = L.deckSent ? 'Deck set — adjust again' : 'Adjust your deck';
}

function viewPlan(oppName) {
  banner('Plan your three beats', 'Tap a card to place it, tap a beat to take it back');
  const key = `plan:${L.pub.turn}:${(L.priv.hand || []).join(',')}`;
  setView(key, box => {
    L.plan = { hand: [...(L.priv.hand || [])], chain: Array(L.priv.beats || BEATS_PER_TURN).fill(null), spent: 0, energy: L.priv.energy ?? ENERGY_PER_TURN };
    el('div', 'p-h', box, 'Your three beats');
    el('div', 'p-slots', box);
    const bar = el('div', 'p-bar', box);
    el('div', 'p-lab', bar, 'Energy'); el('div', 'p-energy', bar);
    el('div', 'p-h', box, 'Your hand');
    el('div', 'p-hand', box);
    const lock = el('button', 'p-btn', box, 'Lock in');
    lock.onclick = () => doLock(oppName);
    box.dataset.lock = '1';
  });
  drawPlan();
}

function drawPlan() {
  const P = L.plan; if (!P) return;
  const color = SIDE_COLOR[L.side];
  const slots = mainEl.querySelector('.p-slots'); const hand = mainEl.querySelector('.p-hand');
  const energy = mainEl.querySelector('.p-energy'); const lock = mainEl.querySelector('.p-btn');
  if (!slots || !hand) return;
  const next = P.chain.indexOf(null);
  slots.innerHTML = '';
  P.chain.forEach((id, i) => {
    const s = el('div', 'p-slot' + (i === next ? ' next' : ''), slots);
    const c = safeCard(id);
    if (c) { s.appendChild(mini(c, { color, k: 0.62, onTap: () => unslot(i) })); }
    else el('div', 'p-sn', s, `Beat ${i + 1}<b>${i === next ? 'play a card' : 'rest'}</b>`);
  });
  const left = P.energy - P.spent;
  // The same signal the big screen's table gives: a Rush you cannot power reads as unavailable. This is a
  // hint, not a rule -- the host resolves what a rush with no voltage actually does.
  const volts = ((L.pub.status || {})[L.side] || {}).voltage || 0;
  hand.innerHTML = '';
  P.hand.forEach((id, i) => {
    const c = safeCard(id); if (!c) return;
    const noVolt = (c.volt || 0) > 0 && volts < c.volt;
    const blocked = c.cost > left || next < 0 || noVolt;
    const box = mini(c, { color, k: 0.8, cls: blocked ? 'dim' : '', onTap: blocked ? null : () => slot(i) });
    if (noVolt) el('div', 'p-needvolt', box, 'needs voltage');
    hand.appendChild(box);
  });
  if (!P.hand.length) el('div', 'p-note', hand, 'Nothing left in hand.');
  energy.innerHTML = '';
  for (let i = 0; i < P.energy; i++) el('i', i < P.spent ? 'spent' : '', energy);
  lock.textContent = P.chain.every(x => x === null) ? 'Rest this turn' : 'Lock in';
}

/** Tell the host what is in the three beats right now. Not a lock -- it is what a Force lock or an expired
 *  plan timer will play on this phone's behalf, so walking away mid-plan still plays the cards you chose. */
function sendDraft() {
  const P = L.plan; if (!P) return;
  clearTimeout(L.draftT);
  L.draftT = setTimeout(() => L.client?.act({ type: 'draft', chain: P.chain, turn: L.pub.turn }), 150);
}
function slot(handIndex) {
  const P = L.plan; const id = P.hand[handIndex]; const c = safeCard(id); if (!c) return;
  const next = P.chain.indexOf(null);
  if (next < 0 || c.cost > P.energy - P.spent) { buzz(8); return; }
  P.chain[next] = id; P.spent += c.cost; P.hand.splice(handIndex, 1); buzz(12); drawPlan(); sendDraft();
}
function unslot(i) {
  const P = L.plan; const id = P.chain[i]; if (!id) return;
  P.spent -= safeCard(id).cost; P.hand.push(id);
  P.chain.splice(i, 1); P.chain.push(null);   // keep the beats compact, as the big screen's table does
  buzz(8); drawPlan(); sendDraft();
}
function doLock(oppName) {
  const P = L.plan; if (!P) return;
  L.client.act({ type: 'lock', chain: P.chain, turn: L.pub.turn, forRev: L.rev });
  buzz(25); L.plan = null; L.lockedChain = P.chain; viewLocked(oppName, true);
}

function viewLocked(oppName, force = false) {
  banner('Locked in', `Waiting for ${oppName}`, 'p-wait');
  const chain = L.lockedChain || (L.priv.chain || []);
  if (!setView('locked:' + L.pub.turn, box => {
    el('div', 'p-h', box, 'Your three beats');
    el('div', 'p-card-list', box);
    el('p', 'p-note', box, 'When both knights have locked, the arms charge. Watch the big screen.');
  }) && !force) return;
  const list = mainEl.querySelector('.p-card-list');
  if (!list) return;
  list.innerHTML = '';
  const color = SIDE_COLOR[L.side];
  if (!chain.length) { el('div', 'p-note', list, 'Your beats are with the herald.'); return; }
  chain.forEach(id => {
    const c = safeCard(id);
    if (c) list.appendChild(mini(c, { color, k: 0.55 }));
    else { const b = el('div', 'p-blank'); b.textContent = 'rest'; list.appendChild(b); }
  });
}

function viewExchange(oppName) {
  banner('Watch the arena', 'The arms are moving');
  const beats = L.pub.beats || [];
  setView('exchange:' + L.pub.turn, box => { el('div', 'p-beats', box); });
  const box = mainEl.querySelector('.p-beats'); if (!box) return;
  box.innerHTML = '';
  const mine = SIDE_COLOR[L.side], theirs = SIDE_COLOR[other(L.side)];
  const n = Math.max(BEATS_PER_TURN, beats.length);
  for (let i = 0; i < n; i++) {
    const b = beats[i];
    const row = el('div', 'p-beat' + (b ? ' shown' : '') + (L.pub.beat === i ? ' now' : ''), box);
    el('div', 'p-bn', row, `Beat ${i + 1} — you vs ${oppName}`);
    const pair = el('div', 'p-pair', row);
    const face = (id, color) => {
      const c = safeCard(id);
      if (!b) { const d = el('div', 'p-blank'); d.textContent = '…'; return d; }
      if (!c) { const d = el('div', 'p-blank'); d.textContent = 'rest'; return d; }
      return mini(c, { color, k: 0.62 });
    };
    const myId = b ? (L.side === 'a' ? b.playedA ?? b.a : b.playedB ?? b.b) : null;
    const opId = b ? (L.side === 'a' ? b.playedB ?? b.b : b.playedA ?? b.a) : null;
    pair.appendChild(face(myId, mine)); el('div', 'p-vs', pair, 'vs'); pair.appendChild(face(opId, theirs));
    el('div', 'p-out', row, b ? (b.outcome || '') : '');
  }
}

function viewResult(oppName) {
  const res = L.pub.result || {};
  const draw = res.winner === 'draw' || res.draw;
  const won = !draw && res.winner === L.side;
  // A side that ran out of plan timers loses the fight; both phones are told which way round it was.
  const forfeit = res.forfeit || null;
  const head = draw ? 'A draw' : won ? 'You won' : 'You lost';
  const sub = forfeit === L.side ? 'You ran out of time once too often — the fight was forfeited.'
    : forfeit ? `${oppName} never came back. The fight was forfeited.`
    : draw ? 'The herald calls it level.'
    : won ? `${oppName} yields.` : `${oppName} stands over you.`;
  banner(head, sub, draw ? 'p-wait' : won ? 'p-win' : 'p-lose');
  const ready = (L.pub.players || {})[L.side]?.ready;
  const oppReady = (L.pub.players || {})[other(L.side)]?.ready;
  setView(`result:${head}:${!!ready}:${!!oppReady}:${forfeit || ''}`, box => {
    el('p', 'p-note', box, won ? 'The crowd is yours. Another?' : 'Shake it off. Another?');
    if (ready) {
      el('div', 'p-h', box, oppReady ? 'Both ready' : `Ready — waiting for ${oppName}`);
      const b = el('button', 'p-btn quiet', box, 'Adjust your deck'); b.onclick = () => openDeck();
    } else {
      const b = el('button', 'p-btn', box, 'Ready for a rematch');
      b.onclick = () => { b.disabled = true; b.textContent = 'Ready'; L.readySent = true; buzz(25); L.client.act({ type: 'ready' }); };
      const d = el('button', 'p-btn quiet', box, 'Adjust your deck first'); d.onclick = () => openDeck();
    }
  });
}

// ---- the deck manager ------------------------------------------------------------------------------------
// Up to two swaps: each takes one card out of your deck and puts one from the catalogue in, so the deck
// never changes size. The resource card ('counter') is not a deck card and never appears in the pool.
function openDeck() {
  const base = (L.priv.deck && L.priv.deck.length ? L.priv.deck : (L.deckChosen || STARTER_DECK));
  const edit = new DeckEdit(base, deckPool(CARDS));
  let picked = null;   // the deck card waiting to be swapped out
  modalEl.hidden = false; modalEl.scrollTop = 0;
  const color = SIDE_COLOR[L.side] || 'red';
  const draw = () => {
    modalEl.innerHTML = '';
    const box = el('div', 'p-deck', modalEl);
    el('h2', '', box, 'Your deck');
    el('div', 'p-swaps', box, `<b>${edit.swapsLeft}</b> of ${MAX_SWAPS} swaps left`);
    el('div', 'p-swapline', box, picked ? `Swapping out ${safeCard(picked)?.name || picked} — now tap a card to swap in` : 'Tap a card in your deck, then tap its replacement below.');
    const mineGrid = el('div', 'p-grid', box);
    for (const [id, n] of edit.counts()) {
      const c = safeCard(id); if (!c) continue;
      mineGrid.appendChild(mini(c, { color, k: 0.56, count: n, cls: picked === id ? 'pick' : '', onTap: () => { picked = picked === id ? null : id; draw(); buzz(8); } }));
    }
    el('div', 'p-h', box, 'The rack behind the bar');
    const poolGrid = el('div', 'p-grid', box);
    for (const id of edit.pool) {
      const c = safeCard(id); if (!c) continue;
      const dead = !picked || edit.swapsLeft <= 0;
      poolGrid.appendChild(mini(c, { color, k: 0.56, cls: dead ? 'dim' : '', onTap: dead ? null : () => {
        if (edit.swap(picked, id)) { picked = null; buzz(18); draw(); } else buzz(6);
      } }));
    }
    const acts = el('div', 'p-actions', box);
    const undo = el('button', 'p-btn quiet', acts, 'Undo'); undo.disabled = !edit.dirty;
    undo.onclick = () => { edit.undo(); picked = null; draw(); };
    const done = el('button', 'p-btn', acts, 'Done');
    done.onclick = () => {
      L.deckChosen = [...edit.deck]; L.deckSent = true;
      L.client.act({ type: 'deck', deck: edit.deck });
      modalEl.hidden = true; modalEl.innerHTML = ''; L.view = ''; render();
    };
  };
  draw();
}
