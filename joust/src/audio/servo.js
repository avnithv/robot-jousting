// Robot-arm foley: servo whine, gear chatter, settle clunks and blade impacts synthesised from the real joint
// trajectories (assets/motions/moves.json, built by tools/make_moves.py from the arm's move library), so the
// screen sound follows the physical motion beat for beat. Builds on audio.js (never edits it): one persistent
// voice per arm (6 joints x (1 oscillator + 1 noise source)) reused every beat, transients as tiny one-shots,
// everything on ctx.currentTime, the whole layer through its own limiter into the sfx bus.
//
//   await loadMoves();                                   // once, any time (caches; falls back to synthetic profiles)
//   playMove('ATTACK_HIGH', { beatMs, arm: 'a' });       // at the start of a beat, next to stage.playBeat
//   playTrajectory(t, q, { rate, onTime });              // any (t, q) at any speed, e.g. a dashboard scrubber
//   oneShot('impact_block', { pan: 0.5 });               // transients that layer with audio.js's sfx
import { getCtx, getBus, noise } from './audio.js';

const DT = 0.02;                         // the library is 50 Hz
const PAN = { a: -0.55, b: 0.55 };       // default stereo seat per arm
const ARM_KIND = { attack: 'impact_hit', block: 'settle', feint: 'settle' };   // transient at a move's `impact`
const ALIAS = { hit: 'impact_hit', block: 'impact_block', none: null };
// Per joint: hum = motor fundamental [Hz at a crawl, Hz per deg/s], whine = gear band [Hz, Hz per deg/s],
// w = loudness weight, vmax = flat-out speed (deg/s; %/s for the jaw), clunk = settle knock pitch.
// Base joints are lower and heavier, the wrist higher and lighter, the jaw a short zip.
const PROFILE = [
  { name: 'pan', hum: [105, 0.45], whine: [1500, 5.0], w: 1.0, vmax: 300, clunk: 140 },
  { name: 'lift', hum: [115, 0.50], whine: [1650, 5.5], w: 1.1, vmax: 300, clunk: 120 },
  { name: 'elbow', hum: [135, 0.50], whine: [1900, 6.0], w: 0.9, vmax: 300, clunk: 165 },
  { name: 'wrist', hum: [165, 0.55], whine: [2400, 6.0], w: 0.7, vmax: 320, clunk: 220 },
  { name: 'roll', hum: [185, 0.60], whine: [2700, 6.0], w: 0.6, vmax: 330, clunk: 260 },
  { name: 'jaw', hum: [210, 0.40], whine: [3000, 4.0], w: 0.5, vmax: 420, clunk: 330 },
];
export const JOINTS = PROFILE.map(p => p.name);

let ctx = null, limiter = null, out = null, outGain = 1, voices = {}, moves = null, loading = null, collect = null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- output chain (lazy: audio.js must have been initialised on a user gesture) ----------
function engine() {
  const c = getCtx(); if (!c) return null;
  if (c !== ctx) {
    ctx = c; voices = {};
    // Peak control, not squash: a fast 8:1 above -6 dB catches the sum of two arms + transients without flattening the
    // thwacks into the whine (the node's automatic makeup gain is mild at these settings); TRIM seats it under sfx.hit.
    limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 8; limiter.attack.value = 0.0015; limiter.release.value = 0.06;
    out = ctx.createGain(); out.gain.value = TRIM * outGain; limiter.connect(out); out.connect(getBus('sfx'));
  }
  return ctx;
}
const TRIM = 0.7;
/** Overall level of the servo layer (0..1.5); the lab's master slider. */
export function setGain(g) { outGain = g; if (out) out.gain.setTargetAtTime(TRIM * g, ctx.currentTime, 0.02); }
/** The layer's output node (after the limiter), for meters. */
export function getOutput() { return engine() ? out : null; }
function panner(pan) { const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain(); if (p.pan) p.pan.value = clamp(pan, -1, 1); return p; }

// One arm's voice, built once and kept: per joint a sawtooth (motor) into a lowpass (hum) and, mixed with hiss,
// into a resonant bandpass (gear whine). Four automated params per joint: motor Hz, whine Hz, hum gain, whine gain.
function voice(key) {
  if (voices[key]) return voices[key];
  const pan = panner(0), g = ctx.createGain();
  const joints = PROFILE.map(p => {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = p.hum[0];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.7;
    const gHum = ctx.createGain(); gHum.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.whine[0]; bp.Q.value = 8;
    const mixO = ctx.createGain(); mixO.gain.value = 0.4; const mixN = ctx.createGain(); mixN.gain.value = 1.5;
    const nz = noise('white'); const gWhine = ctx.createGain(); gWhine.gain.value = 0;
    osc.connect(lp); lp.connect(gHum); gHum.connect(g);
    osc.connect(mixO); mixO.connect(bp); nz.connect(mixN); mixN.connect(bp); bp.connect(gWhine); gWhine.connect(g);
    osc.start(); nz.start(0, Math.random() * 1.9);
    return { params: [osc.frequency, bp.frequency, gHum.gain, gWhine.gain] };
  });
  g.connect(pan); pan.connect(limiter);
  return (voices[key] = { pan, g, joints, handle: null });
}
function setCurve(p, arr, at, dur) {   // sample-accurate automation from a sampled array; retry once if a stale curve overlaps
  p.cancelScheduledValues(at);
  try { p.setValueCurveAtTime(arr, at, dur); } catch (e) { p.cancelScheduledValues(0); try { p.setValueCurveAtTime(arr, at, dur); } catch (e2) { console.warn('servo: curve', e2); } }
}
function hold(p, t) { (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(t) : p.cancelScheduledValues(t)); }

// ---------- transient primitives (instant attack, exponential decay, no tails) ----------
function tick(dst, at, { f = 3000, q = 1, dur = 0.01, peak = 0.5, type = 'bandpass', to = null, a = 0.0008 } = {}) {
  const s = noise('white'); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, at); if (to) fl.frequency.exponentialRampToValueAtTime(to, at + dur); fl.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(fl); fl.connect(g); g.connect(dst); s.start(at, Math.random() * 1.9); s.stop(s.end = at + dur + 0.02); s.begin = at; if (collect) collect.push(s); return s;
}
function thump(dst, at, { f = 150, to = 50, dur = 0.09, peak = 0.6, type = 'sine', a = 0.0015 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(dst); o.start(at); o.stop(o.end = at + dur + 0.02); o.begin = at; if (collect) collect.push(o); return o;
}
function whineBlip(dst, at, f0, f1, dur, peak) {   // a lone servo step: sawtooth through the gear band plus hiss
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1600 + f0 * 5, at); bp.frequency.exponentialRampToValueAtTime(1600 + f1 * 5, at + dur); bp.Q.value = 5;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(peak, at + 0.012); g.gain.setValueAtTime(peak, at + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(bp); bp.connect(g); g.connect(dst); o.start(at); o.stop(o.end = at + dur + 0.02); o.begin = at; if (collect) collect.push(o);
  tick(dst, at, { f: 1900 + f0 * 4, to: 1900 + f1 * 4, q: 6, dur, peak: peak * 0.6, a: 0.012 });
}
function chatter(dst, at, j, s) {   // gear backlash at a direction reversal: three ticks in the joint's band and a soft knock
  const p = PROFILE[j];
  for (let i = 0; i < 3; i++) tick(dst, at + i * 0.013, { f: p.whine[0] * (1 + i * 0.12), q: 5, dur: 0.009, peak: (0.22 - i * 0.05) * s * p.w });
  thump(dst, at, { f: p.clunk * 1.3, to: p.clunk * 0.8, dur: 0.03, peak: 0.16 * s * p.w });
}
// The one-shots. Each complements audio.js: sfx.hit / block / clash are the cinematic layer (long thump, metal
// ring); these are the dry physical layer (plastic, short, no ring) that sits underneath or stands alone.
const SHOTS = {
  impact_hit(d, at, s) {      // plastic blade thwack: crack + short body knock + low thump, no ring
    tick(d, at, { f: 5200, type: 'highpass', dur: 0.006, peak: 0.45 * s });
    tick(d, at + 0.001, { f: 1700, q: 0.8, to: 600, dur: 0.05, peak: 0.9 * s });
    thump(d, at, { f: 160, to: 52, dur: 0.11, peak: 0.75 * s });
    thump(d, at + 0.002, { f: 540, to: 380, dur: 0.035, peak: 0.25 * s, type: 'triangle' });
  },
  impact_block(d, at, s) {    // blade on blade / guard: a double knock (tk-tk) with a very short plastic ring
    tick(d, at, { f: 1150, q: 2, dur: 0.03, peak: 0.7 * s });
    tick(d, at + 0.014, { f: 2600, q: 1.5, dur: 0.022, peak: 0.45 * s });
    thump(d, at, { f: 230, to: 95, dur: 0.06, peak: 0.45 * s });
    thump(d, at + 0.004, { f: 1400, to: 1320, dur: 0.07, peak: 0.1 * s, type: 'triangle' });
  },
  clash(d, at, s) {           // both blades meet: the block knock harder, plus the bind rattle as they tremble
    SHOTS.impact_block(d, at, 1.15 * s); thump(d, at, { f: 120, to: 45, dur: 0.12, peak: 0.55 * s });
    [0.02, 0.038, 0.06, 0.088].forEach((dt, i) => tick(d, at + dt, { f: 2300 + i * 350, q: 3, dur: 0.012, peak: (0.32 - i * 0.06) * s }));
  },
  settle(d, at, s, f = 170) {  // a joint hitting its target: backlash tick, then a dry knock at the joint's pitch
    tick(d, at, { f: 3800, type: 'highpass', dur: 0.007, peak: 0.35 * s });
    thump(d, at + 0.001, { f: f * 1.15, to: f * 0.55, dur: 0.05, peak: 0.55 * s });
    thump(d, at + 0.002, { f: f * 2.2, to: f * 1.6, dur: 0.028, peak: 0.18 * s, type: 'triangle' });
  },
  jaw_snap(d, at, s) {         // the gripper shutting: a 45 ms zip up the gear band, then the click of the jaws meeting
    tick(d, at, { f: 2400, to: 4200, q: 4, dur: 0.05, peak: 0.28 * s, a: 0.004 });
    tick(d, at + 0.045, { f: 4500, type: 'highpass', dur: 0.005, peak: 0.5 * s });
    thump(d, at + 0.045, { f: 950, to: 600, dur: 0.02, peak: 0.3 * s });
    thump(d, at + 0.046, { f: 260, to: 150, dur: 0.03, peak: 0.25 * s });
  },
  servo_start(d, at, s) {      // torque on / first step: relay click and a rising whine blip
    tick(d, at, { f: 4000, type: 'highpass', dur: 0.005, peak: 0.3 * s }); whineBlip(d, at + 0.005, 150, 240, 0.14, 0.14 * s);
  },
  servo_stop(d, at, s) {       // falling whine, then the hold click and a small knock
    whineBlip(d, at, 240, 140, 0.11, 0.12 * s); tick(d, at + 0.1, { f: 3200, type: 'highpass', dur: 0.006, peak: 0.28 * s }); thump(d, at + 0.1, { f: 170, to: 90, dur: 0.04, peak: 0.3 * s });
  },
};
export const ONE_SHOTS = Object.keys(SHOTS);
/** Fire a transient: 'impact_hit' | 'impact_block' | 'clash' | 'settle' | 'jaw_snap' | 'servo_start' | 'servo_stop'.
 *  opts: at (ctx time, default now), gain, pan, f (settle pitch). */
export function oneShot(kind, { at, gain = 1, pan = 0, f } = {}) {
  const c = engine(); const fn = SHOTS[ALIAS[kind] ?? kind]; if (!c || !fn) { if (!fn) console.warn('servo: no one-shot', kind); return; }
  const p = panner(pan); p.connect(limiter); fn(p, Math.max(at ?? 0, c.currentTime + 0.005), gain, f);
}

// ---------- trajectory analysis ----------
function uniform(t, q) {   // resample onto the 50 Hz grid unless already on it
  const n = t.length; let ok = true; for (let i = 1; i < n && ok; i++) if (Math.abs(t[i] - t[i - 1] - DT) > 1e-3) ok = false;
  if (ok) return q;
  const m = Math.floor(t[n - 1] / DT + 1e-6) + 1, o = [];
  for (let i = 0, k = 0; i < m; i++) { const tt = i * DT; while (k < n - 2 && t[k + 1] < tt) k++; const a = clamp((tt - t[k]) / Math.max(1e-6, t[k + 1] - t[k]), 0, 1); o.push(q[k].map((v, j) => v + (q[k + 1][j] - v) * a)); }
  return o;
}
/** Joint velocities (deg/s, central differences) and the mechanical events the sound reacts to:
 *  'reverse' (direction flip under speed), 'stop' (fast then still within 150 ms), 'snap' (jaw slamming shut). */
export function analyzeTrajectory(t, q) {
  const Q = uniform(t, q), n = Q.length, dq = PROFILE.map(() => new Float32Array(n)), events = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); dq[j][i] = b > a ? (Q[b][j] - Q[a][j]) / (DT * (b - a)) : 0; }
  for (let j = 0; j < 6; j++) {
    const v = dq[j]; let peak = 0, tPeak = 0, active = false, lastRev = -1, lastStop = -1, lastSnap = -1;
    const stop = tt => { if (peak > 70 && tt - tPeak < 0.22 && tt - lastStop > 0.15 && tt - lastSnap > 0.12) { events.push({ t: tt, type: 'stop', j, s: Math.min(1, peak / 300) }); lastStop = tt; } };
    for (let i = 0; i < n; i++) {
      const s = Math.abs(v[i]), tt = i * DT;
      if (j === 5 && i > 0 && v[i] < -100 && Q[i][5] <= 10 && Q[i - 1][5] > 10) { events.push({ t: tt, type: 'snap', j, s: Math.min(1, -v[i] / 300) }); lastSnap = tt; }
      if (s > 15) { if (!active) { active = true; peak = 0; } if (s > peak) { peak = s; tPeak = tt; } }
      else if (active) { active = false; stop(tt); }
      if (i >= 4 && i < n - 4 && v[i - 1] * v[i + 1] < 0 && tt - lastRev > 0.12) {
        let vb = 0, va = 0; for (let k = 1; k <= 4; k++) { vb = Math.max(vb, Math.abs(v[i - k])); va = Math.max(va, Math.abs(v[i + k])); }
        if (Math.min(vb, va) > 35) { events.push({ t: tt, type: 'reverse', j, s: Math.min(1, (vb + va) / 400) }); lastRev = tt; }
      }
    }
    if (active) stop((n - 1) * DT);   // attacks end on the strike: the clip's last frame is the stop
  }
  events.sort((a, b) => a.t - b.t);
  return { q: Q, dq, n, dt: DT, dur: (n - 1) * DT, events };
}
const analysed = new WeakMap();
const analyse = (t, q) => { let A = analysed.get(q); if (!A) { A = analyzeTrajectory(t, q); analysed.set(q, A); } return A; };

// ---------- playback ----------
const silent = { name: null, at: 0, rate: 1, duration: 0, done: Promise.resolve(), stop() {} };
/** Sound a joint trajectory. t (s) / q (rows of 6) as in moves.json. opts: rate (clip seconds per real second),
 *  gain, pan, arm ('a' | 'b': the voice to use, a new play on the same arm supersedes the old one), at (ctx time),
 *  onTime(clipTime, done) per animation frame, impact (clip s) + kind ('attack' | 'block' | 'feint') or impactKind
 *  ('impact_hit' | 'impact_block' | 'clash' | 'settle' | 'none') for the transient at `impact`. */
export function playTrajectory(t, q, { rate = 1, gain = 1, pan, arm, at, onTime, impact = null, kind = null, impactKind, name = null } = {}) {
  const c = engine(); if (!c || !q || q.length < 2) return silent;
  const key = arm ?? (pan < 0 ? 'a' : pan > 0 ? 'b' : 'c'); if (pan == null) pan = PAN[key] ?? 0;
  const A = analyse(t, q), n = A.n, N = n + 1, secs = A.dur / rate, D = n * DT / rate;
  at = Math.max(at ?? 0, c.currentTime + 0.02);
  const V = voice(key); if (V.handle) V.handle.stop(at - 0.015);   // one servo, one move at a time: the old play ends where this one starts
  V.pan.pan?.setValueAtTime(clamp(pan, -1, 1), at);
  // continuous layer: four curves per joint, one point per library sample plus a final return to rest
  for (let j = 0; j < 6; j++) {
    const p = PROFILE[j], v = A.dq[j], cF = new Float32Array(N), cW = new Float32Array(N), gH = new Float32Array(N), gW = new Float32Array(N); let any = false;
    for (let i = 0; i < n; i++) {
      const s = Math.abs(v[i]) * rate, x = clamp((s - 6) / (p.vmax - 6), 0, 1), loud = p.w * Math.pow(x, 0.6);
      const strain = i ? Math.min(1, Math.abs(Math.abs(v[i]) - Math.abs(v[i - 1])) * rate / DT / 2500) : 0;   // the motor working against inertia
      cF[i] = p.hum[0] + p.hum[1] * s; cW[i] = Math.min(6500, p.whine[0] + p.whine[1] * s);
      gH[i] = gain * (0.12 * loud + (x > 0 ? 0.06 * p.w * strain : 0)); gW[i] = gain * 0.45 * loud * (0.55 + 0.45 * x); if (x > 0) any = true;
    }
    cF[n] = p.hum[0]; cW[n] = p.whine[0]; gH[n] = 0; gW[n] = 0;
    const [fO, fB, gHum, gWh] = V.joints[j].params;
    if (!any) { for (const P of [gHum, gWh]) { P.cancelScheduledValues(at); P.setValueAtTime(0, at); } continue; }
    setCurve(fO, cF, at, D); setCurve(fB, cW, at, D); setCurve(gHum, gH, at, D); setCurve(gWh, gW, at, D);
  }
  // transients: reversals, abrupt stops, jaw snaps, and the move's own impact
  const nodes = []; collect = nodes;
  const ik = impactKind !== undefined ? (ALIAS[impactKind] ?? impactKind) : ARM_KIND[kind] ?? null;
  for (const e of A.events) {
    const te = at + e.t / rate, p = PROFILE[e.j];
    if (e.type === 'reverse') chatter(V.pan, te, e.j, e.s * gain);
    else if (e.type === 'stop') SHOTS.settle(V.pan, te, e.s * gain * p.w * (impact != null && Math.abs(e.t - impact) < 0.08 ? 0.5 : 1), p.clunk);
    else if (e.type === 'snap') SHOTS.jaw_snap(V.pan, te - 0.045, e.s * gain);
  }
  if (impact != null && ik && SHOTS[ik]) SHOTS[ik](V.pan, at + impact / rate, gain * (kind === 'feint' ? 0.6 : 1));   // a feint's stop-dead is lighter than a guard set
  collect = null;
  // the handle
  let stopped = false, raf = 0, timer = 0, finish;
  const end = () => { if (stopped) return; stopped = true; clearTimeout(timer); cancelAnimationFrame(raf); if (V.handle === handle) V.handle = null; finish(); };
  const handle = {
    name, at, rate, duration: secs, done: new Promise(r => (finish = r)),
    /** Silence this play. stop() kills everything now; stop(when) is a queued play cutting in at ctx time `when`:
     *  the whine ends there, but transients already sounding or due within 50 ms (an impact on the beat line) ring out. */
    stop(when) {
      if (stopped) return; const tc = Math.max(c.currentTime, when ?? 0), grace = when == null ? -1 : tc + 0.05;
      for (const jt of V.joints) for (const P of [jt.params[2], jt.params[3]]) { hold(P, tc); P.linearRampToValueAtTime(0, tc + 0.01); }
      for (const s of nodes) if (s.end > tc && s.begin > grace) { try { s.stop(tc); } catch (e) { /* not started or already ended */ } }
      if (tc <= c.currentTime + 0.002) end(); else { clearTimeout(timer); timer = setTimeout(end, (tc - c.currentTime) * 1000); }
    },
  };
  timer = setTimeout(end, (at + secs - c.currentTime) * 1000 + 40);
  if (onTime) { const frame = () => { if (stopped) return; const tc = (c.currentTime - at) * rate, done = tc >= A.dur; onTime(clamp(tc, 0, A.dur), done); if (!done) raf = requestAnimationFrame(frame); }; raf = requestAnimationFrame(frame); }
  V.handle = handle; return handle;
}

/** Fetch and cache the slim move library. Resolves to the library, or null (then everything is synthetic). */
export function loadMoves(url = 'assets/motions/moves.json') {
  if (!loading) loading = fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }).then(m => (moves = m))
    .catch(e => { console.warn('servo: moves not loaded, using synthetic profiles', e); loading = null; return null; });
  return loading;
}
/** The move record used for `name`: { t, q, kind, impact, key_times, synthetic }. */
export function getMove(name) { const m = moves?.[name]; return m ? { ...m, synthetic: false } : { ...synthetic(name), synthetic: true }; }
export function moveNames() { return moves ? Object.keys(moves) : []; }

/** Sound one move over one beat. The clip is time-scaled so its length fits the beat (the real arm plays it at 1x;
 *  screen beats run 1.4-1.6 s). Pass impactAt (fraction of the beat, e.g. stage.IMPACT) to instead pin an attack's
 *  or feint's impact there (sped up if needed, front-padded otherwise); guardAt does the same for a block's settle.
 *  opts: beatMs, gain, pan, arm, at, onTime, impact ('hit' | 'block' | 'clash' | 'settle' | 'none') to override the
 *  transient at the impact instant (the game knows the outcome before the beat animates). */
export function playMove(name, { beatMs = 1400, gain = 1, pan, arm, at, onTime, impactAt = null, guardAt = null, impact } = {}) {
  const c = engine(); if (!c) return silent;
  const m = getMove(name), beat = beatMs / 1000, dur = m.t[m.t.length - 1];
  let rate = dur / beat, delay = 0;
  const pin = m.impact == null ? null : m.kind === 'block' ? guardAt : impactAt;
  if (pin != null) { const want = pin * beat; rate = Math.max(1, m.impact / want); delay = Math.max(0, want - m.impact / rate); }
  return playTrajectory(m.t, m.q, { rate, gain, pan, arm, onTime, name, at: Math.max(at ?? 0, c.currentTime + 0.02) + delay, impact: m.impact, kind: m.kind, impactKind: impact });
}
/** Silence every arm voice now (queued plays included). */
export function stopAll() { for (const V of Object.values(voices)) V.handle?.stop(); }

// ---------- synthetic profiles for moves that are not in the library ----------
// Keyframes [time, q] with cosine easing between keys; the same skeleton as the taught moves (from REST).
const R0 = [-3.6, -89, 47.2, 2.9, 76.3, 7.6], UP = [0, -34, -32, 17, 76, 5], UPJ = [0, -34, -32, 17, 76, 45];
const SYNTH = {
  attack: { keys: [[0, R0], [0.6, UP], [0.85, UPJ], [1.07, [0, -6, -32, 72, 76, 0]]], impact: 1.07 },
  block: { keys: [[0, R0], [0.8, [30, -35, 40, -50, 120, 78]], [1.2, [30, -35, 40, -50, 120, 78]]], impact: 0.8 },
  feint: { keys: [[0, R0], [0.7, UP], [0.95, UPJ], [1.4, R0]], impact: 0.7 },
  stagger: { keys: [[0, R0], [0.3, [15, -77, 67, -22, 76, 8]], [0.7, [-12, -101, 47, 3, 76, 50]], [1.1, [4, -85, 47, 3, 76, 30]], [1.4, R0]], impact: null },
  twirl: { keys: [[0, R0], [0.45, [0, -60, 20, 10, -140, 30]], [1.35, [0, -60, 20, 10, 140, 30]], [1.8, [0, -60, 20, 10, 76, 30]]], impact: null },
  shift: { keys: [[0, R0], [0.5, [0, -60, 20, 10, 76, 30]], [1.0, [0, -60, 20, 10, 76, 30]]], impact: null },
};
const synthCache = {};
function synthetic(name) {
  const n = String(name || '').toUpperCase();
  const kind = /ATTACK|THRUST|SLASH|CHOP|STRIKE|RIPOSTE/.test(n) ? 'attack' : /BLOCK|PARRY|GUARD|BRACE|DODGE/.test(n) ? 'block' : /FEINT/.test(n) ? 'feint' : /STAGGER|HIT_|DEFEAT/.test(n) ? 'stagger' : /TWIRL|SPIN|FLOURISH|VICTORY/.test(n) ? 'twirl' : /REST|^$/.test(n) ? 'rest' : 'shift';
  if (synthCache[kind]) return synthCache[kind];
  if (kind === 'rest') return (synthCache.rest = { kind, t: [0, 0.5], q: [R0, R0], key_times: [0, 0.5], impact: null });
  const { keys, impact } = SYNTH[kind], end = keys[keys.length - 1][0], t = [], q = [];
  for (let i = 0; i * DT <= end + 1e-6; i++) {
    const tt = i * DT; let k = 0; while (k < keys.length - 2 && keys[k + 1][0] <= tt) k++;
    const [t0, a] = keys[k], [t1, b] = keys[k + 1], e = 0.5 - 0.5 * Math.cos(Math.PI * clamp((tt - t0) / (t1 - t0), 0, 1));
    t.push(+tt.toFixed(3)); q.push(a.map((v, j) => v + (b[j] - v) * e));
  }
  return (synthCache[kind] = { kind, t, q, key_times: keys.map(k => k[0]), impact });
}
