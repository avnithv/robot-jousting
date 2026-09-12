// Host settings: everything the Host Controls drawer can change about the NEXT fight, persisted in
// localStorage so the big screen keeps them across a reload (and across a crash mid-tournament).
//
// The audio toggles are not here -- they live in src/audio/audio.js (getPref/setPref), which keeps its own
// localStorage key, because the audio buses have to react the moment one is flipped. Everything else a host
// might want to change between fights is in this one object.
//
//   import * as settings from './settings.js';
//   settings.get('hpA'); settings.set('planTimer', 60); settings.onChange(fn);

const KEY = 'tilt.settings';

export const VOLT_MAX = 2;                       // the rail is two notches, always: shown, never editable
export const PLAN_TIMERS = [0, 30, 60, 90, 120]; // seconds; 0 = off
export const FORFEIT_AFTER = [0, 1, 2, 3];       // missed plan timers before a side forfeits; 0 = off
export const HP_RANGE = [10, 50];
export const COUNTER_RANGE = [0, 3];
export const BEAT_RANGE = [1.0, 2.5];            // seconds, sim mode only (live is pinned to the arm library)

export const DEFAULTS = {
  hpA: 25, hpB: 25,              // starting HP per side (the campaign's side b is the opponent's own number
                                 // unless the host has touched hpB -- see `oppHp` below)
  hpBSet: false,                 // has the host overridden the opponent's own HP?
  countersA: 1, countersB: 1,    // counters each side starts a fight holding
  beatMs: 1500,                  // sim beat length in ms
  planTimer: 0,                  // seconds per planning phase, 0 = off
  opener: '', finale: '',        // the robot scenes used as the opening / finishing pose
  tells: true,                   // campaign: show the opponent's pre-lock twitch (and Marla's read of it)
  chatter: true,                 // campaign: Marla's dialogue at all
  autoForfeit: 0,                // phone duel: forfeit a side after N missed plan timers, 0 = off
};

const NUM = { hpA: HP_RANGE, hpB: HP_RANGE, countersA: COUNTER_RANGE, countersB: COUNTER_RANGE, beatMs: [1000, 2500] };
const ONE_OF = { planTimer: PLAN_TIMERS, autoForfeit: FORFEIT_AFTER };
const BOOL = ['tells', 'chatter', 'hpBSet'];

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

/** Coerce one value into something legal, so a hand-edited localStorage entry can never break a fight. */
export function coerce(k, v) {
  if (BOOL.includes(k)) return !!v;
  if (NUM[k]) { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, NUM[k]) : DEFAULTS[k]; }
  if (ONE_OF[k]) { const n = Number(v); return ONE_OF[k].includes(n) ? n : DEFAULTS[k]; }
  if (k === 'opener' || k === 'finale') return typeof v === 'string' ? v : '';
  return v;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (raw[k] !== undefined) out[k] = coerce(k, raw[k]);
    return out;
  } catch (e) { return { ...DEFAULTS }; }
}

let cur = load();
const subs = new Set();

export function all() { return { ...cur }; }
export function get(k) { return cur[k]; }
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) {} }
function fire(k) { for (const fn of subs) { try { fn(k, cur[k], cur); } catch (e) { console.warn(e); } } }

export function set(k, v) {
  if (!(k in DEFAULTS)) return cur[k];
  const val = coerce(k, v);
  if (cur[k] === val) return val;
  cur[k] = val; if (k === 'hpB') cur.hpBSet = true;
  save(); fire(k);
  return val;
}
/** Set several at once (a snapshot restore, or the drawer's Reset). */
export function merge(obj = {}) { for (const [k, v] of Object.entries(obj)) if (k in DEFAULTS) { cur[k] = coerce(k, v); } save(); fire(null); }
export function reset() { cur = { ...DEFAULTS }; save(); fire(null); }

/** The opponent's starting HP for a campaign fight: whatever the script says, unless the host has set it. */
export function oppHp(scripted) { return cur.hpBSet ? cur.hpB : scripted; }
/** The beat length a sim bridge should use. Live mode is pinned to the move library's own BEAT. */
export function beatMs() { return cur.beatMs; }
