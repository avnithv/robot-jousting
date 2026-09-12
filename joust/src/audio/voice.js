// Character voices: garbled synthesised speech ("Tiltfordese") for the cast. Each speaker is a small formant
// model: a glottal source (saw/pulse, a little breath noise) -> two vowel formants + a low "body" band ->
// colour (angry drive / the Champion's crush + ring-mod / the Herald's nasal peak) -> gentle lowpass -> voice bus.
// The tract is built once per speaker and speech is nothing but AudioParam automation on it (setTargetAtTime
// only, so no clicks), which makes a whole line cost zero node churn and lets syllables glide into each other.
//   blip(ch, progress, end, voice, mood)        per-letter drop-in for dialogue.js (sound as letters are typed)
//   say(text, { voice, mood, charMs, onChar })  schedules a whole line on the audio clock and drives the
//                                               typewriter from it, so text and sound stay locked
//   vocalize(kind, voice, mood)                 laugh / gasp / hmm / cheer / grunt / ouch / yield
import { getCtx, getBus, getPref, noise } from './audio.js';

// ---------- cast ----------
// base: f0 (Hz). range: melodic span (semitones). walk: step of the per-word pitch walk. speed: syllable length
// (say() also types at this speed). detune: chorus spread (cents). formant: scales the vowel formants (small
// throat = high). q: formant sharpness. body: low-band warmth. breath: aspiration mix. wobble: vibrato depth.
// lp: lowpass ceiling. contour: how much punctuation bends the pitch (0 = monotone). jitter: per-syllable random.
export const VOICES = {
  marla:    { id: 'marla',    name: 'Marla',             base: 225, range: 3.5, walk: 1.0, speed: 1.0,  wave: 'sawtooth', detune: 7, formant: 1.0,  q: 6.5, body: 0.35, breath: 0.12, wobble: 0.004, lp: 3300, gain: 1.0,  attack: 0.012 },
  squire:   { id: 'squire',   name: 'Bluebell',          base: 400, range: 5.0, walk: 1.4, speed: 0.72, wave: 'sawtooth', detune: 0, formant: 1.2,  q: 5.0, body: 0.2,  breath: 0.18, wobble: 0.006, lp: 3500, gain: 0.78, attack: 0.008 },
  percival: { id: 'percival', name: 'Sir Percival',      base: 118, range: 3.0, walk: 0.8, speed: 1.28, wave: 'sawtooth', detune: 0, formant: 0.86, q: 7.5, body: 0.5,  breath: 0.06, wobble: 0.003, lp: 2600, gain: 1.3,  attack: 0.02 },
  champion: { id: 'champion', name: 'The Iron Champion', base: 96,  range: 0,   walk: 0,   speed: 1.15, wave: 'square',   detune: 0, formant: 0.9,  q: 7,   body: 0.3,  breath: 0,    wobble: 0,     lp: 3000, gain: 1.1,  attack: 0.006, contour: 0.15, jitter: 0, machine: { carrier: 211, bits: 5, mix: 0.6 } },
  lionheart:{ id: 'lionheart', name: 'Lionheart',         base: 150, range: 4.0, walk: 1.1, speed: 1.02, wave: 'sawtooth', detune: 5, formant: 0.92, q: 7,   body: 0.45, breath: 0.08, wobble: 0.004, lp: 3000, gain: 1.15, attack: 0.014 },
  herald:   { id: 'herald',   name: 'The Herald',        base: 185, range: 4.5, walk: 1.3, speed: 1.1,  wave: 'sawtooth', detune: 4, formant: 1.05, q: 7,   body: 0.15, breath: 0.05, wobble: 0.01,  lp: 3500, gain: 1.0,  attack: 0.015, nasal: { f: 2500, db: 7, q: 2.5 } },
};
// Moods multiply / add to the profile. drive: waveshaper harshness. lift: extra semitones. singsong: alternating walk.
export const MOODS = {
  neutral: {},
  excited: { pitch: 1.14, range: 1.5, speed: 0.8, gain: 1.15, wobble: 0.004, lift: 1.5 },
  worried: { pitch: 0.93, range: 0.7, speed: 1.2, gain: 0.9,  wobble: 0.03, breath: 0.15, jitter: 3 },
  angry:   { pitch: 1.03, range: 1.1, speed: 0.9, gain: 1.15, drive: 0.7, breath: 0.05, plosive: 1.5 },
  sly:     { pitch: 0.98, range: 1.3, speed: 1.1, gain: 0.7,  breath: 0.12, singsong: true },
};
/** Voice for a cast id: 'marla' | 'squire' | 'knight' / 'percival' | 'champion' | 'herald'. */
export function voiceFor(id) { return VOICES[{ knight: 'percival' }[id] || id] || VOICES.marla; }
function eff(voice, mood) {   // profile with the mood folded in
  const m = MOODS[mood] || MOODS.neutral;
  return { ...voice, mood, base: voice.base * (m.pitch || 1), range: voice.range * (m.range || 1), speed: voice.speed * (m.speed || 1), gain: voice.gain * (m.gain || 1),
    wobble: voice.wobble + (m.wobble || 0), breath: Math.min(0.5, voice.breath + (m.breath || 0)), jitter: (voice.jitter ?? 0.25) * (m.jitter || 1),
    contour: voice.contour ?? 1, drive: m.drive || 0, plosive: m.plosive || 1, lift: m.lift || 0, singsong: !!m.singsong && voice.range > 0 };
}

// ---------- phonemes ----------
// Vowel formants [F1, F2] in Hz at formant scale 1 (average adult), and each vowel's intrinsic pitch (semitones).
const VOWELS = { a: [730, 1090], e: [530, 1840], i: [270, 2290], o: [570, 840], u: [300, 870], y: [300, 2100] };
const PITCH = { a: 0, e: 0.3, i: 1.0, o: -0.4, u: 0.5, y: 0.8 };
// Consonants by class. plo: click burst (f, q, lvl; vo = voiced bar). fri: noise band for dur. asp: breath.
// nas / gli: voiced with their own formants. Strings are aliases. Digraphs (sh, th, ch, ng, ph, wh) come first.
const CONS = {
  p: { k: 'plo', f: 700, q: 1.2, lvl: 0.6 }, b: { k: 'plo', f: 600, q: 1.2, lvl: 0.45, vo: 1 }, t: { k: 'plo', f: 2600, q: 1.0, lvl: 0.45 }, d: { k: 'plo', f: 2000, q: 1.0, lvl: 0.35, vo: 1 },
  k: { k: 'plo', f: 1500, q: 1.4, lvl: 0.55 }, g: { k: 'plo', f: 1200, q: 1.4, lvl: 0.45, vo: 1 }, c: 'k', q: 'k', j: { k: 'plo', f: 2000, q: 1, lvl: 0.35, vo: 1 }, ch: { k: 'plo', f: 2300, q: 0.9, lvl: 0.45, dur: 0.05 },
  s: { k: 'fri', f: 3100, q: 1.6, lvl: 0.2, dur: 0.08 }, z: { k: 'fri', f: 2900, q: 1.6, lvl: 0.16, dur: 0.07, vo: 1 }, sh: { k: 'fri', f: 2200, q: 1.0, lvl: 0.24, dur: 0.09 }, x: { k: 'fri', f: 2600, q: 1.2, lvl: 0.24, dur: 0.07 },
  f: { k: 'fri', f: 1300, q: 0.6, lvl: 0.24, dur: 0.07 }, v: { k: 'fri', f: 1100, q: 0.6, lvl: 0.16, dur: 0.06, vo: 1 }, th: { k: 'fri', f: 1800, q: 0.8, lvl: 0.2, dur: 0.07 }, ph: 'f',
  h: { k: 'asp', dur: 0.06 }, wh: 'w',
  m: { k: 'nas', F: [250, 1000] }, n: { k: 'nas', F: [280, 1400] }, ng: { k: 'nas', F: [260, 1200] },
  l: { k: 'gli', F: [400, 1200] }, r: { k: 'gli', F: [420, 1250] }, w: { k: 'gli', F: [300, 700] },
};
const FLOOR = 0.0001;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.6;
const semis = (f, st) => f * Math.pow(2, st / 12);
const tgt = (p, val, t, tau) => p.setTargetAtTime(val, Math.max(0, t), tau);
const curves = {};
function curve(key, fn) { if (curves[key]) return curves[key]; const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1); return (curves[key] = c); }
const driveCurve = d => curve('d' + d, x => Math.tanh(x * (1 + 6 * d)) / Math.tanh(1 + 6 * d));
const crushCurve = bits => { const s = Math.pow(2, bits - 1); return curve('c' + bits, x => Math.round(x * s) / s); };

// ---------- the tract ----------
function makeTract(v, dest) {
  const c = getCtx(); const T = { v, src: [] };
  const g = val => { const n = c.createGain(); n.gain.value = val; return n; };
  const filt = (type, f, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  T.in = g(1); T.f1 = filt('bandpass', 500 * v.formant, v.q); T.f2 = filt('bandpass', 1500 * v.formant, v.q * 1.2); T.body = filt('lowpass', 380 * v.formant, 0.6);
  T.sum = g(0.7 * v.gain);
  T.in.connect(T.f1).connect(g(1)).connect(T.sum); T.in.connect(T.f2).connect(g(0.55)).connect(T.sum); T.in.connect(T.body).connect(g(v.body)).connect(T.sum);
  let node = T.sum;
  if (v.drive) { const sh = c.createWaveShaper(); sh.curve = driveCurve(v.drive); node = node.connect(sh).connect(g(0.5)); }   // the curve is normalised, so trim after it
  if (v.machine) {   // amplitude-quantised, ring-modulated against an inharmonic carrier, a little dry kept for intelligibility
    const sh = c.createWaveShaper(); sh.curve = crushCurve(v.machine.bits); node.connect(sh);
    const ring = g(0), car = c.createOscillator(); car.frequency.value = v.machine.carrier; car.connect(ring.gain); T.src.push(car);
    const mix = g(1); sh.connect(ring).connect(g(v.machine.mix)).connect(mix); sh.connect(g(1 - v.machine.mix)).connect(mix); node = mix;
  }
  if (v.nasal) { const pk = filt('peaking', v.nasal.f, v.nasal.q); pk.gain.value = v.nasal.db; node.connect(pk); node = pk; }
  T.lp = filt('lowpass', v.lp, 0.7); T.out = g(1); node.connect(T.lp).connect(T.out).connect(dest);
  // glottal source: one or two detuned oscillators gated by the voicing envelope, vibrato on their detune
  T.voiced = g(FLOOR); T.voiced.connect(T.in);
  T.o1 = c.createOscillator(); T.o1.type = v.wave; T.o1.frequency.value = v.base; T.o1.connect(T.voiced); T.src.push(T.o1);
  if (v.detune) { T.o2 = c.createOscillator(); T.o2.type = v.wave; T.o2.frequency.value = v.base; T.o2.detune.value = v.detune; T.o1.detune.value = -v.detune; T.o2.connect(g(0.6)).connect(T.voiced); T.src.push(T.o2); }
  if (v.wobble) { const lfo = c.createOscillator(); lfo.frequency.value = 5.2; const lg = g(v.wobble * 1200); lfo.connect(lg); lg.connect(T.o1.detune); if (T.o2) lg.connect(T.o2.detune); T.src.push(lfo); }
  // noise: breath goes through the formants (aspiration), hiss bypasses them (fricatives, plosive bursts)
  const nz = noise('white'); T.src.push(nz);
  T.breath = g(FLOOR); nz.connect(filt('bandpass', 1200, 0.5)).connect(T.breath).connect(T.in);
  T.hissBp = filt('bandpass', 2000, 1); T.hiss = g(FLOOR); nz.connect(T.hissBp).connect(T.hiss).connect(T.sum);
  for (const s of T.src) s.start();
  return T;
}
function killTract(T, at, fade = 0.08) {   // fade the output at clock time `at`, then stop the sources
  const c = getCtx(); tgt(T.out.gain, FLOOR, at, fade / 3);
  setTimeout(() => { for (const s of T.src) { try { s.stop(); } catch (e) { /* already stopped */ } } T.out.disconnect(); }, Math.max(0, (at - c.currentTime + fade + 0.15) * 1000));
}
/** Voiced segment: formants F=[F1,F2] (Hz at scale 1), pitch f0, level; optional glides to Fto / f0to. Voicing stays
 *  on unless rel is given: mid-word segments just re-target and the next one picks up where this left off. */
function voiced(T, t, dur, F, f0, lvl, { Fto = null, f0to = null, atk = T.v.attack, rel = 0 } = {}) {
  const v = T.v, k = v.formant;
  tgt(T.f1.frequency, F[0] * k, t, 0.012); tgt(T.f2.frequency, F[1] * k, t, 0.012);
  if (Fto) { tgt(T.f1.frequency, Fto[0] * k, t + dur * 0.35, dur * 0.2); tgt(T.f2.frequency, Fto[1] * k, t + dur * 0.35, dur * 0.2); }
  tgt(T.o1.frequency, f0, t, 0.012); if (T.o2) tgt(T.o2.frequency, f0, t, 0.012);
  if (f0to) { tgt(T.o1.frequency, f0to, t + dur * 0.3, dur * 0.3); if (T.o2) tgt(T.o2.frequency, f0to, t + dur * 0.3, dur * 0.3); }
  tgt(T.voiced.gain, lvl, t, atk / 3); tgt(T.breath.gain, lvl * v.breath, t, atk / 3);
  if (rel) { tgt(T.voiced.gain, FLOOR, t + dur, rel / 3); tgt(T.breath.gain, FLOOR, t + dur, rel / 3); }
}
/** Unvoiced burst: a band of noise past the formants. */
function hiss(T, t, dur, f, q, lvl, atk = 0.003, rel = 0.02) {
  tgt(T.hissBp.frequency, f, t, 0.002); tgt(T.hissBp.Q, q, t, 0.002);
  tgt(T.hiss.gain, lvl, t, atk / 3); tgt(T.hiss.gain, FLOOR, t + dur, rel / 3);
}
/** Lower the voicing: closure before a plosive, off for a fricative, off at a word end. */
function dip(T, t, to, tau = 0.006) { tgt(T.voiced.gain, Math.max(FLOOR, to), t, tau); tgt(T.breath.gain, FLOOR, t, tau); }
/** One consonant at t. avail: seconds until the next letter shows. f0 / lvl: the current pitch and level. */
function consonant(T, t, C, avail, f0, lvl) {
  const v = T.v, s = v.speed;
  if (C.k === 'plo') { dip(T, t - 0.022, lvl * 0.1); hiss(T, t, C.dur || 0.022, C.f, C.q, C.lvl * 0.5 * v.plosive); if (C.vo) voiced(T, t + 0.004, 0.03, [300, 900], f0 * 0.92, lvl * 0.45, { atk: 0.008 }); }
  else if (C.k === 'fri') { dip(T, t - 0.01, lvl * (C.vo ? 0.35 : 0.08)); hiss(T, t, Math.min(C.dur * s, avail + 0.03), C.f, C.q, C.lvl, 0.012, 0.03); }
  else if (C.k === 'asp') { dip(T, t - 0.01, lvl * 0.1); tgt(T.breath.gain, 0.4, t, 0.006); tgt(T.breath.gain, FLOOR, t + Math.min(C.dur * s, avail + 0.02), 0.01); hiss(T, t, 0.05, 1000, 0.4, 0.12, 0.01, 0.03); }
  else voiced(T, t, Math.max(0.03, avail), C.F, f0, lvl * (C.k === 'nas' ? 0.6 : 0.75), { atk: 0.01 });   // nasals and glides hum through
}

// ---------- melody ----------
// A pitch walk picks a new target (semitones) per word and each syllable moves partway toward it, so lines have
// a tune; punctuation adds a contour on top (statements fall, ? rises at the end, ! sits higher and louder).
function walker() { return { target: 0, cur: 0, sign: 1, lastF0: 0, lastLvl: 0.8 }; }
function nextWord(S, v) { if (v.range <= 0) { S.target = 0; return; } if (v.singsong) { S.sign = -S.sign; S.target = S.sign * v.range * 0.8 + gauss() * v.range * 0.2; } else S.target = clamp(S.target * 0.45 + gauss() * v.range * 0.8 * v.walk, -v.range, v.range); }
function nextSyl(S, v) { S.cur += (S.target - S.cur) * 0.55 + gauss() * v.jitter; return S.cur; }
function contour(end, p, v) {   // [semitones, level multiplier] at progress p (0..1) through the sentence
  let st, g = 1;
  if (end === '?') st = p < 0.6 ? -0.6 * p : -0.36 + 6.5 * (p - 0.6) / 0.4;
  else if (end === '!') { st = 1.5 + 1.2 * Math.sin(p * Math.PI) + (p > 0.85 ? 1.5 : 0); g = 1.2; }
  else st = -1.2 * p - (p > 0.85 ? 2.5 * (p - 0.85) / 0.15 : 0);
  return [(st + v.lift) * v.contour, g];
}
const SMALL = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'and', 'or', 'but', 'is', 'it', 'me', 'my', 'so', 'be', 'as', 'do', 'if', 'up', 'em', 'ya', 'for', 'its']);
function wordShape(w) { if (w.length > 1 && w === w.toUpperCase()) return { st: 3, g: 1.35 }; if (SMALL.has(w.toLowerCase())) return { st: -0.8, g: 0.85 }; return { st: 0, g: 1 }; }   // SHOUTED words, little words
const lookup = (a, b) => { let C = CONS[a + b]; const two = !!C; if (!C) C = CONS[a]; if (typeof C === 'string') C = CONS[C]; return [C, two ? 2 : 1]; };

// ---------- blip: per-letter, live ----------
const live = new Map();   // voice profile -> its running tract and walk state (rebuilt when the mood changes)
function speaker(voice, mood) {
  let L = live.get(voice);
  if (L && L.mood !== mood) { killTract(L.T, getCtx().currentTime, 0.05); L = null; }
  if (!L) { const v = eff(voice, mood); L = { mood, v, T: makeTract(v, getBus('voice')), S: walker(), n: 0 }; nextWord(L.S, v); live.set(voice, L); }
  return L;
}
/** Sound for one typed character. progress: 0..1 through the line; sentenceEnd: '.', '!' or '?'. */
export function blip(ch, progress = 0, sentenceEnd = '.', voice = VOICES.marla, mood = 'neutral') {
  const c = getCtx(); if (!c || !getPref('voice') || c.state !== 'running' || !ch) return;
  const L = speaker(voice, mood), { v, T, S } = L, t = c.currentTime + 0.004, lc = ch.toLowerCase();
  if (!/[a-z]/.test(lc)) { if (/[\s,;:.!?]/.test(ch)) { nextWord(S, v); L.n = 0; } return; }
  // the previous letter's pending release must not cut this one short: drop everything scheduled past now
  for (const p of [T.voiced.gain, T.breath.gain, T.hiss.gain, T.o1.frequency, T.f1.frequency, T.f2.frequency]) p.cancelScheduledValues(t);
  if (T.o2) T.o2.frequency.cancelScheduledValues(t);
  tgt(T.hiss.gain, FLOOR, t, 0.01);
  const [cst, cg] = contour(sentenceEnd, progress, v), s = v.speed;
  if (VOWELS[lc]) {
    if (++L.n > 3) { nextWord(S, v); L.n = 1; }
    const st = nextSyl(S, v) + cst + PITCH[lc] * v.contour + (ch !== lc ? 1.5 : 0), f0 = semis(v.base, st), lvl = 0.85 * cg;
    voiced(T, t, 0.1 * s, VOWELS[lc], f0, lvl, { f0to: semis(f0, (v.singsong ? S.sign * 1.5 : -0.7) * v.contour), rel: 0.06 }); S.lastF0 = f0; S.lastLvl = lvl;
  } else {
    const [C] = lookup(lc, ''); if (!C) return;
    consonant(T, t, C, 0.06 * s, S.lastF0 || v.base, S.lastLvl);
    if (C.k === 'nas' || C.k === 'gli') dip(T, t + 0.07 * s, FLOOR, 0.02);
  }
}
/** Silence and drop every live blip() tract (scene change, settings). */
export function hush() { const c = getCtx(); for (const L of live.values()) killTract(L.T, c ? c.currentTime : 0, 0.05); live.clear(); }

// ---------- say: a whole line, scheduled ahead ----------
const delay = (ch, ms) => (/[,;:]/.test(ch) ? 140 : /[.!?]/.test(ch) ? 260 : ch === ' ' ? 24 : ms);   // same pauses as dialogue.js
function sentences(text) {
  const out = []; let start = 0;
  for (let i = 0; i < text.length; i++) if (/[.!?]/.test(text[i]) && !/[.!?]/.test(text[i + 1] || '')) { out.push({ start, end: i, mark: text[i] }); start = i + 1; }
  if (start < text.length) out.push({ start, end: text.length, mark: '.' });
  return out.length ? out : [{ start: 0, end: text.length, mark: '.' }];
}
/** Schedule the speech for `text` on tract T; tm[i] is when character i shows (seconds from t0). */
function schedule(T, text, tm, t0, v) {
  const S = walker(), sent = sentences(text), re = /[A-Za-z]+(?:'[A-Za-z]+)*/g; let si = 0, m;
  while ((m = re.exec(text))) {
    const word = m[0], pos = m.index, L = word.toLowerCase(), wEnd = pos + word.length;
    while (si < sent.length - 1 && pos > sent[si].end) si++;
    const sn = sent[si], p = clamp((wEnd - sn.start) / Math.max(1, sn.end - sn.start), 0, 1), lastWord = !/[A-Za-z]/.test(text.slice(wEnd, sn.end));
    const after = text[wEnd] || '', [cst, cg] = contour(sn.mark, p, v), shape = wordShape(word), nsyl = (L.match(/[aeiouy]+/g) || []).length;
    nextWord(S, v); let syl = 0;
    for (let k = 0; k < L.length;) {
      const ch = L[k], i = pos + k, t = t0 + tm[i];
      if (!VOWELS[ch] && !CONS[ch]) { k++; continue; }   // apostrophes and the like
      if (VOWELS[ch]) {
        let j = k; while (j < L.length && VOWELS[L[j]]) j++;   // the vowel run ("ou", "ee") glides between its ends
        const final = syl === nsyl - 1;
        let st = nextSyl(S, v) + cst + shape.st + PITCH[ch] * v.contour + (syl === 0 && nsyl > 1 ? 1 : 0);
        if (final && /[,;:]/.test(after)) st += 2 * v.contour;   // continuation rise before a comma
        const lvl = 0.85 * cg * shape.g * (syl === 0 ? 1.1 : 1), f0 = semis(v.base, st);
        const glide = final && lastWord ? (sn.mark === '?' ? 3.5 : sn.mark === '!' ? -2 : -1.5) : v.singsong ? S.sign * 1.5 : -0.7;
        let e = j; while (e < L.length && !VOWELS[L[e]]) e++;   // the vowel holds until the word's next vowel (consonants ride on top)
        const tEnd = e < L.length ? t0 + tm[pos + e] : t0 + tm[wEnd] + 0.02 * v.speed;
        voiced(T, t, Math.max(0.04, tEnd - t), VOWELS[ch], f0, lvl, { Fto: j - k > 1 ? VOWELS[L[j - 1]] : null, f0to: semis(f0, glide * v.contour) });
        S.lastF0 = f0; S.lastLvl = lvl; syl++; k = j;
      } else {
        const [C, step] = lookup(ch, L[k + 1] || '');
        if (C) consonant(T, t, C, t0 + tm[i + step] - t, S.lastF0 || v.base, S.lastLvl);
        k += step; while (k < L.length && L[k] === ch) k++;   // tt, ss, ll: one sound
      }
    }
    dip(T, t0 + tm[wEnd] + 0.02 * v.speed, FLOOR, 0.02);   // word end: voicing off
  }
}
/**
 * Speak `text` as one scheduled line. Returns { done, stop() }; `done` resolves true when the line finished,
 * false if stopped (the handle is also thenable). onChar(i, ch) fires when character i should appear, driven by
 * the audio clock, so the typewriter and the voice cannot drift. Typing speed is charMs scaled by the voice's speed.
 */
export function say(text, { voice = VOICES.marla, mood = 'neutral', charMs = 34, onChar = null } = {}) {
  const c = getCtx(), v = eff(voice, mood), ms = charMs * v.speed;
  const tm = new Float64Array(text.length + 1); for (let i = 0; i < text.length; i++) tm[i + 1] = tm[i] + delay(text[i], ms) / 1000;
  const total = tm[text.length], audible = !!c && c.state === 'running' && getPref('voice');
  const clock = audible ? () => c.currentTime : () => performance.now() / 1000;
  const t0 = clock() + 0.03; let T = null;
  if (audible) { T = makeTract(v, getBus('voice')); schedule(T, text, tm, t0, v); }
  let i = 0, ended = false, timer = 0, resolve; const done = new Promise(r => { resolve = r; });
  const finish = ok => { if (ended) return; ended = true; clearTimeout(timer); if (T) killTract(T, clock(), ok ? 0.2 : 0.03); resolve(ok); };
  const tick = () => {
    if (ended) return; const now = clock();
    while (i < text.length && t0 + tm[i] <= now + 0.002) { if (onChar) onChar(i, text[i]); i++; }
    if (i >= text.length && now >= t0 + total) return finish(true);
    timer = setTimeout(tick, Math.max(1, ((i < text.length ? t0 + tm[i] : t0 + total) - now) * 1000 - 1));
  };
  if (!text.length) finish(true); else tick();
  return { done, stop: () => finish(false), then: (a, b) => done.then(a, b) };
}

// ---------- vocalize: non-verbal ----------
/** 'laugh' | 'gasp' | 'hmm' | 'cheer' | 'grunt' | 'ouch' | 'yield' | 'sob' | 'sigh' | 'tut' | 'hmph' |
 *  'giggle' | 'chatter' (the jaw-clack laugh). Returns the sound's length in ms. */
export function vocalize(kind, voice = VOICES.marla, mood = 'neutral') {
  const c = getCtx(); if (!c || !getPref('voice') || c.state !== 'running') return 0;
  const v = eff(voice, mood), T = makeTract(v, getBus('voice')), t = c.currentTime + 0.02, s = v.speed, st = n => semis(v.base, n * v.contour);
  const { a: A, e: E, i: I, o: O, u: U } = VOWELS, HUM = [250, 1000]; let end = t + 0.3;
  const ha = (tt, dur, f, lvl, F = A, o = {}) => { hiss(T, tt, 0.04, 1100, 0.4, 0.12, 0.008, 0.03); tgt(T.breath.gain, 0.35, tt, 0.004); voiced(T, tt + 0.028, dur, F, f, lvl, { atk: 0.01, rel: 0.05, ...o }); };
  switch (kind) {
    case 'laugh': { const n = v.machine ? 3 : 4 + Math.floor(Math.random() * 3), gap = (v.machine ? 0.24 : 0.15) * s; for (let k = 0; k < n; k++) ha(t + k * gap, gap * 0.5, st(5 - k * 1.3 + (Math.random() - 0.5) * 1.5), 0.9 - k * 0.08, k % 2 ? A : O, { f0to: st(3 - k * 1.3) }); end = t + n * gap + 0.1; break; }
    case 'gasp': { hiss(T, t, 0.22 * s, 800, 0.5, 0.3, 0.12, 0.06); tgt(T.hissBp.frequency, 2400, t + 0.04, 0.12); tgt(T.breath.gain, 0.45, t, 0.05); tgt(T.breath.gain, FLOOR, t + 0.24 * s, 0.03); voiced(T, t + 0.17 * s, 0.14 * s, I, st(6), 0.5, { f0to: st(10), atk: 0.04, rel: 0.08 }); end = t + 0.4 * s; break; }
    case 'hmm': { voiced(T, t, 0.5 * s, HUM, st(-1), 0.75, { f0to: st(2), atk: 0.05, rel: 0.12 }); tgt(T.o1.frequency, st(-2.5), t + 0.32 * s, 0.1); if (T.o2) tgt(T.o2.frequency, st(-2.5), t + 0.32 * s, 0.1); end = t + 0.65 * s; break; }
    case 'cheer': { ha(t, 0.5 * s, st(4), 1.0, E, { Fto: A, f0to: st(11), rel: 0.15 }); if (v.machine) ha(t + 0.3 * s, 0.2 * s, st(0), 1.0); end = t + 0.7 * s; break; }
    case 'grunt': { hiss(T, t, 0.02, 700, 1, 0.3); voiced(T, t + 0.008, 0.16 * s, U, st(-2), 0.95, { f0to: st(-7), atk: 0.004, rel: 0.06 }); end = t + 0.25 * s; break; }
    case 'ouch': { voiced(T, t, 0.26 * s, A, st(8), 1.0, { Fto: U, f0to: st(-2), atk: 0.004, rel: 0.1 }); tgt(T.breath.gain, 0.3, t, 0.004); end = t + 0.4 * s; break; }
    case 'yield': { voiced(T, t, 0.7 * s, O, st(1), 0.7, { Fto: U, f0to: st(-11), atk: 0.06, rel: 0.25 }); tgt(T.breath.gain, 0.35, t + 0.3 * s, 0.15); end = t + 0.95 * s; break; }
    // the mope and the dance: crying, tutting, sulking, sniggering
    case 'sob': {   // shuddering in-breath, then a small wet falling note. Three of them, getting smaller.
      const n = 3; for (let k = 0; k < n; k++) { const tt = t + k * 0.44 * s;
        hiss(T, tt, 0.1 * s, 1400, 0.6, 0.1, 0.05, 0.05); tgt(T.breath.gain, 0.42, tt, 0.02);
        voiced(T, tt + 0.13 * s, 0.22 * s, k % 2 ? O : U, st(4 - k * 1.6 + (Math.random() - 0.5)), 0.62 - k * 0.12, { f0to: st(-3 - k * 1.6), atk: 0.03, rel: 0.1 }); }
      end = t + n * 0.44 * s + 0.2; break;
    }
    case 'sigh': {   // the long breath out of someone who is done
      tgt(T.breath.gain, 0.5, t, 0.05); hiss(T, t + 0.05, 0.5 * s, 900, 0.5, 0.07, 0.1, 0.2);
      voiced(T, t, 0.75 * s, O, st(0), 0.5, { Fto: U, f0to: st(-6), atk: 0.09, rel: 0.3 });
      tgt(T.breath.gain, FLOOR, t + 0.85 * s, 0.08); end = t + 1.05 * s; break;
    }
    case 'tut': { for (const d of [0, 0.17 * s]) hiss(T, t + d, 0.018, 2500, 2.6, 0.38, 0.002, 0.02); end = t + 0.3 * s; break; }   // tut-tut: two dry clicks
    case 'hmph': {   // a nasal hum thrown down, then a snort out of the nose
      voiced(T, t, 0.3 * s, HUM, st(1.5), 0.8, { f0to: st(-5), atk: 0.03, rel: 0.05 });
      hiss(T, t + 0.3 * s, 0.12 * s, 900, 0.8, 0.24, 0.006, 0.06); tgt(T.breath.gain, 0.45, t + 0.3 * s, 0.01); tgt(T.breath.gain, FLOOR, t + 0.46 * s, 0.03);
      end = t + 0.58 * s; break;
    }
    case 'giggle': {   // laugh's little sister: higher, faster, quieter, behind the hand
      const n = 5 + Math.floor(Math.random() * 3), gap = 0.1 * s;
      for (let k = 0; k < n; k++) ha(t + k * gap, gap * 0.45, st(9 - k * 0.8 + (Math.random() - 0.5) * 2), 0.5 - k * 0.04, k % 2 ? I : E, { f0to: st(7 - k * 0.8) });
      end = t + n * gap + 0.12; break;
    }
    case 'chatter': {   // jaw chatter: the arm laughing with its gripper, clack clack clack
      const n = 8, gap = 0.075 * s;
      for (let k = 0; k < n; k++) { const tt = t + k * gap; hiss(T, tt, 0.014, 1800 + (k % 2) * 900, 1.6, 0.3, 0.002, 0.016); voiced(T, tt + 0.006, 0.03 * s, k % 2 ? A : E, st(3 - k * 0.35), 0.35, { atk: 0.006, rel: 0.02 }); }
      end = t + n * gap + 0.12; break;
    }
    default: voiced(T, t, 0.12, A, st(0), 0.8, { rel: 0.05 });
  }
  killTract(T, end, 0.12); return Math.round((end - t) * 1000);
}
