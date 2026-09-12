// Procedural audio: no sample files. Everything is synthesised with the Web Audio API so the game runs
// offline from a folder. Three buses: sfx, voice (the barkeep's garbled speech), music/ambience.
let ctx = null, master, sfxBus, voiceBus, musicBus, ambBus;
let started = false;
// crowd off by default: the music is the ambience. The four toggles persist in localStorage, so a host who
// turns the crowd on (or the voice off) for a venue keeps that choice across a reload -- the Host Controls
// drawer and the settings strip are two views of this one object.
const PREF_KEY = 'tilt.audio';
const prefs = { music: true, sfx: true, voice: true, crowd: false };
try {
  const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  for (const k of Object.keys(prefs)) if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
} catch (e) { /* private mode, or a hand-edited entry: the defaults are fine */ }
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }

export function audioReady() { return !!ctx; }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  voiceBus = ctx.createGain(); voiceBus.gain.value = 0.55; voiceBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.22; musicBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = 0.35; ambBus.connect(master);
  // A hidden page (other tab, other app) goes silent; it picks up again when it is shown. Applies to the game
  // and to every lab page, so nothing keeps sounding from a tab you are not looking at.
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else ctx.resume(); });
  window.addEventListener('pagehide', () => { if (ctx) ctx.suspend(); });
  return ctx;
}

export function setPref(name, on) {
  prefs[name] = on; savePrefs();
  if (!ctx) return;
  if (name === 'music') { musicBus.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, 0.1); ambBus.gain.setTargetAtTime(on ? 0.35 : 0, ctx.currentTime, 0.1); }
  if (name === 'sfx') sfxBus.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
  if (name === 'voice') voiceBus.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
}
export function getPref(name) { return prefs[name]; }
// Shared plumbing for the other audio modules (music.js, voice.js, servo.js): the context, the buses and
// the small synth helpers below. Always call initAudio() (on a user gesture) before using them.
export function getCtx() { return ctx; }
export function getBus(name) { return { master, sfx: sfxBus, voice: voiceBus, music: musicBus, amb: ambBus }[name]; }

// ---------- helpers ----------
const now = () => ctx.currentTime;
export function noiseBuffer(seconds = 1, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}
let _noise = {};
export function noise(color = 'white') { if (!_noise[color]) _noise[color] = noiseBuffer(2, color); const s = ctx.createBufferSource(); s.buffer = _noise[color]; s.loop = true; return s; }
export function env(g, t, a, peak, d, sustain = 0, r = 0.05, hold = 0) {
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  if (hold) g.gain.setValueAtTime(Math.max(sustain, 0.0001), t + a + d + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + hold + r);
}
export function tone(type, f, t, dur, peak, bus, { detune = 0, slideTo = null, a = 0.005, filter = null } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (detune) o.detune.value = detune;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur * 0.7, 0, dur * 0.3);
  let node = o;
  if (filter) { const fl = ctx.createBiquadFilter(); fl.type = filter.type; fl.frequency.value = filter.f; fl.Q.value = filter.q || 1; o.connect(fl); node = fl; }
  node.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.1);
}
export function burst(color, t, dur, peak, bus, { f = 2000, q = 0.7, type = 'bandpass', slideTo = null } = {}) {
  const s = noise(color); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (slideTo) fl.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain(); env(g, t, 0.004, peak, dur * 0.6, 0, dur * 0.4);
  s.connect(fl); fl.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.1);
}

// ---------- SFX ----------
export const sfx = {
  hover() { if (!ctx) return; tone('sine', 880, now(), 0.04, 0.05, sfxBus); },
  card() { if (!ctx) return; const t = now(); burst('white', t, 0.09, 0.25, sfxBus, { f: 3200, q: 1.2, slideTo: 900 }); tone('triangle', 520, t, 0.08, 0.12, sfxBus, { slideTo: 700 }); },
  unslot() { if (!ctx) return; const t = now(); burst('white', t, 0.08, 0.18, sfxBus, { f: 1200, q: 1.2, slideTo: 2600 }); },
  draw() { if (!ctx) return; const t = now(); for (let i = 0; i < 3; i++) burst('white', t + i * 0.05, 0.06, 0.15, sfxBus, { f: 2500 + i * 400, q: 1.5, slideTo: 800 }); },
  lock() { if (!ctx) return; const t = now(); tone('square', 330, t, 0.12, 0.18, sfxBus); tone('square', 495, t + 0.1, 0.16, 0.18, sfxBus); burst('white', t, 0.12, 0.2, sfxBus, { f: 1500 }); },
  deny() { if (!ctx) return; const t = now(); tone('sawtooth', 160, t, 0.16, 0.18, sfxBus, { slideTo: 110, filter: { type: 'lowpass', f: 900 } }); },
  whoosh(pitch = 1) { if (!ctx) return; const t = now(); burst('white', t, 0.28, 0.5, sfxBus, { f: 500 * pitch, q: 0.9, slideTo: 3800 * pitch }); },
  clash() {
    if (!ctx) return; const t = now();
    burst('white', t, 0.14, 0.9, sfxBus, { f: 5000, q: 0.5, type: 'highpass' });
    for (const [f, p] of [[2960, 0.28], [4470, 0.2], [6230, 0.14], [1880, 0.18]]) tone('sine', f, t, 1.1, p, sfxBus, { detune: Math.random() * 30 });
    tone('triangle', 140, t, 0.2, 0.5, sfxBus, { slideTo: 50 });
  },
  block() {
    if (!ctx) return; const t = now();
    burst('white', t, 0.12, 0.6, sfxBus, { f: 3200, q: 0.8 });
    for (const [f, p] of [[2100, 0.22], [3300, 0.16], [5100, 0.1]]) tone('sine', f, t, 0.6, p, sfxBus);
    tone('triangle', 110, t, 0.18, 0.4, sfxBus, { slideTo: 60 });
  },
  hit(heavy = 1) {
    if (!ctx) return; const t = now();
    tone('sine', 60, t, 0.32, 0.8 * heavy, sfxBus, { slideTo: 28 });   // sub
    tone('sine', 190, t, 0.28, 0.9 * heavy, sfxBus, { slideTo: 42 });
    burst('brown', t, 0.22, 0.9, sfxBus, { f: 400, q: 0.6, type: 'lowpass' });
    burst('white', t, 0.08, 0.4, sfxBus, { f: 2800, q: 0.7 });
    tone('square', 1200, t + 0.01, 0.05, 0.12, sfxBus, { slideTo: 300 });
  },
  stagger() { if (!ctx) return; const t = now(); for (let i = 0; i < 4; i++) tone('triangle', 420 - i * 60, t + i * 0.09, 0.12, 0.2, sfxBus, { slideTo: 380 - i * 60 }); },
  feint() { if (!ctx) return; const t = now(); burst('white', t, 0.16, 0.35, sfxBus, { f: 900, q: 1.2, slideTo: 2600 }); tone('sine', 700, t + 0.1, 0.08, 0.12, sfxBus, { slideTo: 1400 }); },
  exposed() { if (!ctx) return; const t = now(); tone('square', 660, t, 0.08, 0.15, sfxBus); tone('square', 880, t + 0.09, 0.08, 0.15, sfxBus); tone('square', 1100, t + 0.18, 0.14, 0.15, sfxBus); },
  confused() { if (!ctx) return; const t = now(); tone('sine', 500, t, 0.12, 0.15, sfxBus, { slideTo: 700 }); tone('sine', 700, t + 0.16, 0.18, 0.15, sfxBus, { slideTo: 520 }); },
  buff() { if (!ctx) return; const t = now(); [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, t + i * 0.06, 0.25, 0.14, sfxBus)); },
  windup() { if (!ctx) return; const t = now(); tone('sawtooth', 120, t, 0.9, 0.18, sfxBus, { slideTo: 420, filter: { type: 'lowpass', f: 1200 } }); },
  gasp() { if (!ctx) return; const t = now(); burst('white', t, 0.5, 0.25, sfxBus, { f: 700, q: 0.8, slideTo: 1600 }); },
  cheer(intensity = 1, dur = 1.6) {
    if (!ctx) return; const t = now();
    const s = noise('white'); const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 900; fl.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * intensity, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7 + Math.random() * 4; const lg = ctx.createGain(); lg.gain.value = 0.12 * intensity; lfo.connect(lg); lg.connect(g.gain);
    s.connect(fl); fl.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    for (let i = 0; i < 6 * intensity; i++) tone('sawtooth', 300 + Math.random() * 500, t + Math.random() * dur * 0.7, 0.25, 0.03, sfxBus, { filter: { type: 'bandpass', f: 1200, q: 2 } });
  },
  drumroll(dur = 1.4) {
    if (!ctx) return; const t = now(); const n = Math.floor(dur / 0.07);
    for (let i = 0; i < n; i++) { const tt = t + i * 0.07; tone('sine', 150, tt, 0.09, 0.35 + (i / n) * 0.35, sfxBus, { slideTo: 60 }); burst('white', tt, 0.05, 0.12, sfxBus, { f: 2500 }); }
    tone('sine', 100, t + dur, 0.5, 0.9, sfxBus, { slideTo: 35 }); burst('white', t + dur, 0.35, 0.5, sfxBus, { f: 1800, q: 0.5 });
  },
  horn() { if (!ctx) return; const t = now(); [[262, 0], [262, 0.18], [392, 0.36], [523, 0.62]].forEach(([f, d]) => { tone('sawtooth', f, t + d, 0.5, 0.16, sfxBus, { filter: { type: 'lowpass', f: 1800 } }); tone('sawtooth', f * 1.005, t + d, 0.5, 0.12, sfxBus, { filter: { type: 'lowpass', f: 1500 } }); }); },
  fanfare() {
    if (!ctx) return; const t = now();
    const seq = [[523, 0, 0.18], [659, 0.18, 0.18], [784, 0.36, 0.18], [1047, 0.56, 0.5], [784, 1.1, 0.16], [1047, 1.28, 0.9]];
    seq.forEach(([f, d, l]) => { tone('square', f, t + d, l, 0.14, sfxBus, { filter: { type: 'lowpass', f: 2500 } }); tone('sawtooth', f / 2, t + d, l, 0.1, sfxBus, { filter: { type: 'lowpass', f: 1200 } }); });
  },
  defeat() { if (!ctx) return; const t = now(); [[392, 0], [370, 0.35], [349, 0.7], [262, 1.05]].forEach(([f, d]) => tone('sawtooth', f, t + d, d === 1.05 ? 1.2 : 0.4, 0.14, sfxBus, { filter: { type: 'lowpass', f: 1400 } })); },
  coin() { if (!ctx) return; const t = now(); tone('square', 1319, t, 0.08, 0.1, sfxBus); tone('square', 1760, t + 0.08, 0.3, 0.1, sfxBus); },
  step() { if (!ctx) return; burst('brown', now(), 0.08, 0.5, sfxBus, { f: 300, type: 'lowpass' }); },
  servo(dur = 0.5) { if (!ctx) return; const t = now(); tone('sawtooth', 180, t, dur, 0.06, sfxBus, { slideTo: 240, filter: { type: 'bandpass', f: 1400, q: 3 } }); burst('white', t, dur, 0.05, sfxBus, { f: 4000, q: 2 }); },
};

// ---------- garbled NPC voice ("Marla-ese") ----------
// One short formant-ish blip per letter, pitched by the letter, shaped by the sentence's punctuation.
const VOWEL = { a: 1.0, e: 1.12, i: 1.26, o: 0.94, u: 0.87 };
export const VOICES = {
  marla: { base: 235, spread: 0.55, formant: 1250, type: 'sawtooth', dur: 0.075 },
  herald: { base: 150, spread: 0.4, formant: 900, type: 'square', dur: 0.09 },
  squire: { base: 330, spread: 0.7, formant: 1700, type: 'triangle', dur: 0.06 },
};
export function blip(ch, progress, sentenceEnd, voice = VOICES.marla) {
  if (!ctx || !prefs.voice) return;
  const c = ch.toLowerCase(); if (!/[a-z]/.test(c)) return;
  const t = now();
  let mult = VOWEL[c] ?? 1.0 + ((c.charCodeAt(0) * 7) % 11) / 20;
  const isVowel = c in VOWEL;
  let contour = 1;
  if (sentenceEnd === '?') contour = 1 + 0.18 * progress; else if (sentenceEnd === '!') contour = 1.06 + 0.04 * Math.sin(progress * 9); else contour = 1.02 - 0.08 * progress;
  const jitter = 1 + (Math.random() - 0.5) * 0.06;
  const f = voice.base * (1 + (mult - 1) * voice.spread) * contour * jitter;
  const dur = voice.dur * (isVowel ? 1.35 : 0.85);
  const o = ctx.createOscillator(); o.type = voice.type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (isVowel ? 0.96 : 1.08), t + dur);
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(f * 2.01, t);
  const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = voice.formant * (isVowel ? 1 : 1.5); fl.Q.value = 1.4;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
  const g = ctx.createGain(); env(g, t, 0.008, isVowel ? 0.5 : 0.32, dur * 0.55, 0, dur * 0.45);
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  o.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(lp); lp.connect(g); g.connect(voiceBus);
  o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

// ---------- music: "The Tilt of Tiltford", a 6/8 jig in D Dorian ----------
// Sequenced, not random: an A phrase (the hook) and a B phrase (the call), looped AABB. Lead is a
// shawm-like double reed (saw + square, lowpass, vibrato), doubled an octave down by a plucked lute;
// plucked bass on the strong beats; tabor (dum / tak) and a shaker keep the jig going. The duel mood
// is the same tune faster with war drums and the bass walking every beat.
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const R = null;   // rest
// [midi, length in eighths]
const PHRASE_A = [
  [74,1],[76,1],[77,1],[76,1],[74,1],[72,1], [74,3],[69,3],
  [77,1],[79,1],[81,1],[79,1],[77,1],[76,1], [77,3],[74,3],
  [81,2],[79,1],[77,2],[76,1], [74,2],[76,1],[77,3],
  [76,1],[74,1],[72,1],[74,1],[76,1],[72,1], [74,3],[R,3],
];
const PHRASE_B = [
  [81,1],[81,1],[81,1],[79,1],[81,1],[83,1], [84,3],[81,3],
  [79,1],[79,1],[79,1],[77,1],[79,1],[81,1], [83,3],[79,3],
  [81,2],[79,1],[77,2],[76,1], [74,2],[76,1],[77,1],[79,1],[81,1],
  [79,1],[77,1],[76,1],[74,1],[72,1],[71,1], [74,3],[R,3],
];
const BASS_A = [50, 50, 53, 48, 50, 50, 48, 50];          // D D F C D D C D  (per bar)
const BASS_B = [53, 48, 55, 55, 53, 50, 48, 50];          // F C G G F D C D
function expand(phrase) { const steps = []; for (const [m, len] of phrase) { steps.push(m); for (let i = 1; i < len; i++) steps.push(undefined); } return steps; }
const SONG_MEL = [...expand(PHRASE_A), ...expand(PHRASE_A), ...expand(PHRASE_B), ...expand(PHRASE_B)];   // 4 x 48 eighths
const SONG_BASS = [...BASS_A, ...BASS_A, ...BASS_B, ...BASS_B];                                          // per bar (6 eighths)

function lead(m, t, dur, peak = 0.13) {
  const f = midi(m);
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
  const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.setValueAtTime(f, t); o2.detune.value = 6;
  const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = f * 0.004; vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(1800, t); fl.frequency.exponentialRampToValueAtTime(2600, t + 0.05); fl.frequency.exponentialRampToValueAtTime(1400, t + dur); fl.Q.value = 2;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.02); g.gain.setValueAtTime(peak, t + dur - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
  const g2 = ctx.createGain(); g2.gain.value = 0.4;
  o.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(musicBus);
  o.start(t); o2.start(t); vib.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
}
function pluck(m, t, dur, peak = 0.16) {
  const f = midi(m);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 4;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(3200, t); fl.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = ctx.createGain(); env(g, t, 0.004, peak, dur * 0.8, 0, dur * 0.2);
  const g2 = ctx.createGain(); g2.gain.value = 0.25;
  o.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}
function bass(m, t, dur, peak = 0.22) {
  const f = midi(m);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f / 2;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(200, t + dur);
  const g = ctx.createGain(); env(g, t, 0.006, peak, dur * 0.7, 0, dur * 0.3);
  o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(musicBus); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}
function dum(t, peak = 0.5) { tone('sine', 110, t, 0.22, peak, musicBus, { slideTo: 48 }); burst('brown', t, 0.08, peak * 0.5, musicBus, { f: 300, type: 'lowpass' }); }
function tak(t, peak = 0.22) { burst('white', t, 0.07, peak, musicBus, { f: 2200, q: 0.8 }); tone('triangle', 240, t, 0.06, peak * 0.6, musicBus, { slideTo: 160 }); }
function shake(t, peak = 0.06) { burst('white', t, 0.05, peak, musicBus, { f: 7000, q: 1.2, type: 'highpass' }); }
function warDrum(t, peak = 0.7) { tone('sine', 80, t, 0.35, peak, musicBus, { slideTo: 38 }); burst('brown', t, 0.15, peak * 0.7, musicBus, { f: 250, type: 'lowpass' }); }

let musicTimer = null, mood = 'town', step = 0, nextT = 0;
export const music = {
  start(newMood = 'town') {
    if (!ctx) return; mood = newMood;
    if (musicTimer) return;
    step = 0; nextT = now() + 0.15;
    const schedule = () => {
      while (nextT < now() + 0.35) {
        const tense = mood === 'duel';
        const eighth = (60 / (tense ? 132 : 112)) / 3;              // dotted-quarter tempo, 3 eighths per beat
        const i = step % SONG_MEL.length, bar = Math.floor(i / 6), pos = i % 6; const t = nextT;
        const m = SONG_MEL[i];
        if (m !== undefined && m !== null) {
          let len = 1; while (i + len < SONG_MEL.length && SONG_MEL[i + len] === undefined) len++;
          const dur = eighth * len * 0.92;
          lead(m, t, dur, tense ? 0.15 : 0.12); pluck(m - 12, t, Math.min(dur, eighth * 2), 0.07);
        }
        const root = SONG_BASS[bar % SONG_BASS.length];
        if (pos === 0) bass(root - 12, t, eighth * 2.6); else if (pos === 3) bass(root - 12 + (tense ? 7 : 7), t, eighth * 2.2, 0.16);
        else if (tense && (pos === 2 || pos === 5)) bass(root - 12, t, eighth * 0.9, 0.12);
        if (pos === 0) dum(t, tense ? 0.35 : 0.45); if (pos === 3) tak(t, tense ? 0.25 : 0.2);
        if (pos === 2 || pos === 5) shake(t, tense ? 0.07 : 0.05); if (pos === 1 || pos === 4) shake(t, 0.03);
        if (tense) { if (pos === 0) warDrum(t, bar % 2 ? 0.55 : 0.7); if (pos === 3) warDrum(t + eighth * 0.5, 0.3); if (pos === 4 && bar % 4 === 3) { tak(t, 0.3); tak(t + eighth * 0.5, 0.3); } }
        nextT += eighth; step++;
      }
    };
    schedule(); musicTimer = setInterval(schedule, 90);
  },
  setMood(m) { mood = m; },
  stop() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
};
let ambNodes = null;
export const ambience = {
  start() {
    if (!ctx || ambNodes) return;
    const s = noise('brown'); const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13; const lg = ctx.createGain(); lg.gain.value = 0.2; lfo.connect(lg); lg.connect(g.gain);
    s.connect(fl); fl.connect(g); g.connect(ambBus); s.start(); lfo.start();
    const murmur = setInterval(() => { if (Math.random() < 0.6) tone('sawtooth', 200 + Math.random() * 300, now(), 0.3 + Math.random() * 0.3, 0.018, ambBus, { filter: { type: 'bandpass', f: 900, q: 2 } }); }, 700);
    ambNodes = { s, lfo, murmur };
  },
  stop() { if (!ambNodes) return; ambNodes.s.stop(); ambNodes.lfo.stop(); clearInterval(ambNodes.murmur); ambNodes = null; },
};
