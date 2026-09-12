// Knight foley: the arms sound like a sword fight at a festival, not like servos. Driven by the same 50 Hz
// trajectories as servo.js (whose analysis, move loading and event detection are reused) but every timbre is
// diegetic to the story: the blade's whoosh follows the blade-tip speed, chainmail jingles and leather creaks on
// wind-ups and reversals, armour clanks when a guard sets, the sword cocks with a steel "shing", and impacts are
// steel clangs, shield thuds or the ring of a bind. Same API as servo.js so the game and the dashboard can swap it in.
import { initAudio, getCtx, getBus, noise, env, tone, burst } from './audio.js';
import { loadMoves, getMove, moveNames, analyzeTrajectory, JOINTS } from './servo.js';
export { loadMoves, getMove, moveNames, analyzeTrajectory, JOINTS };

const now = () => getCtx().currentTime;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pickv = arr => arr[Math.floor(Math.random() * arr.length)];   // every sound has variants: no two clangs alike
const D2R = Math.PI / 180;
const L = { upper: 0.116, fore: 0.135, hand: 0.10, blade: 0.18 };   // metres, roughly the SO-101 with the plastic sword

// ---------- output chain (built once): per-arm panners -> limiter -> trim -> sfx bus ----------
let OUT = null, trim = 1;
function out() {
  if (OUT) return OUT; const c = getCtx();
  // pans -> drive (soft saturation: transients get teeth) -> limiter -> trim -> sfx bus, plus a short dark room in parallel
  const drive = c.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * 1.9) / Math.tanh(1.9); } drive.curve = curve; drive.oversample = '2x';
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -6; lim.ratio.value = 10; lim.attack.value = 0.0015; lim.release.value = 0.16; lim.knee.value = 3;
  const g = c.createGain(); g.gain.value = 1.0 * trim; drive.connect(lim); lim.connect(g); g.connect(getBus('sfx'));
  const room = c.createDelay(0.2); room.delayTime.value = 0.061; const rfb = c.createGain(); rfb.gain.value = 0.42; const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 1800; const rg = c.createGain(); rg.gain.value = 0.22;
  room.connect(rlp); rlp.connect(rfb); rfb.connect(room); rlp.connect(rg); rg.connect(lim);
  const pans = {}; for (const [k, p] of [['a', -0.55], ['b', 0.55], ['c', 0]]) { const sp = c.createStereoPanner(); sp.pan.value = p; sp.connect(drive); sp.connect(room); pans[k] = sp; }
  return (OUT = { lim, g, pans, drive });
}
const dst = (arm, pan) => { const o = out(); if (pan != null) { const c = getCtx(); const sp = c.createStereoPanner(); sp.pan.value = pan; sp.connect(o.drive); return sp; } return o.pans[arm] || o.pans.c; };
export function setGain(v) { trim = clamp(v, 0, 2); if (OUT) OUT.g.gain.setTargetAtTime(1.0 * trim, now(), 0.05); }
export function getOutput() { return OUT && OUT.g; }

// ---------- timbres ----------
// Steel on steel: inharmonic partials with a crack and a body thump. `bright` shifts the partials up, `ring` the decay.
const CLANGS = [{ f0: 1050, bright: 1, ring: 0.7 }, { f0: 880, bright: 1.05, ring: 0.95 }, { f0: 1240, bright: 0.94, ring: 0.5 }, { f0: 1120, bright: 1.12, ring: 0.8 }, { f0: 960, bright: 0.9, ring: 1.1 }];
function clang(t, d, { f0, gain = 0.5, ring, bright, thump = 0.4 } = {}) {
  const v = pickv(CLANGS); f0 = f0 ?? v.f0; ring = ring ?? v.ring; bright = bright ?? v.bright;
  const parts = [[1, 1], [1.47, 0.6], [2.09, 0.45], [2.56, 0.3], [3.31, 0.22], [4.2, 0.12]];
  for (const [r, a] of parts) tone('sine', f0 * r * bright * rnd(0.995, 1.005), t, ring * (1.1 - r * 0.12), gain * a * 0.75, d, { a: 0.002 });
  burst('white', t, 0.05, gain * 1.2, d, { f: 5000, q: 0.6, type: 'highpass' });
  burst('white', t, 0.14, gain * 0.5, d, { f: 2600, q: 1.2 });
  burst('white', t, 0.03, gain * 0.7, d, { f: 900, q: 0.7 });   // the crack of the blow itself
  if (thump) { sub(t, d, gain * thump * 1.1); tone('sine', 110, t, 0.18, gain * thump * 1.2, d, { slideTo: 44 }); burst('brown', t, 0.12, gain * thump, d, { f: 260, type: 'lowpass' }); }
}
// Sub thump under every impact: felt more than heard.
function sub(t, d, gain = 0.6) { tone('sine', 62, t, 0.28, gain, d, { slideTo: 30, a: 0.003 }); tone('triangle', 48, t + 0.005, 0.2, gain * 0.5, d, { slideTo: 28 }); }
// A blow landing on padded plate: dull, heavy, short.
function thud(t, d, gain = 0.6) { sub(t, d, gain * 0.9); tone('sine', 95, t, 0.24, gain * 1.1, d, { slideTo: 38 }); burst('brown', t, 0.2, gain * 1.2, d, { f: 300, type: 'lowpass' }); burst('white', t, 0.06, gain * 0.4, d, { f: 1600, q: 0.8 }); burst('white', t, 0.02, gain * 0.5, d, { f: 4000, q: 0.5, type: 'highpass' }); }
// Chainmail: a cloud of tiny high pings with scattered onsets.
function jingle(t, d, s = 0.6, spread = 0.09) { const n = Math.round(5 + 9 * s); for (let i = 0; i < n; i++) { const tt = t + Math.random() * spread; tone(Math.random() < 0.5 ? 'sine' : 'triangle', rnd(2600, 7800), tt, rnd(0.03, 0.08), (0.025 + 0.05 * s) * rnd(0.5, 1), d, { a: 0.001 }); } burst('white', t, 0.06, 0.06 * s, d, { f: 6500, q: 1.5, type: 'highpass' }); }
// Armour clank: a plate knock with a short low ring.
function clank(t, d, s = 0.6) { const v = pickv([[700, 165, 1850], [560, 140, 2300], [900, 190, 1500], [780, 150, 2100]]); burst('white', t, 0.06, 0.28 * s, d, { f: v[0], q: 1.0 }); tone('sine', v[1], t, 0.12, 0.3 * s, d, { slideTo: v[1] * 0.72 }); tone('sine', v[2] * rnd(0.97, 1.03), t, 0.18, 0.08 * s, d); tone('sine', 2740, t, 0.12, 0.05 * s, d); jingle(t + 0.01, d, 0.35 * s, 0.05); }
// The sword cocks: a rising steel whisper with a thin ring.
function shing(t, d, s = 0.7) { burst('white', t, 0.16, 0.35 * s, d, { f: 2400, q: 5, slideTo: 8200 }); tone('sine', 5300 * rnd(0.98, 1.02), t + 0.04, 0.22, 0.06 * s, d); tone('sine', 7900, t + 0.05, 0.16, 0.03 * s, d); }
// A short swish for a feint's snap-back.
function swish(t, d, s = 0.6, dur = 0.16) { const v = pickv([[700, 2600, 1.1], [900, 3400, 0.8], [500, 1800, 1.5], [1200, 2200, 2]]); burst('white', t, dur, 0.4 * s, d, { f: v[0], q: v[2], slideTo: v[1] }); if (Math.random() < 0.4) burst('white', t + dur * 0.5, dur * 0.7, 0.18 * s, d, { f: v[1], q: 1, slideTo: v[0] }); }
// A grunt of leather and cloth: slow creak.
function creak(t, d, dur = 0.35, s = 0.5) { burst('brown', t, dur, 0.22 * s, d, { f: 900, q: 2.2, slideTo: 1300 }); burst('white', t, dur, 0.05 * s, d, { f: 3000, q: 0.7 }); }
// Foot / body weight shifting in the lists.
function stomp(t, d, s = 0.6) { burst('brown', t, 0.14, 0.6 * s, d, { f: 300, type: 'lowpass' }); tone('sine', 70, t, 0.18, 0.35 * s, d, { slideTo: 32 }); burst('white', t, 0.05, 0.1 * s, d, { f: 3500, q: 0.8 }); }
function bind(t, d, s = 0.8) { clang(t, d, { f0: 980, gain: 0.7 * s, ring: 1.0, bright: 1 }); clang(t + 0.012, d, { f0: 1240, gain: 0.5 * s, ring: 0.9, bright: 1.1, thump: 0.3 }); for (let i = 0; i < 5; i++) burst('white', t + 0.06 + i * 0.035, 0.03, 0.12 * s, d, { f: rnd(3000, 6000), q: 3 }); }

export const ONE_SHOTS = ['impact_hit', 'impact_block', 'clash', 'settle', 'jaw_snap', 'servo_start', 'servo_stop', 'whoosh', 'stomp', 'jingle'];
export function oneShot(kind, { at, gain = 1, pan, arm } = {}) {
  initAudio(); const t = at ?? now() + 0.01, d = dst(arm, pan);
  switch (kind) {
    case 'impact_hit': {   // steel on plate, a glancing double, or a heavy wham into the padding
      const v = pickv(['clang', 'double', 'wham']);
      if (v === 'clang') { clang(t, d, { gain: 0.8 * gain, ring: 0.7 }); thud(t + 0.005, d, 0.6 * gain); }
      else if (v === 'double') { clang(t, d, { gain: 0.7 * gain, ring: 0.55 }); clang(t + 0.045, d, { gain: 0.45 * gain, ring: 0.45, bright: 1.15, thump: 0 }); thud(t + 0.01, d, 0.5 * gain); }
      else { thud(t, d, 1.0 * gain); sub(t, d, 0.5 * gain); clang(t + 0.008, d, { gain: 0.4 * gain, ring: 0.4, thump: 0 }); jingle(t + 0.03, d, 0.8 * gain, 0.1); }
      break; }
    case 'impact_block': {   // a parry ring, a shield thud, or a scraping bind
      const v = pickv(['ring', 'shield', 'scrape']);
      if (v === 'ring') { clang(t, d, { f0: 1350, gain: 0.7 * gain, ring: 0.55, bright: 1.08, thump: 0.35 }); thud(t + 0.01, d, 0.35 * gain); }
      else if (v === 'shield') { thud(t, d, 0.8 * gain); burst('white', t, 0.09, 0.55 * gain, d, { f: 1200, q: 0.8 }); clang(t + 0.005, d, { f0: 1500, gain: 0.35 * gain, ring: 0.35, thump: 0 }); }
      else { clang(t, d, { f0: 1300, gain: 0.45 * gain, ring: 0.45, thump: 0.2 }); for (let i = 0; i < 6; i++) burst('white', t + 0.03 + i * 0.03, 0.035, 0.14 * gain, d, { f: rnd(2500, 5500), q: 4 }); }
      break; }
    case 'clash': bind(t, d, gain * 1.2); sub(t, d, 0.7 * gain); break;
    case 'settle': case 'servo_stop': clank(t, d, 0.7 * gain); break;
    case 'jaw_snap': shing(t, d, 0.8 * gain); break;
    case 'servo_start': case 'jingle': jingle(t, d, 0.7 * gain); break;
    case 'whoosh': swish(t, d, 0.9 * gain, 0.26); break;
    case 'stomp': stomp(t, d, gain); break;
    default: console.warn('foley: unknown one-shot', kind);
  }
}

// ---------- motion -> speed profiles ----------
// Blade-tip and hand speed from a planar chain (lift, elbow, wrist in series) plus the pan sweep and the
// sword pivoting on the jaw. Signs and exact link lengths matter little for a foley envelope.
function tipSpeed(A) {
  const n = A.n, v = new Float32Array(n), body = new Float32Array(n);
  let px = 0, py = 0, pz = 0;
  for (let i = 0; i < n; i++) {
    const q = A.q[i]; const a1 = q[1] * D2R, a2 = a1 + q[2] * D2R, a3 = a2 + q[3] * D2R, pan = q[0] * D2R, jaw = q[5] * 1.18 * D2R;
    const r = L.upper * Math.sin(a1) + L.fore * Math.sin(a2) + L.hand * Math.sin(a3) + L.blade * Math.sin(a3 + jaw);   // reach
    const z = L.upper * Math.cos(a1) + L.fore * Math.cos(a2) + L.hand * Math.cos(a3) + L.blade * Math.cos(a3 + jaw);
    const x = r * Math.cos(pan), y = r * Math.sin(pan);
    if (i) { v[i] = Math.hypot(x - px, y - py, z - pz) / A.dt; } px = x; py = y; pz = z;
    body[i] = (Math.abs(A.dq[0][i]) + Math.abs(A.dq[1][i]) + Math.abs(A.dq[2][i]) + 0.6 * Math.abs(A.dq[3][i])) / 300;
  }
  if (n > 1) v[0] = v[1];
  return { tip: v, body };
}

// ---------- playback ----------
const silent = { name: null, at: 0, rate: 1, duration: 0, done: Promise.resolve(), stop() {} };
const voices = {};   // per arm: the current handle (a new play on the same arm supersedes the old one)

/** Sound a joint trajectory. Same options as servo.js: rate (clip s per real s), gain, pan, arm, at (ctx time of
 *  clip t=0), offset (skip the first clip seconds, for scrubbing / resuming), onTime(clipTime, done), impact (clip s),
 *  kind ('attack' | 'block' | 'feint' | 'rest'), impactKind ('impact_hit' | 'impact_block' | 'clash' | 'settle' | 'none'). */
export function playTrajectory(t, q, { rate = 1, gain = 1, pan, arm = 'c', at, offset = 0, onTime, impact = null, kind = null, impactKind, name = null } = {}) {
  initAudio(); const c = getCtx(); if (!c) return silent;
  const A = analyzeTrajectory(t, q); const S = tipSpeed(A);
  const t0 = at ?? c.currentTime + 0.03; const d = dst(arm, pan);
  const clipToCtx = ct => t0 + (ct - offset) / rate;
  const dur = (A.dur - offset) / rate; if (dur <= 0.02) return silent;
  const nodes = [];
  // continuous layers: blade air (bandpassed noise following tip speed) and cloth / leather (slow body motion)
  const N = Math.max(2, Math.round(dur * 100)); const air = new Float32Array(N), airF = new Float32Array(N), cloth = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const ct = offset + (k / (N - 1)) * (A.dur - offset); const i = clamp(Math.round(ct / A.dt), 0, A.n - 1);
    const sp = S.tip[i] * rate;                                   // real m/s once time-scaled
    const a = clamp((sp - 0.5) / 2.4, 0, 1);
    air[k] = Math.pow(a, 1.3) * 1.0 * gain; airF[k] = 380 + 2400 * a; cloth[k] = clamp(S.body[i] * rate, 0, 1.2) * 0.2 * gain;
  }
  const mk = (color, f, Q, type, curve, fcurve) => {
    const s = noise(color); const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = Q; const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.setValueCurveAtTime(curve, t0, dur); if (fcurve) fl.frequency.setValueCurveAtTime(fcurve, t0, dur);
    s.connect(fl); fl.connect(g); g.connect(d); s.start(t0); s.stop(t0 + dur + 0.05); nodes.push(s, g); return g;
  };
  mk('white', 1200, 0.8, 'bandpass', air, airF);
  mk('brown', 700, 0.7, 'lowpass', air.map(v => v * 0.9), null);   // the low body of the swing
  mk('brown', 1400, 0.7, 'lowpass', cloth, null);
  // discrete events from the analysis (only those inside the played window)
  let moving = false, lastOn = -1;
  for (let i = 0; i < A.n; i++) {
    const ct = i * A.dt; if (ct < offset) continue; const b = S.body[i];
    if (!moving && b > 0.2 && ct - lastOn > 0.25) { moving = true; lastOn = ct; const tt = clipToCtx(ct); jingle(tt, d, 0.5 * gain, 0.12); if (S.body[Math.min(A.n - 1, i + 8)] < 0.6) creak(tt, d, 0.3, 0.6 * gain); }
    else if (moving && b < 0.08) moving = false;
  }
  for (const e of A.events) {
    if (e.t < offset) continue; const tt = clipToCtx(e.t), s = e.s * gain;
    if (e.type === 'reverse') { jingle(tt, d, 0.45 + 0.5 * s, 0.08); if (e.s > 0.55) clank(tt + 0.01, d, 0.35 * s); }
    else if (e.type === 'stop') { clank(tt, d, 0.5 + 0.5 * s); }
    else if (e.type === 'snap') { shing(tt, d, 0.6 + 0.4 * s); }
  }
  // the impact: what the blade does at the end of the swing
  const imp = impact ?? null; const k = impactKind || (kind === 'attack' ? 'impact_hit' : kind === 'block' ? 'settle' : kind === 'feint' ? 'swish' : 'none');
  if (imp != null && imp >= offset && k !== 'none') {
    const tt = clipToCtx(imp);
    if (k === 'swish') { swish(tt, d, 0.8 * gain, 0.18); jingle(tt + 0.05, d, 0.5 * gain); }
    else oneShot(k, { at: tt, gain, arm, pan });
  }
  // handle
  let stopped = false; const endAt = t0 + dur + 0.6; let raf = 0;
  const done = new Promise(res => { const tick = () => { if (stopped) return res(false); const ct = offset + (c.currentTime - t0) * rate; if (onTime) onTime(clamp(ct, offset, A.dur), c.currentTime >= endAt); if (c.currentTime >= endAt) return res(true); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); });
  const handle = {
    name, at: t0, rate, duration: dur, done,
    stop(when) { if (stopped) return; stopped = true; cancelAnimationFrame(raf); const tc = Math.max(c.currentTime, when ?? c.currentTime); for (const n of nodes) { try { if (n.gain) { n.gain.cancelScheduledValues(tc); n.gain.setTargetAtTime(0.0001, tc, 0.03); } else n.stop(tc + 0.08); } catch (e) { /* already ended */ } } },
  };
  if (voices[arm]) { try { voices[arm].stop(t0 - 0.01); } catch (e) {} } voices[arm] = handle;
  return handle;
}

/** Play a library move so that it fits the game's beat. impactAt / guardAt (fractions of the beat) pin the impact;
 *  impact ('hit' | 'block' | 'clash' | undefined) says what the blade met. Unknown names get a synthetic swing/guard. */
export function playMove(name, { beatMs = 1400, gain = 1, pan, arm = 'c', at, impactAt = null, guardAt = null, impact, onTime } = {}) {
  initAudio(); const c = getCtx(); if (!c) return silent;
  const m = getMove(name) || synthetic(name); if (!m) return silent;
  const beat = beatMs / 1000, kind = m.kind || (/ATTACK/.test(name) ? 'attack' : /BLOCK|PARRY|BRACE/.test(name) ? 'block' : /FEINT/.test(name) ? 'feint' : 'rest');
  const clipDur = m.t[m.t.length - 1]; let rate = clipDur / beat, t0 = at ?? c.currentTime + 0.03;
  const pin = kind === 'block' ? guardAt : impactAt;
  if (pin != null && m.impact != null) { const want = pin * beat; if (m.impact / rate > want) rate = m.impact / want; else { rate = Math.max(rate, 1); t0 += want - m.impact / rate; } }
  const impactKind = impact === 'hit' ? 'impact_hit' : impact === 'block' ? 'impact_block' : impact === 'clash' ? 'clash' : undefined;
  return playTrajectory(m.t, m.q, { rate, gain, pan, arm, at: t0, onTime, impact: m.impact, kind, impactKind, name });
}
// A rough stand-in for moves not yet taught: a two-key swing / guard / feint shaped by name.
function synthetic(name) {
  const rest = [0, -89, 47, 3, 76, 8], N = 60, t = [], q = [];
  const key = /THRUST/.test(name) ? [0, -30, 10, 20, 76, 0] : /PARRY|BLOCK|BRACE/.test(name) ? [20, 40, -50, -60, 90, 60] : /TWIRL|STAGGER/.test(name) ? [25, -40, 30, 10, 140, 30] : /WIND/.test(name) ? [0, -20, -30, 10, 76, 70] : [0, -6, -32, 72, 76, 0];
  const kind = /PARRY|BLOCK|BRACE/.test(name) ? 'block' : /TWIRL|STAGGER|WIND/.test(name) ? 'feint' : 'attack';
  for (let i = 0; i < N; i++) { const s = i / (N - 1); const e = kind === 'attack' ? Math.pow(s, 2.2) : 0.5 - 0.5 * Math.cos(Math.PI * s); t.push(i * 0.02); q.push(rest.map((r, j) => r + (key[j] - r) * e)); }
  return { t, q, kind, impact: kind === 'attack' ? 1.18 : 0.9 };
}
export function stopAll() { for (const k of Object.keys(voices)) { try { voices[k].stop(); } catch (e) {} delete voices[k]; } }
