// The host half of a phone duel: it owns the published view of the fight and turns the phones' actions
// into the two player controllers the match engine asks for.
//
// The big screen runs the rules (match.js, rules.js) exactly as it does in the campaign. The only thing
// that changes is WHERE a chain comes from: instead of the card table (LocalHuman) or chooseChain (AI),
// both sides are Remote -- planTurn() publishes the view and resolves when that side's phone posts a lock.
//
//   const host = new MpHost(room, { players, decks });
//   new Match({ ..., mode: 'mp', controllers: host.controllers(), onPhase: host.hook() })
//
// Everything a phone sends is treated as hostile: a chain is filtered down to cards that are really in
// that hand and really affordable, a deck is validated against the starter, and a lock for the wrong turn
// is dropped on the floor.
//
// Two things beyond the fight itself live here, because both are about a player who is NOT at their phone:
//
//   * Force lock / plan timer / forfeit. A phone that stops answering used to freeze the arena for everyone.
//     Now every planning phase can carry a countdown (Host Controls -> Settings -> Plan timer); at zero the
//     host locks the silent side in with its current slots -- the phone posts a `draft` on every tap, so
//     "current slots" means what that player actually had, and unfilled beats simply rest. Miss enough of
//     them in a row and Auto-forfeit hands the fight to the other knight.
//   * The host snapshot. After every phase change the whole duel is written to sessionStorage and the room
//     code is in the page URL, so reloading the big screen mid-fight is survivable: see src/net/snapshot.js.
import { Match } from '../game/match.js';
import { CARDS, STARTER_DECK, card, ENERGY_PER_TURN, BEATS_PER_TURN } from '../game/cards.js';
import { validateDeck, SIDE_NAME } from './room.js';
import { control as hostControl, session } from '../game/hostctl.js';
import * as settings from '../game/settings.js';
import * as snapshot from './snapshot.js';

const SIDES = ['a', 'b'];
const other = s => (s === 'a' ? 'b' : 'a');
export const MP_HP = 25;          // both knights, every fight (unless the host has set a starting HP)
export const MP_COUNTERS = 1;     // one counter each

/** Filter a chain a phone sent down to something legal: real cards, actually in that hand, within energy,
 *  no more than BEATS_PER_TURN of them. Anything else becomes an empty beat (a rest). */
export function sanitizeChain(chain, hand, energy = ENERGY_PER_TURN, beats = BEATS_PER_TURN) {
  const out = Array(beats).fill(null);
  if (!Array.isArray(chain)) return out;
  const left = [...(hand || [])];
  let spent = 0;
  for (let i = 0; i < Math.min(beats, chain.length); i++) {
    const id = chain[i];
    if (!id || typeof id !== 'string' || !CARDS[id]) continue;
    const k = left.indexOf(id); if (k < 0) continue;          // not in that hand
    let c; try { c = card(id); } catch (e) { continue; }
    if (c.cost > energy - spent) continue;                    // cannot afford it
    left.splice(k, 1); spent += c.cost; out[i] = id;
  }
  return out;
}

export class MpHost {
  constructor(room, { players, decks, control = hostControl, poses = null } = {}) {
    this.room = room;
    this.players = { a: { ...(players?.a || {}) }, b: { ...(players?.b || {}) } };
    this.decks = { a: [...(decks?.a || STARTER_DECK)], b: [...(decks?.b || STARTER_DECK)] };
    this.pending = { a: null, b: null };      // planTurn resolvers, waiting for a lock
    this.locked = { a: false, b: false };
    this.chains = { a: null, b: null };
    this.drafts = { a: null, b: null };       // the slots each phone has filled so far, for a force lock
    this.missed = { a: 0, b: 0 };             // plan timers this side has run out of, in a row
    this.forfeit = null;                      // the side that walked away, once auto-forfeit fires
    this.reissuedAt = { a: 0, b: 0 };         // when each seat's ticket was last reissued (for the panel)
    this.match = null; this.revealed = []; this.phase = 'lobby'; this.result = null; this.note = '';
    this.timer = null;                        // { left, total } while a plan countdown is running
    this.poses = poses || { opener: settings.get('opener') || null, finale: settings.get('finale') || null };
    this.onChange = null;                     // the host UI (the result screen) subscribes here
    this.control = control;
    this.paused = control.paused;
    this._offPause = control.on(c => { if (c.paused !== this.paused) { this.paused = c.paused; this.publish(); this.fire(); } });
    room.onAct(a => this.act(a));
    room.onSeen = () => this.fire();          // the panel repaints when a phone is heard from
  }
  name(side) { return this.players[side]?.name || SIDE_NAME[side]; }
  fire() { try { this.onChange?.(this); } catch (e) {} }
  close() { try { this._offPause?.(); } catch (e) {} this.onChange = null; this.room.onSeen = null; }

  // ---- what the phones send ------------------------------------------------------------------------------
  act(a) {
    const side = a.side; if (!SIDES.includes(side)) return;
    if (a.type === 'join') { this.players[side] = { ...this.players[side], name: String(a.name || '').trim().slice(0, 16) || SIDE_NAME[side], joined: true }; }
    else if (a.type === 'deck') { this.decks[side] = validateDeck(a.deck, STARTER_DECK, CARDS); }
    else if (a.type === 'ready') { this.players[side] = { ...this.players[side], ready: true }; }
    else if (a.type === 'draft') {
      // Not a lock: just "this is what I have in my beats right now", so a force lock or a timeout plays
      // what the player actually had rather than three rests. Never published; the host keeps it.
      if (a.turn != null && this.match && a.turn !== this.match.turn) return;
      this.drafts[side] = Array.isArray(a.chain) ? a.chain.slice(0, BEATS_PER_TURN) : null;
      return;                                                                    // no republish: it is a keystroke
    }
    else if (a.type === 'lock') {
      const resolve = this.pending[side]; if (!resolve) return;                      // not their turn to speak
      if (a.turn != null && this.match && a.turn !== this.match.turn) return;        // a stale lock from last turn
      const hand = this.match?.deck?.[side]?.hand || [];
      const chain = sanitizeChain(a.chain, hand);
      this.pending[side] = null; this.locked[side] = true; this.chains[side] = chain;
      this.drafts[side] = null; this.missed[side] = 0;                              // they are at their phone
      this.publish(); this.fire();
      resolve(chain); return;
    } else return;
    this.publish(); this.fire();
  }
  bothReady() { return !!(this.players.a.ready && this.players.b.ready); }
  clearReady() { for (const s of SIDES) this.players[s] = { ...this.players[s], ready: false }; }

  // ---- absent players ------------------------------------------------------------------------------------
  /** Lock one side in where it stands. `why` is 'host' (the drawer's Force lock) or 'timer' (the countdown
   *  ran out). Unfilled beats rest. Returns false if that side was not waiting to lock anyway. */
  forceLock(side, why = 'host') {
    const resolve = this.pending[side]; if (!resolve) return false;
    const hand = this.match?.deck?.[side]?.hand || [];
    const chain = sanitizeChain(this.drafts[side] || [], hand);
    this.pending[side] = null; this.locked[side] = true; this.chains[side] = chain; this.drafts[side] = null;
    if (why === 'timer') {
      this.missed[side] += 1;
      this.note = `${this.name(side)} ran out of time`;
      const limit = Number(settings.get('autoForfeit')) || 0;
      // One plan timer can run out on BOTH sides at once (nobody is at either phone). Collect the sides that
      // went over, then decide once: two absentees is a draw, not a win for whoever was checked first.
      if (limit && this.missed[side] >= limit) {
        (this.overdue = this.overdue || new Set()).add(side);
        clearTimeout(this._forfeitT);
        this._forfeitT = setTimeout(() => this.resolveForfeits(), 0);
      }
    } else this.note = `${this.name(side)} was locked in by the host`;
    this.publish(); this.fire();
    resolve(chain);   // the forfeit lands after the lock resolves, so no controller is left dangling
    return true;
  }
  /** Sides that have missed one plan timer too many lose the fight. Both of them? Nobody is playing: a draw. */
  resolveForfeits() {
    const gone = [...(this.overdue || [])]; this.overdue = null;
    if (!gone.length || !this.match || this.match.over) return;
    if (gone.length >= SIDES.length) {
      this.forfeit = null; this.note = 'Both knights walked away';
      this.result = { winner: 'draw', draw: true, forfeit: null };
      this.publish(); this.match.finishNow('draw');
      return;
    }
    const side = gone[0];
    this.forfeit = side;
    this.note = `${this.name(side)} forfeits`;
    this.result = { winner: other(side), forfeit: side };
    this.publish();
    this.match.finishNow(other(side));
  }
  /** Kick and reissue: a new ticket for that seat. The old phone is told the seat was reissued; the seat's
   *  name, deck and cards stay exactly where they are, so the fight carries on when the new phone joins. */
  async kick(side) {
    const r = await this.room.reissue(side);
    this.players[side] = { ...this.players[side], joined: false, ready: false, reissued: true };
    this.reissuedAt[side] = Date.now(); this.missed[side] = 0;
    this.note = `${SIDE_NAME[side]} seat reissued — scan the new code`;
    this.publish(); this.fire(); this.save();
    return r;
  }
  /** The two phones trade colours. Lobby only: mid-fight it would hand each player the other's cards. */
  async swapSeats() {
    await this.room.swap();
    // The tickets moved on the server, so the people moved with them: take their names and decks along.
    this.players = { a: { ...this.players.b }, b: { ...this.players.a } };
    this.decks = { a: [...this.decks.b], b: [...this.decks.a] };
    this.note = 'The knights have traded colours';
    this.publish(); this.fire(); this.save();
  }

  // ---- the two player controllers the match asks for -----------------------------------------------------
  /** A controller is { name, tell, planTurn(view) -> Promise<chain> }. Remote: publish and wait. */
  controller(side) {
    return {
      side, name: this.name(side), tell: false, remote: true,
      planTurn: () => new Promise(resolve => {
        this.pending[side] = resolve; this.locked[side] = false; this.chains[side] = null; this.drafts[side] = null;
        this.publish(); this.fire();
      }),
      timeout: () => this.forceLock(side, 'timer'),   // the plan countdown hit zero with this side unlocked
      cancel: () => { this.pending[side] = null; },   // the host ended the fight from the drawer
    };
  }
  controllers() { return { a: this.controller('a'), b: this.controller('b') }; }

  // ---- the hook the match calls at every phase change ----------------------------------------------------
  /** match.js calls onPhase(kind, extra, match). Kinds: 'plan' | 'exchange' | 'beat' | 'result'. */
  hook() {
    return (kind, extra, match) => {
      this.match = match || this.match;
      if (this.match) this.match.onTimer = (left, total) => this.setTimer(left, total);
      if (kind === 'plan') { this.phase = 'plan'; this.revealed = []; this.locked = { a: false, b: false }; this.overdue = null; this.note = 'Both knights are choosing'; }
      else if (kind === 'exchange') {
        this.phase = 'exchange'; this.revealed = [];
        this.liveArms = !!extra.live; this.beatPlan = extra.beats || null;
        this.note = extra.live && extra.turnMs
          ? `The arms charge — ${(extra.turnMs / 1000).toFixed(0)} s of real swinging`
          : 'The arms charge';
      }
      else if (kind === 'beat') {
        this.phase = 'exchange';
        this.revealed[extra.i] = {
          a: extra.plannedA || null, b: extra.plannedB || null,
          playedA: extra.playedA || null, playedB: extra.playedB || null,
          outcome: extra.outcome || '',
        };
        this.note = `Beat ${extra.i + 1}`;
      } else if (kind === 'result') {
        this.phase = 'result';
        this.result = { winner: extra.winner, draw: extra.winner === 'draw', forfeit: extra.forfeit || this.result?.forfeit || null };
        this.note = extra.winner === 'draw' ? 'A draw' : `${this.name(extra.winner)} wins`;
      }
      this.publish(); this.fire(); this.save();
    };
  }
  /** The plan countdown, straight from the match, republished so both phones show the same number. */
  setTimer(left, total) {
    const t = left == null ? null : { left, total };
    const was = this.timer;
    this.timer = t;
    if (!was !== !t || (t && was && t.left !== was.left)) { this.publish(); this.fire(); }
  }

  // ---- the published view --------------------------------------------------------------------------------
  publish() {
    const m = this.match;
    const st = m ? m.st : { a: {}, b: {} };
    const pub = {
      phase: this.phase, code: this.room.code, turn: m ? m.turn : 0,
      beat: this.phase === 'exchange' ? Math.max(0, this.revealed.length - 1) : -1,
      players: { a: { ...this.players.a }, b: { ...this.players.b } },
      hp: m ? { ...m.hp } : null, max: m ? { ...m.max } : null,
      status: { a: { ...(st.a || {}) }, b: { ...(st.b || {}) } },
      locked: { ...this.locked },
      beats: this.revealed.filter(Boolean),
      result: this.result, note: this.note,
      timer: this.timer,          // { left, total } -- the phones count down with the big screen
      paused: !!this.paused,      // the host has the fight held: every phone shows the same banner
      // On live arms a beat is the daemon's whole /play (ease in, trajectory, 1.5 s hold, ease home) -- about
      // 4.5 s for an attack, not 1.4 s. The phones get the real schedule so "Watch the arena" can size itself
      // to what the metal is doing. A beat is only ever ADDED to `beats` above after the match has awaited
      // bridge.beat(), so a phone can never be told a beat is over before the arms have finished it.
      live: !!this.liveArms,
      beatPlan: this.beatPlan || null,
    };
    const priv = {};
    for (const s of SIDES) {
      priv[s] = {
        hand: m && this.phase === 'plan' && !this.locked[s] ? [...m.deck[s].hand] : [],
        energy: ENERGY_PER_TURN, beats: BEATS_PER_TURN,
        chain: this.chains[s] || [],
        deck: this.decks[s],
      };
    }
    return this.room.publish(pub, priv);
  }

  // ---- the host snapshot (a reload of the big screen must not kill the duel) --------------------------------
  /** Everything needed to rebuild this duel in a fresh page: the room and its tickets, both players, both
   *  decks, the settings in force, and the match's own state frozen at the last phase boundary. */
  snapshot() {
    const m = this.match;
    return {
      code: this.room.code, tokens: { ...this.room.tokens }, base: this.room.base || '',
      rev: this.room.rev, seq: this.room.seq,
      phase: this.phase, note: this.note, result: this.result,
      players: { a: { ...this.players.a }, b: { ...this.players.b } },
      decks: { a: [...this.decks.a], b: [...this.decks.b] },
      poses: { ...this.poses },
      missed: { ...this.missed },
      settings: settings.all(),
      revealed: this.revealed.filter(Boolean),
      match: m && !m.over ? m.snapshot() : null,
    };
  }
  save() { try { snapshot.save(this.snapshot()); } catch (e) { console.warn('snapshot', e); } }
  /** Put a snapshot's non-match state back (the match itself is rebuilt by runMultiplayer). */
  hydrate(snap) {
    if (!snap) return;
    this.players = { a: { ...(snap.players?.a || {}) }, b: { ...(snap.players?.b || {}) } };
    this.decks = { a: [...(snap.decks?.a || STARTER_DECK)], b: [...(snap.decks?.b || STARTER_DECK)] };
    this.poses = { ...(snap.poses || {}) };
    this.missed = { a: 0, b: 0, ...(snap.missed || {}) };
    this.revealed = [...(snap.revealed || [])];
    this.phase = snap.phase || 'lobby';
    this.result = snap.result || null;
  }
}

/** One phone duel from the lobby to the last rematch. Called by main.js when screens.title() came back with
 *  mode 'mp' (or with a snapshot to resume). Returns when the host leaves the arena. */
export async function runMultiplayer({ screens, stage, battle, dialogue, bridge, ext, mp, hp = MP_HP, resume = null }) {
  const { room, players, decks, poses } = mp;
  // The lobby builds the MpHost (so the drawer can kick and swap seats before beat one); a resume builds one
  // here from the snapshot. Either way there is exactly one host for the life of the room.
  const host = mp.host || new MpHost(room, { players, decks, poses });
  if (poses) host.poses = { ...poses };
  if (resume) host.hydrate(resume);
  let carry = resume?.match || null;       // the match state to rebuild the first fight from, once
  session.set({ mode: 'mp', host, room, where: 'fight' });
  snapshot.setUrlRoom(room.code);
  try {
    while (true) {
      const startHp = { a: Number(settings.get('hpA')) || hp, b: Number(settings.get('hpB')) || hp };
      const A = { name: host.name('a'), title: SIDE_NAME.a, hp: startHp.a };
      const B = { id: 'rival', name: host.name('b'), title: SIDE_NAME.b, hp: startHp.b, round: 1, deck: host.decks.b,
                  counters: Number(settings.get('countersB')) || 0, profile: null };
      battle.show(true);
      const match = new Match({
        stage, battle, dialogue, bridge, player: A, opponent: B,
        playerDeck: host.decks.a, counters: Number(settings.get('countersA')) || 0, tutorial: false, ext,
        poses: host.poses,
        mode: 'mp', controllers: host.controllers(), onPhase: host.hook(), resume: carry,
      });
      carry = null;
      // "Missed plan timers in a row" is a per-fight count: a knight who was away for the last bout starts
      // the next one with a clean sheet (a resumed host would otherwise inherit the old numbers).
      host.missed = { a: 0, b: 0 }; host.overdue = null; host.forfeit = null;
      host.match = match; host.result = null; host.revealed = [];
      if (!match.resume) host.phase = 'plan';
      match.onTimer = (left, total) => host.setTimer(left, total);
      session.set({ match, where: 'fight' });
      const won = await match.run();                      // true = side a won
      session.set({ match: null, where: 'result' });
      if (match.ended === 'quit') break;                  // Host Controls -> Back to title
      if (match.ended === 'restart') { host.revealed = []; host.result = null; host.phase = 'lobby'; host.publish(); stage.reset(); continue; }
      const winner = match.ended === 'draw' ? 'draw' : won ? 'a' : 'b';
      host.hook()('result', { winner, forfeit: host.forfeit }, match);
      host.forfeit = null; host.missed = { a: 0, b: 0 };
      battle.show(false);
      const again = await screens.mpResult({
        winner, names: { a: host.name('a'), b: host.name('b') },
        forfeit: host.result?.forfeit || null,
        ready: () => ({ a: !!host.players.a.ready, b: !!host.players.b.ready }),
        bind: fn => { host.onChange = () => fn(); },
        // The drawer's "Rematch now" skips the wait for both Ready presses, for the same reason the plan
        // timer exists: a player who has walked away must not be able to end the evening.
        expose: start => session.set({ rematch: start }),
      });
      session.set({ rematch: null });
      host.onChange = null;
      if (!again) break;
      host.clearReady(); host.result = null; host.revealed = []; host.phase = 'lobby'; host.publish(); host.save();
      stage.reset();
    }
  } finally {
    session.set({ rematch: null, match: null, host: null, room: null, mode: 'title', where: 'title' });
    host.close(); room.close(); stage.reset();
    snapshot.clear(); snapshot.setUrlRoom(null);
  }
}
