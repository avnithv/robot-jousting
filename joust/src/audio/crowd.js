// Crowd and arena ambience for the festival: a breathing murmur bed, low-level foley (braziers, wind in
// the bunting, the forge, the tavern) and one-shot crowd reactions that swell over it. Procedural only.
// Everything runs through one compressor into the 'amb' bus. The node count is bounded: reactions borrow
// from a fixed pool of formant "voices" and from gated noise layers (roar, claps, stomps); only the rare
// foley accents (a clank, a clink) allocate short-lived nodes through tone()/burst().
//   crowd.start() / crowd.stop()     the bed
//   crowd.setEnergy(0..1)            how worked up the stands are (level, density, pitch of the murmur)
//   crowd.react(kind, intensity)     cheer ooh gasp laugh boo murmur_up drumroll_clap chant ko aww
//   crowd.duck(ms)                   dip the bed for an impact instant (reactions ride over it)
import { initAudio, getBus, noiseBuffer, tone, burst } from './audio.js';

let ctx = null, G = null, timer = null, energy = 0.3;
const POOL = 32, WIND = 0.08, CHAT = 0;                   // voices in the pool, wind base level, (no chopping AM: it sounded like a train)
const BUF = {};                                          // long noise loops, built once per colour
const now = () => ctx.currentTime;
const R = (lo, hi) => lo + Math.random() * (hi - lo);
const RL = (lo, hi) => lo * Math.pow(hi / lo, Math.random());        // log-uniform, for pitches
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
const bq = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const pan = p => { const n = ctx.createStereoPanner(); n.pan.value = p; return n; };
const chain = (...n) => { for (let i = 0; i + 1 < n.length; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
function nz(color = 'white') { if (!BUF[color]) BUF[color] = noiseBuffer(5, color); const s = ctx.createBufferSource(); s.buffer = BUF[color]; s.loop = true; s.start(0, Math.random() * 4.5); G.src.push(s); return s; }
function osc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); G.src.push(o); return o; }

// ---------- automation helpers ----------
const cancel = (p, t) => (p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(t) : p.cancelScheduledValues(t));
function quiet(p, t) { cancel(p, t); p.setTargetAtTime(0.0001, t, 0.003); }        // fast fade from wherever it is
function swell(p, t, a, peak, hold, rel, sus = peak) {                              // rise, settle to sus over hold, decay
  quiet(p, t); t += 0.012; p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
  if (sus !== peak) p.exponentialRampToValueAtTime(sus, t + a + hold); else p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
}
function impulse(sec) {                                                             // decaying noise IR: open air over the stands
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate), pre = Math.floor(ctx.sampleRate * 0.025);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = pre; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * (i - pre) / (n - pre)); }
  return b;
}

// ---------- the voice pool ----------
// A voice is a sawtooth through two formant bandpasses (F1/F2 of a vowel) and a lowpass. It idles at gain 0;
// a shout schedules pitch contour, vowel glide and envelope on it. Three shared vibrato LFOs shake the pitch.
const VOWEL = { ah: [730, 1090], eh: [530, 1840], ih: [390, 1990], oh: [570, 840], oo: [300, 870], mm: [250, 400] };
function makeVoice(i) {
  const o = osc('sawtooth', 150); o.detune.value = R(-35, 35); G.vib[i % 3].connect(o.detune);
  const f1 = bq('bandpass', 700, 5), f2 = bq('bandpass', 1100, 6), lp = bq('lowpass', 3000, 0.7), vca = gain(0);
  o.connect(f1); o.connect(f2); f1.connect(lp); chain(f2, gain(0.6), lp); chain(lp, vca, pan(R(-0.85, 0.85)), G.voices);
  return { o, f1, f2, vca, size: R(0.86, 1.18), busy: 0 };          // size: bigger/smaller mouth shifts the formants
}
function voice(t) { let b = G.pool[0]; for (const v of G.pool) { if (v.busy <= t) return v; if (v.busy < b.busy) b = v; } return b; }   // else steal the one ending soonest
function vowel(v, t, from, to, dur) { [v.f1, v.f2].forEach((fl, k) => { const p = fl.frequency; cancel(p, t); p.setValueAtTime(VOWEL[from][k] * v.size, t); p.exponentialRampToValueAtTime(VOWEL[to][k] * v.size, t + dur); }); }
/** One shout: f0 start pitch, bend = pitch multiplier a quarter way in, end = multiplier at the end. */
function shout(v, t, { f0 = 160, vowel: vw = 'ah', to = vw, a = 0.05, dur = 0.6, peak = 0.4, bend = 1, end = 1 }) {
  quiet(v.vca.gain, t); t += 0.012; a = Math.min(a, dur * 0.4);
  const fr = v.o.frequency; cancel(fr, t); fr.setValueAtTime(f0, t); fr.exponentialRampToValueAtTime(f0 * bend, t + a + dur * 0.25); fr.exponentialRampToValueAtTime(f0 * end, t + dur);
  vowel(v, t, vw, to, dur * 0.6);
  const g = v.vca.gain; g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(peak * 0.55, t + a + dur * 0.45); g.exponentialRampToValueAtTime(0.0001, t + dur);
  v.busy = t + dur + 0.03;
}
/** "ha-ha-ha": n pulses at rate Hz, pitch and level sagging as the breath runs out. */
function laugh(v, t, f0, n, rate, peak) {
  quiet(v.vca.gain, t); t += 0.012; const per = 1 / rate, g = v.vca.gain;
  for (let p = 0; p < n; p++) { const tp = t + p * per, k = 1 - (p / n) * 0.55; g.setValueAtTime(0.0001, tp); g.linearRampToValueAtTime(peak * k, tp + 0.025); g.exponentialRampToValueAtTime(0.0001, tp + per * 0.7); }
  const fr = v.o.frequency; cancel(fr, t); fr.setValueAtTime(f0 * 1.08, t); fr.exponentialRampToValueAtTime(f0 * 0.72, t + n * per);
  vowel(v, t, 'ah', 'eh', n * per); v.busy = t + n * per + 0.1;
}
// crowds of the above: n people with staggered onsets (front-loaded so it piles up, then stragglers)
function shouts(t, n, o) { for (let k = 0; k < n; k++) { const tt = t + Math.pow(Math.random(), 1.4) * (o.spread ?? 0.4); shout(voice(tt), tt, { ...o, f0: RL(o.lo ?? 95, o.hi ?? 360), dur: R(o.d0 ?? 0.5, o.d1 ?? 1.0), peak: (o.peak ?? 0.4) * R(0.6, 1) }); } }
function whoops(t, n, i = 1) { for (let k = 0; k < n; k++) { const tt = t + R(0, 0.9); shout(voice(tt), tt, { f0: RL(260, 460), vowel: 'oo', to: 'ah', a: 0.04, dur: R(0.45, 0.8), peak: 0.32 * i, bend: 1.75, end: 0.85 }); } }
function laughs(t, n, peak = 0.4, spread = 0.5) { for (let k = 0; k < n; k++) { const tt = t + R(0, spread); laugh(voice(tt), tt, RL(120, 380), 4 + Math.floor(R(0, 4)), R(5.5, 8.5), peak * R(0.6, 1)); } }

// ---------- gated noise layers: roar, claps, stomps ----------
function roar(t, a, peak, hold, rel, fmul = 1) {                   // the distant wall of noise under every reaction
  G.roar.forEach((l, k) => {
    const tt = t + k * 0.03 + R(0, 0.04); swell(l.vca.gain, tt, a * R(0.8, 1.3), peak * R(0.7, 1) * (k === 2 ? 0.6 : 1), hold, rel * R(0.8, 1.25), peak * 0.6);
    if (fmul !== 1) { l.bp.frequency.setTargetAtTime(l.f * fmul, tt, 0.1); l.bp.frequency.setTargetAtTime(l.f, tt + a + hold + rel, 0.3); }
  });
}
function clap(t, n, str = 1, spread = 0.03) { for (let k = 0; k < n; k++) { const g = pick(G.claps).gain, tt = t + R(0, spread * 2); g.setValueAtTime(R(0.35, 0.8) * str, tt); g.exponentialRampToValueAtTime(0.0001, tt + R(0.035, 0.06)); } }
function applause(t, dur, perSec, str = 1) { for (let tt = t; tt < t + dur; tt += R(0, 2 / perSec)) clap(tt, 1, str * (0.3 + 0.7 * Math.sin(Math.PI * (tt - t) / dur)), 0.002); }
function stomp(t, n, str = 1, spread = 0.04) {
  for (let k = 0; k < n; k++) { const g = G.stomp.gain, tt = t + R(0, spread); g.setValueAtTime(R(0.5, 1) * str, tt); g.exponentialRampToValueAtTime(0.0001, tt + 0.16); }
  tone('sine', 72, t + spread * 0.5, 0.3, 0.6 * str, G.voices, { slideTo: 38 });
}
function surge(t, amt, rise, hold, fall) { const p = G.surge.gain; cancel(p, t); p.setTargetAtTime(amt, t, rise * 0.4); p.setTargetAtTime(1, t + rise + hold, fall * 0.35); }   // murmur swell/dip
function hush(t, depth, hold, rel) { const p = G.duck.gain; cancel(p, t); p.setTargetAtTime(depth, t, 0.02); p.setTargetAtTime(1, t + hold, rel * 0.3); }

// ---------- reactions ----------
// Every reaction is: a roar swell + a crowd of individual shouts + accents (whoops, claps, stomps) + a surge
// or dip of the murmur bed afterwards so the excitement lingers. i = intensity (0.2..2).
const REACT = {
  cheer(t, i) {
    roar(t, 0.14, 1.1 * i, 0.45 * i, 1.5 + 0.5 * i);
    shouts(t, Math.round(12 + 10 * i), { spread: 0.45, vowel: 'eh', to: 'ah', bend: 1.25, end: 0.92, d0: 0.5, d1: 1.2, peak: 0.4 });
    whoops(t + 0.1, Math.round(2 + 3 * i), i); applause(t + 0.3, 1.2 + i * 0.5, 14 * i, 0.5); surge(t, 1.35, 0.3, 1.2, 2);
  },
  ooh(t, i) { roar(t, 0.06, 0.9 * i, 0.15, 0.9, 0.8); shouts(t, Math.round(10 + 6 * i), { spread: 0.12, vowel: 'oh', to: 'oo', bend: 0.93, end: 0.7, d0: 0.45, d1: 0.85, peak: 0.4, a: 0.04 }); surge(t, 1.25, 0.15, 0.5, 1.5); },
  gasp(t, i) {
    const l = G.roar[1]; swell(l.vca.gain, t, 0.04, 0.8 * i, 0.04, 0.22);                     // the intake: a rising hiss
    l.bp.frequency.setValueAtTime(700, t); l.bp.frequency.exponentialRampToValueAtTime(2800, t + 0.3); l.bp.frequency.setTargetAtTime(l.f, t + 0.5, 0.2);
    shouts(t, 5 + Math.round(3 * i), { spread: 0.08, lo: 190, hi: 400, vowel: 'ih', to: 'ih', bend: 1.3, end: 1.35, d0: 0.16, d1: 0.28, peak: 0.2, a: 0.03 });
    hush(t + 0.32, 0.1, 0.7, 1.5);                                                              // ...then the stands go quiet
    shouts(t + 1.1, 5, { spread: 1.0, lo: 100, hi: 220, vowel: 'mm', to: 'mm', d0: 0.2, d1: 0.4, peak: 0.09 });   // whispers
  },
  laugh(t, i) { laughs(t, Math.round(8 + 6 * i), 0.4 * i, 0.5); roar(t + 0.05, 0.15, 0.4 * i, 0.4, 0.8); surge(t, 1.2, 0.2, 0.6, 1.5); },
  boo(t, i) { roar(t, 0.35, 0.65 * i, 1.0, 1.2, 0.55); shouts(t, Math.round(12 + 8 * i), { spread: 0.6, lo: 85, hi: 210, vowel: 'oo', to: 'oo', bend: 1.02, end: 0.88, d0: 1.0, d1: 1.8, peak: 0.4, a: 0.25 }); surge(t, 1.2, 0.4, 1.5, 2); },
  murmur_up(t, i) {                                                                             // anticipation: the bed rises and brightens, nobody shouts yet
    surge(t, 1 + 0.7 * i, 1.0, 1.4, 2.5); G.boost = t + 2.5;
    G.mv.forEach(v => { const f = v.f * (1 + 0.35 * energy); v.bp.frequency.setTargetAtTime(f * 1.3, t, 0.5); v.bp.frequency.setTargetAtTime(f, t + 2.5, 0.8); });
    roar(t, 0.9, 0.35 * i, 0.6, 1.5, 0.8);
    shouts(t, Math.round(6 + 4 * i), { spread: 1.0, lo: 105, hi: 260, vowel: 'mm', to: 'oh', bend: 1.12, end: 1.2, d0: 0.5, d1: 1.0, peak: 0.14, a: 0.2 });
  },
  drumroll_clap(t, i, dur = 1.05) {                                                            // accelerating clap, 4.5 -> 10 Hz, big final clap + stomp + "hey"
    let tt = t; while (tt < t + dur) { const p = (tt - t) / dur; clap(tt, Math.round(4 + 6 * p), (0.3 + 0.6 * p) * i, 0.04 - 0.025 * p); tt += 1 / (4.5 + 5.5 * p); }
    clap(t + dur, 16, i, 0.03); stomp(t + dur, 6, 0.8 * i, 0.04);
    shouts(t + dur, 6, { spread: 0.06, vowel: 'eh', to: 'eh', bend: 1.1, end: 0.95, d0: 0.16, d1: 0.28, peak: 0.32, a: 0.02 });
    roar(t, dur, 0.6 * i, 0.15, 0.9); surge(t, 1.4, 0.4, dur + 0.5, 1.5);
  },
  chant(t, i) {                                                                                 // stomp stomp CLAP (rest), 108 bpm, with a "hey" on the clap
    const beat = 60 / 108, bars = i >= 1.5 ? 4 : 2;
    for (let b = 0; b < bars; b++) {
      const tb = t + b * 4 * beat; stomp(tb, 8, 0.9 * i, 0.04); stomp(tb + beat, 8, 0.9 * i, 0.04); clap(tb + 2 * beat, 14, i, 0.03);
      shouts(tb + 2 * beat, 5, { spread: 0.05, vowel: 'eh', to: 'eh', bend: 1.08, end: 0.95, d0: 0.15, d1: 0.25, peak: 0.3, a: 0.02 });
    }
    roar(t, 0.4, 0.35 * i, bars * 4 * beat, 1.2); surge(t, 1.3, 0.4, bars * 4 * beat, 1.5);
  },
  ko(t, i) {                                                                                    // the grandstand jumps: stomp thud, huge roar, second wave, long applause
    stomp(t, 12, i, 0.06); roar(t + 0.02, 0.1, 1.6 * i, 1.2, 2.6);
    shouts(t, 22, { spread: 0.5, vowel: 'eh', to: 'ah', bend: 1.3, end: 0.95, d0: 0.8, d1: 1.6, peak: 0.48 }); whoops(t + 0.15, 6, 1.3);
    shouts(t + 1.1, 12, { spread: 0.6, vowel: 'eh', to: 'ah', bend: 1.2, end: 0.9, d0: 0.7, d1: 1.4, peak: 0.4 }); whoops(t + 1.4, 4, 1.1);
    applause(t + 0.6, 2.6, 28, 0.8); surge(t, 1.6, 0.3, 2.5, 3);
  },
  aww(t, i) {                                                                                   // sagging "awww", then the bed dips and a few polite claps
    shouts(t, Math.round(10 + 6 * i), { spread: 0.35, vowel: 'ah', to: 'oh', bend: 1.0, end: 0.72, d0: 0.9, d1: 1.5, peak: 0.36, a: 0.15 });
    roar(t, 0.2, 0.6 * i, 0.5, 1.3, 0.8); surge(t + 1.2, 0.7, 0.5, 1.5, 2); applause(t + 1.4, 1.0, 5, 0.35);
  },
};

// ---------- the bed: event streams ----------
// Each stream fires at s.next and returns the (randomised) gap to its next event; tick() keeps them ~0.4 s ahead.
function breathe(t) { const v = pick(G.mv); v.vca.gain.setTargetAtTime(v.lvl * R(0.4, 1.15), t, R(0.5, 1.5)); return R(0.35, 0.9); }
const BABBLE_V = ['ah', 'eh', 'oh', 'oo', 'mm', 'ih'];
function babble(t) {                                                  // the murmur itself: hundreds of quiet, short, half-heard words
  const n = 1 + Math.round(energy * 2 + Math.random());
  for (let k = 0; k < n; k++) { const tt = t + R(0, 0.1); shout(voice(tt), tt, { f0: RL(85, 300), vowel: pick(BABBLE_V), to: pick(BABBLE_V), a: R(0.015, 0.04), dur: R(0.07, 0.26), peak: (0.08 + 0.1 * energy) * R(0.5, 1), bend: R(0.9, 1.15), end: R(0.8, 1.15) }); }
  return 0.04 + (1 - energy) * 0.1;
}
function blip(t) {                                                    // one person in the stands says something
  const e = energy, r = Math.random();
  if (r < 0.62) shout(voice(t), t, { f0: RL(100, 330), vowel: pick(['mm', 'ah', 'oh', 'eh']), to: 'mm', bend: R(0.9, 1.15), end: R(0.8, 1.05), a: 0.03, dur: R(0.12, 0.3), peak: R(0.05, 0.1) * (0.7 + e) });
  else if (r < 0.88) {                                                // two syllables
    const f0 = RL(100, 330); shout(voice(t), t, { f0, vowel: 'ah', to: 'eh', bend: 1.1, end: 0.95, a: 0.03, dur: R(0.1, 0.18), peak: R(0.06, 0.1) });
    const t2 = t + R(0.16, 0.26); shout(voice(t2), t2, { f0: f0 * R(0.85, 1.1), vowel: 'eh', to: 'mm', end: 0.85, a: 0.03, dur: R(0.15, 0.3), peak: R(0.05, 0.09) });
  }
  else if (e > 0.35) shout(voice(t), t, { f0: RL(250, 450), vowel: 'oo', to: 'ah', a: 0.04, dur: R(0.3, 0.5), peak: 0.1 + 0.1 * e, bend: 1.6, end: 0.85 });   // someone yells
  return R(0.35, 1.5) / (1 + 4 * e + (t < G.boost ? 2 : 0));
}
function laughter(t) { laughs(t, 1 + Math.floor(R(0, 3)), 0.12 + 0.1 * energy, 0.6); return R(5, 14) / (0.6 + energy); }
function crackle(t) {                                                 // brazier: filtered clicks, alternating sides, the odd pop
  const c = G.crackle, pop = Math.random() < 0.06;
  c.bp.frequency.setValueAtTime(pop ? R(600, 1200) : R(1800, 7000), t); c.pan.pan.setValueAtTime(Math.random() < 0.5 ? -0.6 : 0.6, t);
  const g = c.gate.gain, pk = pop ? R(0.25, 0.4) : R(0.04, 0.18); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(pk, t + 0.0015); g.exponentialRampToValueAtTime(0.0001, t + (pop ? 0.05 : 0.004 + Math.random() * 0.025));
  if (pop) burst('brown', t, 0.07, 0.12, G.foley, { f: 220, type: 'lowpass' });
  return 0.02 + Math.pow(Math.random(), 2.2) * 0.7;
}
function gust(t) {                                                    // wind rises, brightens, and the bunting flaps in its window
  const dur = R(1.5, 4), str = R(0.4, 1), w = G.wind;
  w.vca.gain.setTargetAtTime(WIND * (1 + 1.8 * str), t, dur * 0.3); w.vca.gain.setTargetAtTime(WIND, t + dur * 0.55, dur * 0.35);
  w.bp.frequency.setTargetAtTime(900 * (1 + 0.8 * str), t, dur * 0.3); w.bp.frequency.setTargetAtTime(900, t + dur * 0.55, dur * 0.4);
  const g = G.flap.gain; for (let tt = t + dur * 0.15; tt < t + dur * 0.9; tt += R(0.06, 0.16)) { const win = Math.sin(Math.PI * (tt - t) / dur) * str; g.setValueAtTime(0.0001, tt); g.linearRampToValueAtTime(R(0.1, 0.3) * win, tt + 0.004); g.exponentialRampToValueAtTime(0.0001, tt + R(0.02, 0.04)); }
  return dur + R(12, 28);
}
function clank(t, base, str) {                                        // hammer on anvil, far off: inharmonic partials, mostly reverb
  for (const [m, p, d] of [[1, 0.5, 1], [1.51, 0.35, 0.8], [2.27, 0.22, 0.5], [3.06, 0.14, 0.4], [4.13, 0.07, 0.3]]) tone('sine', base * m, t, R(0.35, 0.8) * d, 0.05 * p * str, G.far, { detune: R(-15, 15) });
  burst('white', t, 0.03, 0.05 * str, G.far, { f: 3200, q: 1 });
}
function forge(t) { const n = pick([1, 2, 2, 3]), base = R(520, 900), str = R(0.5, 1); for (let k = 0; k < n; k++) clank(t + k * R(0.28, 0.36), base, str * (k === n - 1 ? 1 : 0.6)); return R(8, 22); }
function clink(t) { const f = RL(2000, 3400); for (const [m, p] of [[1, 1], [1.83, 0.55], [2.72, 0.3]]) tone('sine', f * m, t, R(0.18, 0.4), 0.035 * p, G.far, { detune: R(-20, 20) }); burst('white', t, 0.012, 0.03, G.far, { f: 5000, q: 1 }); }
function door(t) {                                                    // hinge creak, thud, and a little hubbub spills out
  tone('sawtooth', R(700, 1000), t, 0.4, 0.02, G.far, { slideTo: R(1100, 1500), filter: { type: 'bandpass', f: 1400, q: 4 } });
  tone('triangle', 150, t + 0.45, 0.14, 0.2, G.far, { slideTo: 70 }); burst('brown', t + 0.45, 0.1, 0.15, G.far, { f: 300, type: 'lowpass' });
  shouts(t + 0.05, 4, { spread: 0.35, lo: 110, hi: 300, vowel: 'ah', to: 'eh', d0: 0.15, d1: 0.3, peak: 0.1, a: 0.03 }); laughs(t + 0.2, 1, 0.12, 0.1);
}
function tavern(t) { const r = Math.random(); if (r < 0.6) { clink(t); if (Math.random() < 0.4) clink(t + R(0.08, 0.14)); } else if (r < 0.8) door(t); else laughs(t, 2 + Math.floor(R(0, 3)), 0.14, 0.4); return R(5, 16); }
function tick() { const h = now() + 0.4; for (const s of G.streams) while (s.next < h) { const t = Math.max(s.next, now() + 0.01); s.next = t + Math.max(0.01, s.fire(t) || 1); } }

// ---------- graph ----------
//   murmur voices -> murmur (energy) -> surge -> duck -+
//   foley (braziers, wind, far accents) --------------+-> comp -> out -> amb bus
//   pool voices, roar, claps, stomps -> voices --------+   ^
//                                        `-> send -> reverb -+
function build() {
  const g = G = { src: [], boost: 0 };
  g.out = gain(1); g.comp = ctx.createDynamicsCompressor(); g.comp.threshold.value = -10; g.comp.knee.value = 10; g.comp.ratio.value = 4; g.comp.attack.value = 0.003; g.comp.release.value = 0.25;
  chain(g.comp, g.out, getBus('amb'));
  g.duck = gain(1); g.surge = gain(1); g.murmur = gain(0.5); chain(g.murmur, g.surge, g.duck, g.comp);
  g.foley = gain(1); g.foley.connect(g.duck); g.voices = gain(1.4); g.voices.connect(g.comp);
  g.rev = ctx.createConvolver(); g.rev.buffer = impulse(1.7); chain(g.rev, bq('lowpass', 2400, 0.5), g.comp);
  g.send = gain(0.22); chain(g.voices, g.send, g.rev);
  g.far = gain(1); g.far.connect(g.foley); chain(g.far, gain(0.9), g.rev);                     // distant things: dry (ducked) + mostly wet
  g.chat = [0.3, 0.5].map(r => chain(nz(), bq('lowpass', r, 0.6), gain(CHAT)));                 // (kept for the API; gain 0: no chop)
  g.vib = [5.1, 6.2, 7.1].map((r, i) => chain(osc('sine', r), gain(18 + i * 10)));            // cents
  // murmur bed: five bands of noise, each breathing on its own, panned across the stands, plus room tone
  // the hiss of many mouths: a few gentle high bands, no modulation, no low end (the babble below carries the crowd)
  g.mv = [[1400, 1.2, 0.035, -0.6], [2100, 1.4, 0.03, 0.1], [3200, 1.6, 0.02, 0.6]].map(([f, q, lvl, p]) => {
    const bp = bq('bandpass', f, q), vca = gain(lvl); chain(nz(), bp, vca, pan(p), g.murmur); return { bp, vca, f, lvl };
  });
  g.roar = [[700, -0.5], [1100, 0.5], [1600, 0]].map(([f, p], i) => { const bp = bq('bandpass', f, 0.8), am = gain(1), vca = gain(0); g.chat[i % 2].connect(am.gain); chain(nz(), bp, am, vca, pan(p), g.voices); return { bp, vca, f }; });
  g.pool = []; for (let i = 0; i < POOL; i++) g.pool.push(makeVoice(i));
  g.claps = [[1500, -0.6], [2000, -0.2], [2600, 0.25], [3300, 0.65]].map(([f, p]) => { const gate = gain(0); chain(nz(), bq('bandpass', f, 1.1), gate, pan(p), g.voices); return gate; });
  g.stomp = gain(0); chain(nz('brown'), bq('lowpass', 140, 0.7), g.stomp, g.voices);
  // foley
  g.crackle = { bp: bq('bandpass', 4000, 1.5), gate: gain(0), pan: pan(-0.6) }; chain(nz(), g.crackle.bp, g.crackle.gate, g.crackle.pan, g.foley);
  g.wind = { bp: bq('bandpass', 900, 0.4), vca: gain(WIND) }; chain(nz(), g.wind.bp, g.wind.vca, pan(0.2), g.foley);   // a light breeze, high and quiet
  g.flap = gain(0); chain(nz(), bq('bandpass', 2600, 2.5), g.flap, pan(0.5), g.foley);
  g.streams = [[0, breathe], [0.05, babble], [0.5, blip], [4, laughter], [0.2, crackle], [9, gust], [6, forge], [4, tavern]].map(([next, fire]) => ({ next, fire }));
}

export const crowd = {
  start() {
    ctx = initAudio(); if (G) return;
    build(); const t = now(); for (const s of G.streams) s.next += t + 0.1;
    crowd.setEnergy(energy); G.out.gain.setValueAtTime(0.0001, t); G.out.gain.exponentialRampToValueAtTime(1, t + 1.5);
    tick(); timer = setInterval(tick, 120);
  },
  stop() {
    if (!G) return; const g = G, t = now(); clearInterval(timer); timer = null; G = null;
    g.out.gain.cancelScheduledValues(t); g.out.gain.setTargetAtTime(0.0001, t, 0.15);
    setTimeout(() => { for (const s of g.src) { try { s.stop(); } catch (e) { /* already stopped */ } } g.out.disconnect(); }, 700);
  },
  setEnergy(e) {
    energy = clamp(e, 0, 1); if (!G) return; const t = now();
    G.murmur.gain.setTargetAtTime(0.35 + 0.5 * energy, t, 0.4);
    for (const v of G.mv) v.bp.frequency.setTargetAtTime(v.f * (1 + 0.35 * energy), t, 0.5);
    for (const c of G.chat) c.gain.setTargetAtTime(CHAT * (0.6 + 0.8 * energy), t, 0.4);
  },
  react(kind, intensity = 1) { if (!G) return; const fn = REACT[kind]; if (!fn) { console.warn('crowd: unknown reaction', kind); return; } fn(now() + 0.02, clamp(intensity, 0.2, 2)); },
  duck(ms = 90) { if (!G) return; hush(now(), 0.2, ms / 1000, 0.4); },
  get running() { return !!G; },
  get energy() { return energy; },
  get output() { return G && G.out; },        // for the lab's meter
};
export const REACTIONS = Object.keys(REACT);
