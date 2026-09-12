// "The Tilt of Tiltford": the game's score, sequenced live from oscillators (no samples, no libraries).
// One motif runs through everything, the way Lena Raine's Celeste score hangs on a jingle:
//     D  A  B  E'  |  D'  B  A  G        (a rising leap that lands on the add9, then falls to a suspension)
// Every mood and sting quotes it: the heralds' trumpets call it over the lists, the tavern band plays it as a
// dance, the duel drives it on the shawm, victory rings it on bells, defeat plays it on one fiddle,
// lock_in / charge / round_start / ko / reward are one-bar fragments of it.
// Meter: the whole score is in 6/8 -- a bar is 12 steps (a step = a sixteenth, six eighths, two dotted-quarter
// beats at step 0 and step 6). bpm is the dotted-quarter pulse. A swing table (LILT) drags the second eighth of
// each group a few milliseconds late so the band breathes instead of ticking.
// Form: an estampie. Each punctum is three bars and is played twice -- first into an OUVERT (open) ending that
// hangs on the fifth, then into a CLOS (closed) ending that cadences home through the Landini figure: the ficta
// leading tone C# falls to B and leaps to D. The tavern runs two puncta (16 bars, the second turned down a third
// into the relative minor); everything else runs the first.
// Harmony: real triads on the plucks and the strings -- thirds are welcome -- over a drone in the tavern that
// never quite stops, with the modal colours kept (Mixolydian town, Dorian duel, Aeolian defeat) and the bVI-bVII
// lift intact. Only the cadence sonority stays an open fifth, so the ficta leading tone has room to bite.
// Palette, split between the two halves of festival day:
//   the lists -- heraldic natural trumpets with their fanfare triplets, side drum rolls, a field bass drum,
//     tourney kettles, the shawm as the reed voice and the viol sawing underneath;
//   the square -- fiddles with double stops and scooped slides, lute and cittern strums with the muted chuck,
//     a bagpipe drone with chanter grace notes, tin whistle, the hurdy-gurdy's buzz, tabor, bodhran, tambourine,
//     spoons, and the crowd itself: hands, boots, tankards, a knuckle on a table and a whoop.
// Small bells for victory and reward. Nothing here is a drum kit and nothing is a chip square.
// The arrangement is built from stems that fade in as intensity rises (music.setIntensity, wired to HP):
//   0.00  lute + drone with its buzz + tabor; in the tavern at rest just a picked tune and a whistle answering
//   0.25  + bass, side drum and kettles, a cittern answering, a tin whistle counter-melody
//   0.50  + tambourine, a second fiddle in double stops, the viol, the tense bVI-bVII progression
//   0.75  + the heralds' trumpets, bells and jaw harp, a stop-time bar, and a key lift
// One lookahead scheduler (100 ms timer, 300 ms ahead) renders a step at a time. Mood changes land on the next
// bar line behind a fill; stem fades are one-bar linear ramps at half-bar boundaries; nothing ever restarts on an
// intensity change. Mix: stems -> pan -> (short slap, feedback "hall") -> lowpass -> compressor -> bus.
import { getCtx, getBus, tone, burst, env } from './audio.js';

const ctx = () => getCtx();
const now = () => getCtx().currentTime;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const foldTo = (m, lo, hi) => { while (m > hi) m -= 12; while (m < lo) m += 12; return m; };
const D4 = 62, FIFTH = Math.pow(2, 7 / 12);
// Modes as semitone steps from D. Melody and chord degrees are re-rendered through the mood's mode, so the same
// motif is bright in Mixolydian (festival), shadowed in Dorian (duel) and sunk in Aeolian (defeat).
const MIX = { steps: [0, 2, 4, 5, 7, 9, 10] }, DOR = { steps: [0, 2, 3, 5, 7, 9, 10] }, AEO = { steps: [0, 2, 3, 5, 7, 8, 10] };
const semi = (d, mode) => 12 * Math.floor(d / 7) + mode.steps[((d % 7) + 7) % 7];   // degree (0 = D4, 7 = D5) -> semitones

// ---------- the material ----------
const PER = 12;                                  // steps in a bar: 6/8, a step is a sixteenth, the beat is 6 steps
// Lines in a tiny notation: bars split by '|', tokens degree[#][:sixteenths] (r = rest). A trailing '#' is musica
// ficta -- the player raises the note a semitone at a cadence, which is where the leading tone comes from.
function parse(src, per = PER) {
  const out = [];
  for (const bar of src.split('|')) {
    let n = 0;
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      const [d, l] = tok.split(':'), len = l ? +l : 1, sharp = d.endsWith('#');
      out.push(d === 'r' ? null : { d: parseInt(d, 10), f: sharp ? 1 : 0, len });
      for (let i = 1; i < len; i++) out.push(null);
      n += len;
    }
    if (n !== per) console.warn('music: bar has', n, 'sixteenths:', bar);
  }
  return out;
}
// One punctum of three bars, then the two endings every punctum shares.
const pA1 = '0:2 4:2 5:2 8:6', pA2 = '7:2 5:2 4:2 3:6', pA3 = '3:2 7:2 8:2 11:4 10:2';      // the motif and its answer
const pB1 = '-2:2 2:2 3:2 6:6', pB2 = '5:2 3:2 2:2 1:6', pB3 = '1:2 5:2 6:2 9:4 8:2';       // the same, a third lower
const OUV = '5:2 6:2 5:2 4:6', CLOS = '4:2 6#:2 5:2 7:6';                                   // open: hangs on the fifth. closed: C# B D
const LEAD = parse([pA1, pA2, pA3, OUV, pA1, pA2, pA3, CLOS, pB1, pB2, pB3, OUV, pB1, pB2, pB3, CLOS].join('|'));
// The whistle's counter-melody and the long bowed line follow the same sixteen bars.
const cA1 = '4:6 2:6', cA2 = '5:6 4:6', cA3 = '7:6 8:6', cOUV = '7:6 4:6', cCLOS = '4:6 7:6';
const cB1 = '2:6 -1:6', cB2 = '3:6 2:6', cB3 = '5:6 6:6';
const COUNTER = parse([cA1, cA2, cA3, cOUV, cA1, cA2, cA3, cCLOS, cB1, cB2, cB3, cOUV, cB1, cB2, cB3, cCLOS].join('|'));
const lA1 = '0:6 4:6', lA2 = '5:6 8:6', lA3 = '7:6 5:6', lOUV = '4:12', lCLOS = '7:12';      // the motif at half speed
const lB1 = '-2:6 2:6', lB2 = '3:6 6:6', lB3 = '5:6 3:6';
const LONG = parse([lA1, lA2, lA3, lOUV, lA1, lA2, lA3, lCLOS, lB1, lB2, lB3, lOUV, lB1, lB2, lB3, lCLOS].join('|'));
const HOLD = LEAD.slice(); for (let i = 1; i < HOLD.length; i++) if (HOLD[i] === null) HOLD[i] = HOLD[i - 1];   // the note sounding at each step
const LILT = [0, 0, 0.24, 0.1, 0.09, 0.04];      // the lilt: how late each step inside a beat falls, in steps
// Sonorities: real triads, voiced with the root doubled low so a strum has something to sit on. 'deg' voicings
// are read through the mode, 'abs' ones are fixed semitones (the mixture that gives the bVI-bVII lift).
// V alone keeps its third out, so the ficta leading tone at the clos does not fight a C natural under it.
const CH = {
  I:    { deg: [0, 2, 4, 7], root: 0 },       // D F# A D'
  vi:   { deg: [-2, 5, 7, 9], root: 5 },      // B B' D' F#'
  IV:   { deg: [-4, 3, 5, 7], root: 3 },      // G G' B' D'
  V:    { deg: [-3, 4, 8, 11], root: 4 },     // A A' E' A'' -- open, for the cadence
  bVI:  { abs: [-4, 0, 3, 8], root: -4 },     // Bb D F Bb'
  bVII: { abs: [-2, 2, 5, 10], root: -2 },    // C E G C'
};
const voicing = (name, mode) => CH[name].abs || CH[name].deg.map(d => semi(d, mode));
const rootOf = (name, mode) => (CH[name].abs ? CH[name].root : semi(CH[name].root, mode) - (CH[name].root ? 12 : 0));
// Sixteen bars: punctum, punctum, each into its ending. The flat seventh carries the motion; V is only ever the
// open fifth on A under the ficta cadence.
const PROG_A = ['I', 'bVII', 'IV', 'V', 'I', 'bVII', 'IV', 'V', 'vi', 'IV', 'bVII', 'V', 'vi', 'IV', 'bVII', 'V'];
const PROG_B = ['I', 'bVII', 'bVI', 'V', 'I', 'bVII', 'bVI', 'V', 'vi', 'bVII', 'bVI', 'V', 'vi', 'bVI', 'bVII', 'V'];
const LOOP8 = { kind: 'loop', bars: 8 }, LOOP16 = { kind: 'loop', bars: 16 };
const FAN_T = { kind: 'fan', bars: 4, mel: parse([pA1, pA2, pA3, CLOS].join('|')), ch: ['I', 'bVII', 'IV', 'V'] };        // title: the heralds state the motif
const FAN_V = { kind: 'fan', bars: 4, mel: parse([pA1, pA2, '7:2 4:2 7:2 8:6', CLOS].join('|')), ch: ['I', 'bVII', 'IV', 'V'] };   // victory: the same, rung on bells

// Moods. bpm is the dotted-quarter pulse; bars = length of the loop; x = fixed intensity (null = follow
// setIntensity); mix = per-stem caps; force = stems held on regardless of x; swing = how much LILT to apply.
const MOODS = {
  title:   { bpm: 96,  mode: MIX, intro: FAN_T, x: 0.62, swing: 0.5,  bars: 8,  mix: { crumhorn: 0, crowd: 0.5, cello: 0.85 } },
  town:    { bpm: 92,  mode: MIX, intro: null,  x: null, swing: 1,    bars: 16, mix: { counter: 0.8, drums: 0.5, tamb: 0.55, fiddle: 0.7, crumhorn: 0, bells: 0.5, crowd: 0.8, cello: 0.5 } },
  duel:    { bpm: 126, mode: DOR, intro: null,  x: null, swing: 0.4,  bars: 8,  mix: { crowd: 0.75, drone: 0.7 } },
  victory: { bpm: 104, mode: MIX, intro: FAN_V, x: 0.85, swing: 0.7,  bars: 8,  mix: { crumhorn: 0.7, bells: 1, crowd: 0.9, cello: 0.9 } },
  defeat:  { bpm: 46,  mode: AEO, intro: null,  x: 0,    swing: 0.6,  bars: 8,  mix: { lute: 0.3, drone: 0.7, tabor: 0, lead: 0.9, crowd: 0 }, force: { bass: 0.5, cello: 0.7 } },
};
// Stems: one gain each, faded in over a bar as intensity crosses 'on'. base = mix level, pan = position, slap/hall = sends.
const STEMS = {
  lute:     { on: -1,   base: 1,    pan: 0.15,  slap: 0.3,  hall: 0.28 },   // the strummed engine, and the picked tune
  drone:    { on: -1,   base: 0.7,  pan: 0,     slap: 0,    hall: 0.45 },   // bagpipe drone, hurdy-gurdy buzz
  tabor:    { on: -1,   base: 1,    pan: -0.12, slap: 0.1,  hall: 0.3 },    // tabor, bodhran, spoons
  lead:     { on: -1,   base: 1,    pan: -0.1,  slap: 0.35, hall: 0.45 },   // fiddle in the square, shawm in the lists
  crowd:    { on: -1,   base: 0.8,  pan: 0,     slap: 0.1,  hall: 0.62 },   // hands, boots, tankards, a whoop
  bass:     { on: 0.25, base: 1,    pan: 0,     slap: 0,    hall: 0.05 },
  drums:    { on: 0.25, base: 1,    pan: 0,     slap: 0.12, hall: 0.4 },    // side drum, field bass drum, tourney kettles
  gittern:  { on: 0.25, base: 0.7,  pan: -0.35, slap: 0.35, hall: 0.3 },    // the cittern, answering
  counter:  { on: 0.25, base: 0.8,  pan: 0.35,  slap: 0.25, hall: 0.5 },    // tin whistle
  tamb:     { on: 0.5,  base: 0.8,  pan: 0.28,  slap: 0.1,  hall: 0.25 },   // tambourine
  fiddle:   { on: 0.5,  base: 0.8,  pan: -0.22, slap: 0.12, hall: 0.55 },   // the second fiddle, in double stops
  cello:    { on: 0.5,  base: 0.9,  pan: -0.16, slap: 0.08, hall: 0.5 },    // the viol: the epic layer
  crumhorn: { on: 0.75, base: 0.6,  pan: 0.2,   slap: 0.25, hall: 0.4 },    // the heralds' trumpets
  bells:    { on: 0.75, base: 0.8,  pan: 0.05,  slap: 0.2,  hall: 0.65 },
  sting:    { on: -1,   base: 1,    pan: 0,     slap: 0.3,  hall: 0.5 },
};
const level = (name, x) => (STEMS[name].on < 0 ? 1 : clamp((x - STEMS[name].on) / 0.1, 0, 1));
const LOOKAHEAD = 0.3, TICK = 100, OUT = 0.45;   // OUT trims the compressed mix to about -12 dBFS peaks before the bus

// ---------- graph ----------
let G = null;
const gn = v => { const g = ctx().createGain(); g.gain.value = v; return g; };
const lp = (f, q = 1) => { const fl = ctx().createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f; fl.Q.value = q; return fl; };
const hp = (f, q = 0.7) => { const fl = ctx().createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = f; fl.Q.value = q; return fl; };
const bp = (f, q = 2) => { const fl = ctx().createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; return fl; };
const peak = (f, q, g) => { const fl = ctx().createBiquadFilter(); fl.type = 'peaking'; fl.frequency.value = f; fl.Q.value = q; fl.gain.value = g; return fl; };
const pan = v => { const c = ctx(); if (!c.createStereoPanner) return gn(1); const p = c.createStereoPanner(); p.pan.value = v; return p; };
function build() {
  if (G) return G;
  const c = ctx(), mix = gn(1), lpf = lp(7500, 0.4), comp = c.createDynamicsCompressor(), out = gn(OUT);
  comp.threshold.value = -24; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;   // fast: pluck transients stay under the lid
  mix.connect(lpf); lpf.connect(comp); comp.connect(out); out.connect(getBus('music'));
  // slap: one short tap a hair behind and off to the side, like a wall across the square.
  const sIn = gn(0.08), dS = c.createDelay(0.5), sFb = gn(0.12), sLp = lp(2800, 0.5), sP = pan(0.34);
  sIn.connect(dS); dS.connect(sLp); sLp.connect(sP); sP.connect(mix); sLp.connect(sFb); sFb.connect(dS);
  // hall: two short dark delays in a feedback loop, a tail of about a second and a half
  const hIn = gn(0.16), h1 = c.createDelay(1), h2 = c.createDelay(1), hFb = gn(0.58), hLp = lp(2600, 0.5), hHp = hp(180);
  h1.delayTime.value = 0.067; h2.delayTime.value = 0.093;
  hIn.connect(h1); h1.connect(hLp); hLp.connect(h2); h2.connect(hHp); hHp.connect(hFb); hFb.connect(h1); h1.connect(mix); hHp.connect(mix);
  const duck = gn(1); duck.connect(mix);                         // the bass drum pushes the strings down for a moment
  const stems = {};
  for (const [name, s] of Object.entries(STEMS)) {
    const g = gn(name === 'sting' ? 1 : 0), p = pan(s.pan); g.connect(p); p.connect(['lute', 'drone', 'gittern'].includes(name) ? duck : mix);
    if (s.slap) { const e = gn(s.slap); p.connect(e); e.connect(sIn); }
    if (s.hall) { const h = gn(s.hall); p.connect(h); h.connect(hIn); }
    stems[name] = g;
  }
  return (G = { mix, out, comp, stems, duck, sIn, hIn, dS });
}
function ramp(p, v, t, dur) { if (p.cancelAndHoldAtTime) { p.cancelAndHoldAtTime(t); p.linearRampToValueAtTime(v, t + Math.max(0.02, dur)); } else p.setTargetAtTime(v, t, Math.max(0.02, dur) / 3); }
function setSlap(bpm, t) { const d = clamp(60 / bpm / 6, 0.055, 0.16); G.dS.delayTime.setTargetAtTime(d, t, 0.03); }   // one step behind, so it locks to the groove

// ---------- instruments (f Hz, t start, dur s, v peak gain, to destination) ----------
const osc = (type, f, t, det = 0) => { const o = ctx().createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (det) o.detune.value = det; return o; };
const run = (nodes, t, end) => { for (const n of nodes) { n.start(t); n.stop(end); } };
// attack, hold at v until dur - r, release; returns the end time
function hold(g, t, a, v, dur, r) { const h = t + Math.max(a + 0.01, dur - r); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setValueAtTime(v, h); g.gain.exponentialRampToValueAtTime(0.0001, h + r); return h + r; }
// Plucked strings: gut on the lute, wire on the cittern (bright = the cittern, which rings longer and harder).
// The click of the plectrum rides on top.
function pluck(f, t, v, to, { dur = 0.5, bright = false, quill = true } = {}) {
  const o1 = osc('triangle', f, t), o2 = osc('sawtooth', f, t, bright ? 9 : 5), g2 = gn(bright ? 0.34 : 0.26);
  const o3 = osc('sine', f * 2, t, 3), g3 = gn(0.18);
  const c0 = (bright ? 4400 : 3000) + f, fl = lp(c0, 1.1);
  fl.frequency.setValueAtTime(c0, t); fl.frequency.exponentialRampToValueAtTime(bright ? 620 : 360, t + dur);
  const g = gn(0); env(g, t, 0.002, v, dur * 0.8, 0, dur * 0.2);
  o1.connect(fl); o2.connect(g2); g2.connect(fl); o3.connect(g3); g3.connect(fl);
  fl.connect(g); g.connect(to); run([o1, o2, o3], t, t + dur + 0.1);
  if (quill && v > 0.03) burst('white', t, 0.011, v * 0.28, to, { f: clamp(f * 3.2, 800, 5600), q: 1.4 });
}
// Strum: the chord raked across the courses, about a centisecond between them; up-strokes are lighter and start
// from the top course, the way a hand comes back.
function strum(fs, t, v, to, { up = false, dur = 0.55, spread = 0.012, bright = false } = {}) {
  const order = up ? [...fs].reverse() : fs;
  order.forEach((f, i) => pluck(f, t + i * spread, v * (up ? 0.62 : 1) * (1 - i * 0.05), to, { dur: dur * (up ? 0.6 : 1), bright, quill: i === 0 }));
}
// The muted chuck: the heel of the hand kills the strings as the stroke lands, so all that is left is the rake
// and a thud of wood. It is what makes a strum pattern dance instead of ring.
function chuck(fs, t, v, to) {
  fs.forEach((f, i) => { const o = osc('triangle', f, t), fl = lp(620 + f * 0.5, 2.5), g = gn(0); env(g, t, 0.002, v * (1 - i * 0.14), 0.04, 0, 0.03); o.connect(fl); fl.connect(g); g.connect(to); o.start(t); o.stop(t + 0.12); });
  burst('white', t, 0.028, v * 0.75, to, { f: 2100, q: 1.1 });
}
// Bagpipe / hurdy-gurdy drone: tonic and fifth, wavering, under everything in the square.
function droneNote(f, t, dur, v, to) {
  const o1 = osc('sawtooth', f, t, -6), o2 = osc('sawtooth', f, t, 7), o3 = osc('square', f * 1.5, t, 4), g3 = gn(0.2);
  const wob = osc('sine', 0.7, t), wg = gn(f * 0.004); wob.connect(wg); wg.connect(o1.frequency); wg.connect(o2.frequency);
  const fl = lp(1150, 0.6), g = gn(0), end = hold(g, t, 0.25, v, dur, 0.45);
  o1.connect(fl); o2.connect(fl); o3.connect(g3); g3.connect(fl); fl.connect(g); g.connect(to); run([o1, o2, o3, wob], t, end + 0.05);
}
// The chanter's grace note: a piper cannot tongue, so notes are cut apart with a flick above them.
const chanterCut = (f, t, v, to) => { const o = osc('square', f * 1.18, t), fl = lp(2600, 1.4), g = gn(0); env(g, t, 0.002, v, 0.03, 0, 0.02); o.connect(fl); fl.connect(g); g.connect(to); o.start(t); o.stop(t + 0.08); };
// The trompette: the buzzing bridge the hurdy-gurdy player kicks on the beat, digging in as the fight goes on.
const buzz = (t, v, to, f = 98) => { tone('sawtooth', f, t, 0.09, v, to, { slideTo: f * 0.78, a: 0.001, filter: { type: 'bandpass', f: 860, q: 2.4 } }); burst('white', t, 0.032, v * 0.5, to, { f: 1500, q: 1.1 }); };
// The herald's natural trumpet: no valves, so it lives on the harmonic series. Saw and square through a brass
// formant near 1.2 kHz, behind a filter that flares on the attack the way a bell does before it settles.
function trumpet(f, t, dur, v, to, { slideTo = null } = {}) {
  const o1 = osc('sawtooth', f, t, -6), o2 = osc('square', f, t, 6), o3 = osc('sawtooth', f * 2, t, 2), g3 = gn(0.14), os = [o1, o2, o3];
  if (slideTo) for (const o of os) o.frequency.exponentialRampToValueAtTime(slideTo * (o === o3 ? 2 : 1), t + dur);
  const form = peak(1200, 1.4, 10), fl = lp(2000, 1.1);
  fl.frequency.setValueAtTime(800, t); fl.frequency.exponentialRampToValueAtTime(Math.min(3600, 1400 + f * 3), t + 0.05); fl.frequency.exponentialRampToValueAtTime(Math.min(2700, 1100 + f * 2), t + Math.min(dur, 0.4));
  const vib = osc('sine', 5.2, t), vg = gn(0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.003, t + 0.35); vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  const g = gn(0), end = hold(g, t, 0.016, v, dur, 0.07);
  o1.connect(form); o2.connect(form); o3.connect(g3); g3.connect(form); form.connect(fl); fl.connect(g); g.connect(to); run([...os, vib], t, end + 0.05);
  burst('white', t, 0.014, v * 0.2, to, { f: clamp(f * 3, 1200, 5000), q: 1.2 });   // the lips
}
// A herald's flourish: three notes of the harmonic series in a triplet, the way a trumpet fills a bar.
function flourish(f, t, span, v, to, up = true) {
  const ms = up ? [1, 1.5, 2] : [2, 1.5, 1];
  ms.forEach((m, i) => trumpet(f * m, t + (i * span) / 3, (span / 3) * 0.92, v * (0.82 + i * 0.09), to));
}
// Shawm: the loud double reed of the waits. Saws and a square through a keytracked resonant lowpass that bites at
// the start, a chiff of reed noise, vibrato fading in. grace = the reed player's cut onto a long note.
function shawm(f, t, dur, v, to, slideTo = null, grace = 0) {
  const f0 = grace || f;
  const o1 = osc('sawtooth', f0, t, -7), o2 = osc('sawtooth', f0, t, 7), o3 = osc('square', f0, t, 2), g3 = gn(0.22), os = [o1, o2, o3];
  if (grace) for (const o of os) o.frequency.setValueAtTime(f, t + 0.03);
  if (slideTo) for (const o of os) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const vib = osc('sine', 5.7, t), vg = gn(0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.005, t + 0.25); vib.connect(vg); for (const o of os) vg.connect(o.frequency);
  const cut = Math.min(1300 + f * 1.8, 6500), fl = lp(cut, 2.5); fl.frequency.setValueAtTime(cut * 0.5, t); fl.frequency.exponentialRampToValueAtTime(cut * 1.4, t + 0.04); fl.frequency.exponentialRampToValueAtTime(cut, t + 0.25);
  const g = gn(0), end = hold(g, t, 0.02, v, dur, 0.05);
  o1.connect(fl); o2.connect(fl); o3.connect(g3); g3.connect(fl); fl.connect(g); g.connect(to); run([...os, vib], t, end + 0.05);
  burst('white', t, 0.018, v * 0.25, to, { f: clamp(f * 2.4, 900, 4000), q: 1.5 });
}
// Crumhorn: the capped reed. No bite and no bell, just a nasal buzz in a narrow band.
function crumhorn(f, t, dur, v, to) {
  const o1 = osc('square', f, t, -6), o2 = osc('square', f, t, 6), o3 = osc('sawtooth', f, t), g3 = gn(0.28);
  const vib = osc('sine', 6.2, t), vg = gn(f * 0.004); vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  const nose = bp(clamp(f * 2.6, 500, 2600), 3), fl = lp(Math.min(2400 + f, 5000), 0.8);
  const g = gn(0), end = hold(g, t, 0.03, v, dur, 0.06);
  o1.connect(nose); o2.connect(nose); o3.connect(g3); g3.connect(nose); nose.connect(fl); fl.connect(g); g.connect(to); run([o1, o2, o3, vib], t, end + 0.05);
}
// Tin whistle (bright, a strong second partial) or a recorder (softer), both with the chiff of the windway.
function pipe(f, t, dur, v, to, { whistle = false } = {}) {
  const o1 = osc('triangle', f, t), o2 = osc('sine', f * 2, t, 5), g2 = gn(whistle ? 0.4 : 0.2);
  const vib = osc('sine', whistle ? 5.6 : 5.1, t), vg = gn(0); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.005, t + 0.3); vib.connect(vg); vg.connect(o1.frequency);
  const fl = lp(Math.min(f * (whistle ? 6 : 4), whistle ? 7200 : 4200), 0.7), g = gn(0), end = hold(g, t, whistle ? 0.02 : 0.035, v, dur, 0.08);
  o1.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(to); run([o1, o2, vib], t, end + 0.05);
  burst('white', t, whistle ? 0.04 : 0.055, v * (whistle ? 0.3 : 0.22), to, { f: clamp(f * 2, 900, 6000), q: 0.9 });
}
// Fiddle: the voice of the square. Rosin on the attack, a body that sings around 700 Hz, and the two things a
// dance fiddler actually does -- scoop up into a note, and lean on a second string underneath it.
// sob = the slow, deep, drooping vibrato kept for the defeat.
function fiddle(f, t, dur, v, to, { slide = 0, dbl = 0, sob = false } = {}) {
  const f0 = slide ? f * Math.pow(2, -slide / 12) : f;
  const o1 = osc('sawtooth', f0, t, -7), o2 = osc('sawtooth', f0, t, 7), os = [o1, o2];
  if (slide) for (const o of os) o.frequency.exponentialRampToValueAtTime(f, t + Math.min(dur * 0.3, 0.09));
  const vib = osc('sine', sob ? 3.4 : 5.2, t), vg = gn(0);
  vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * (sob ? 0.012 : 0.005), t + (sob ? 0.5 : 0.3));
  vib.connect(vg); for (const o of os) vg.connect(o.frequency);
  if (sob) for (const o of os) o.frequency.linearRampToValueAtTime(f * 0.985, t + dur);           // the pitch sags as the bow dies
  const body = peak(700, 1.1, 7), fl = lp(2400, 0.8), g = gn(0), end = hold(g, t, sob ? 0.16 : 0.045, v, dur, sob ? 0.4 : 0.16);
  o1.connect(body); o2.connect(body); body.connect(fl); fl.connect(g); g.connect(to); run([...os, vib], t, end + 0.05);
  burst('white', t, 0.035, v * 0.3, to, { f: clamp(f * 4, 1200, 5200), q: 0.8, type: 'highpass' });   // the bow catching
  if (dbl) fiddle(f * Math.pow(2, dbl / 12), t + 0.012, dur * 0.92, v * 0.55, to, { slide: slide ? slide : 0 });
}
// The bottom of the consort -- a big rebec, or the bass viol: detuned saws under a resonant body somewhere
// between 200 and 400 Hz, the bow biting before the tone arrives, vibrato swelling in late rather than sitting
// on the note. It lives between C2 and G3, and takes a second voice a fifth above it when the fight is desperate.
function cello(f, t, dur, v, to, { fifth = false, bite = 0.1 } = {}) {
  const o1 = osc('sawtooth', f, t, -7), o2 = osc('sawtooth', f, t, 6), o3 = osc('triangle', f / 2, t), g3 = gn(0.16);
  const vib = osc('sine', 4.2, t), vg = gn(0);
  vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.004, t + Math.min(dur * 0.7, 0.9));
  vib.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  const body = peak(200 + Math.min(f, 200), 1.2, 8), fl = lp(Math.min(1500 + f * 2, 3200), 0.9);
  const g = gn(0), end = hold(g, t, bite, v, dur, Math.min(dur * 0.35, 0.5));
  o1.connect(body); o2.connect(body); o3.connect(g3); g3.connect(body); body.connect(fl); fl.connect(g); g.connect(to); run([o1, o2, o3, vib], t, end + 0.06);
  burst('white', t, 0.05, v * 0.28, to, { f: clamp(f * 6, 700, 2600), q: 0.7 });                 // the bow biting
  if (fifth) cello(f * FIFTH, t + 0.02, dur - 0.02, v * 0.55, to, { bite: bite * 1.2 });
}
const lowString = m => foldTo(m, 36, 55);                                                        // C2 to G3, where the viol lives
// Jaw harp: one low twanging tongue, the mouth opening around it and swallowing the harmonics.
function jawHarp(f, t, v, to) {
  const o = osc('sawtooth', f, t), fl = bp(2800, 6), g = gn(0);
  fl.frequency.setValueAtTime(2800, t); fl.frequency.exponentialRampToValueAtTime(430, t + 0.3);
  env(g, t, 0.002, v, 0.32, 0, 0.07);
  o.connect(fl); fl.connect(g); g.connect(to); o.start(t); o.stop(t + 0.45);
}
// Bass: a plucked open string, not a sub -- sine for the body with a lowpassed saw for the edge.
function bassNote(f, t, dur, v, to) {
  const o1 = osc('sine', f, t), o2 = osc('sawtooth', f, t), g2 = gn(0.3), fl = lp(520, 0.7), g = gn(0); env(g, t, 0.006, v, dur * 0.7, 0, dur * 0.3);
  o1.connect(g); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(to); run([o1, o2], t, t + dur + 0.1);
}
// A small bell: a handful of inharmonic partials, the high ones dying first, struck with a hard mallet.
function bell(f, t, dur, v, to) {
  for (const [r, a] of [[1, 1], [2.76, 0.42], [5.4, 0.2], [8.2, 0.08]]) {
    const o = osc('sine', f * r, t, (r * 13) % 7), g = gn(0);
    env(g, t, 0.002, v * a, dur / (0.8 + r * 0.35), 0, 0.08);
    o.connect(g); g.connect(to); o.start(t); o.stop(t + dur + 0.25);
  }
  burst('white', t, 0.009, v * 0.35, to, { f: clamp(f * 5, 2000, 9000), q: 1.2 });
}
// Percussion. Tabor: a small drum with a gut snare, one stick. Bodhran: bigger, hand-played, the pitch bending
// under the palm. Side drum: snares and sticks, and the roll that a tourney runs on. Tourney kettles: tuned to
// the tonic and the fifth, struck hard and left to ring. Field bass drum: the great drum of the lists.
const dum = (t, v, to) => { tone('sine', 168, t, 0.15, v, to, { slideTo: 96 }); burst('brown', t, 0.06, v * 0.55, to, { f: 520, type: 'lowpass' }); burst('white', t, 0.045, v * 0.2, to, { f: 2600, q: 0.7 }); };
const tak = (t, v, to) => { burst('white', t, 0.05, v, to, { f: 2600, q: 0.9 }); tone('triangle', 290, t, 0.04, v * 0.4, to, { slideTo: 200 }); };
const frame = (t, v, to, low = true) => { tone('sine', low ? 150 : 205, t, 0.14, v, to, { slideTo: low ? 92 : 132 }); burst('brown', t, 0.055, v * 0.6, to, { f: low ? 460 : 760, type: 'lowpass' }); burst('white', t, 0.016, v * 0.14, to, { f: 2300, q: 0.8 }); };
const frameRoll = (t, span, v, to, n = 3) => { for (let i = 0; i < n; i++) frame(t + (i * span) / n, v * (0.62 + (0.38 * i) / n), to, i === 0); };
const side = (t, v, to) => { burst('white', t, 0.085, v, to, { f: 2000, q: 0.7 }); tone('triangle', 245, t, 0.045, v * 0.4, to, { slideTo: 175 }); };
const sideRoll = (t, span, v, to, n = 6) => { for (let i = 0; i < n; i++) side(t + (i * span) / n, v * (0.45 + (0.55 * i) / n) * (0.85 + Math.random() * 0.3), to); };
const kettle = (t, v, to, high = false) => { tone('sine', high ? 147 : 110, t, 0.3, v, to, { slideTo: high ? 132 : 99 }); burst('brown', t, 0.05, v * 0.32, to, { f: 800, type: 'lowpass' }); burst('white', t, 0.014, v * 0.18, to, { f: 2600, q: 1 }); };
const kettleRoll = (t, span, v, to, n = 4) => { for (let i = 0; i < n; i++) kettle(t + (i * span) / n, v * (0.55 + (0.45 * i) / n), to, i % 2 === 1); };
const great = (t, v, to) => { tone('sine', 108, t, 0.34, v, to, { slideTo: 52 }); burst('brown', t, 0.13, v * 0.75, to, { f: 300, type: 'lowpass' }); };
// Spoons: two dry wooden clacks, the second a hair after the first, the way a wrist rolls them.
const spoons = (t, v, to) => { for (const [d, a, f] of [[0, 1, 1900], [0.038, 0.68, 2250]]) { burst('white', t + d, 0.016, v * a, to, { f, q: 2.2 }); tone('triangle', f / 5, t + d, 0.018, v * a * 0.3, to, { slideTo: f / 9 }); } };
const shaker = (t, v, to) => burst('white', t, 0.04, v, to, { f: 7000, q: 1.1, type: 'highpass' });
const tambourine = (t, v, to) => { burst('white', t, 0.1, v, to, { f: 6000, q: 1.6 }); for (const [f, a] of [[5150, 0.28], [6780, 0.2], [8300, 0.12]]) tone('sine', f, t, 0.065, v * a, to); };
// Hands: three slaps within twenty milliseconds and the smack of the room, because nobody claps in unison.
const clap = (t, v, to) => { for (const [d, a] of [[0, 0.7], [0.009, 1], [0.019, 0.5]]) burst('white', t + d, 0.026, v * a, to, { f: 1500, q: 1 }); burst('white', t + 0.022, 0.11, v * 0.32, to, { f: 1100, q: 0.6 }); };
// Feet: a boot on boards. Wood and weight, no sub.
const stomp = (t, v, to, duck = false) => {
  tone('triangle', 132, t, 0.11, v, to, { slideTo: 76 }); burst('brown', t, 0.075, v * 0.8, to, { f: 520, type: 'lowpass' }); burst('white', t, 0.018, v * 0.2, to, { f: 2400, q: 0.8 });
  if (duck) { const d = G.duck.gain; d.setValueAtTime(1, t); d.linearRampToValueAtTime(0.6, t + 0.012); d.linearRampToValueAtTime(1, t + 0.18); }
};
// Tankards meeting over a table, and a knuckle on the boards.
const clink = (t, v, to) => { for (const [f, a, d] of [[1180, 1, 0.45], [1790, 0.55, 0.3], [2960, 0.25, 0.18]]) tone('sine', f, t, d, v * a, to); burst('white', t, 0.012, v * 0.3, to, { f: 4200, q: 1.5 }); };
const knock = (t, v, to) => { tone('triangle', 210, t, 0.08, v, to, { slideTo: 118 }); burst('brown', t, 0.045, v * 0.7, to, { f: 700, type: 'lowpass' }); tone('sine', 430, t, 0.045, v * 0.3, to); };
// A voice out of the crowd: two detuned saws through a pair of moving formants -- shape, not words. Kept small,
// so it reads as a few people at a fair rather than a stadium.
function shout(t, v, to, { f0 = 230, dur = 0.3, up = true, vowel = [700, 1200], vowel2 = null, voices = 2 } = {}) {
  const os = [osc('sawtooth', f0, t, -14)]; if (voices > 1) os.push(osc('sawtooth', f0, t, 11));
  for (const o of os) o.frequency.exponentialRampToValueAtTime(f0 * (up ? 1.45 : 0.74), t + dur * 0.8);
  const f1 = bp(vowel[0], 4), f2 = bp(vowel[1], 5), g1 = gn(1), g2 = gn(0.6);
  if (vowel2) { f1.frequency.exponentialRampToValueAtTime(vowel2[0], t + dur * 0.7); f2.frequency.exponentialRampToValueAtTime(vowel2[1], t + dur * 0.7); }
  const g = gn(0); env(g, t, 0.025, v, dur * 0.6, 0, dur * 0.4);
  for (const o of os) { o.connect(f1); o.connect(f2); }
  f1.connect(g1); g1.connect(g); f2.connect(g2); g2.connect(g); g.connect(to);
  run(os, t, t + dur + 0.1);
  burst('white', t, dur * 0.4, v * 0.18, to, { f: vowel[1], q: 2 });
}
const whoop = (t, v, to) => shout(t, v, to, { f0: 250 + Math.random() * 70, dur: 0.42, up: true, vowel: [420, 900], vowel2: [660, 1500], voices: 1 });
const hey = (t, v, to) => shout(t, v, to, { f0: 208, dur: 0.2, up: false, vowel: [700, 1650], vowel2: [560, 1900], voices: 2 });

// ---------- sequencer ----------
let timer = null, mood = 'town', pending = null, xTarget = 0, x = 0, lift = 0;
let songBar = 0, step = 0, nextT = 0, chordName = 'I', stemT = {}, hist = {};
const sched = [];                                                 // scheduled steps, for state()
const active = name => (hist[name] || [1]).some(v => v > 0);      // schedule a stem's notes while it is up or still fading

function locate(M, b) {
  const L = M.bars === 16 ? LOOP16 : LOOP8;
  if (M.intro && b < M.intro.bars) return { sec: M.intro, secBar: b };
  const k = M.intro ? b - M.intro.bars : b; return { sec: L, secBar: k % L.bars };
}
// Intensity changes land here, at half-bar boundaries: every stem ramps to its new level over one bar.
function updateStems(t, barLen) {
  const M = MOODS[mood]; x = M.x ?? xTarget;
  for (const name in STEMS) {
    if (name === 'sting') continue;
    const forced = M.force?.[name];
    let v = forced != null ? STEMS[name].base * forced : STEMS[name].base * level(name, x) * (M.mix[name] ?? 1);
    if (name === 'drone') v *= 0.78 + 0.22 * x;
    if (name === 'crowd') v *= 0.6 + 0.4 * x;
    if (name === 'tabor') v *= 1 - 0.35 * level('drums', x) * (M.mix.drums ?? 1);
    if (stemT[name] !== v) { ramp(G.stems[name].gain, v, t, barLen); stemT[name] = v; }
    hist[name] = [v, ...(hist[name] || [])].slice(0, 3);
  }
  ramp(G.sIn.gain, 0.06 + 0.06 * x, t, barLen); ramp(G.hIn.gain, 0.16 + 0.1 * x, t, barLen);
}
function switchMood(m, t) { mood = m; pending = null; songBar = 0; lift = 0; setSlap(MOODS[m].bpm, t); updateStems(t, 120 / MOODS[m].bpm); }
function tick() {
  const T = now(); if (nextT < T - 0.15) nextT = T + 0.03;        // throttled tab: skip ahead rather than dump a backlog
  while (nextT < T + LOOKAHEAD) {
    const t = nextT;
    if (step === 0 && pending) switchMood(pending, t);
    const M = MOODS[mood], sp = 60 / M.bpm / 6;                   // a step: a sixth of the dotted-quarter beat
    if (step === 0 || step === PER / 2) updateStems(t, sp * PER);
    const { sec, secBar } = locate(M, songBar);
    if (step === 0) {
      if (sec.kind === 'loop') {
        if (M.x == null && secBar % 4 === 0) lift = x >= 0.75 ? 2 : x < 0.7 ? 0 : lift;   // key lift for the final stretch, at 4-bar boundaries
        chordName = (x >= 0.5 ? PROG_B : PROG_A)[secBar];
      } else { lift = 0; chordName = sec.ch[secBar]; }
    }
    const tl = t + LILT[step % 6] * sp * (M.swing ?? 0);          // the lilt: the inside of the beat falls a touch late
    if (sec.kind === 'fan') fanStep(sec, secBar, step, tl, sp); else loopStep(secBar, step, tl, sp);
    if (pending && step >= PER / 2) fill(pending, step, tl, sp);
    sched.push({ t, mood, bar: songBar, step, bpm: M.bpm, x, lift, chord: chordName, sec: sec.kind === 'fan' ? 'fan' : (secBar >= 8 ? 'punctum II' : 'punctum I') + (secBar % 4 === 3 ? (secBar % 8 === 3 ? ' ouvert' : ' clos') : '') });
    nextT += sp; if (++step === PER) { step = 0; songBar++; }
  }
  while (sched.length && sched[0].t < T - 1) sched.shift();
}
// The loop: one step of the estampie. Which stems sound is decided by intensity (see updateStems).
// A bar is two beats of three eighths: steps 0 and 6 are the beats, 2, 4, 8 and 10 the eighths between them.
function loopStep(bar, s, t, sp) {
  const M = MOODS[mood], mode = M.mode, S = G.stems, i = bar * PER + s, K = D4 + lift;
  const chord = voicing(chordName, mode).map(o => K + o), root = foldTo(38 + lift + rootOf(chordName, mode), 36, 47);
  const e = s % 6, beat = e === 0;                                // e: where we are inside the dotted-quarter beat
  const acc = s === 0 ? 1 : s === 6 ? 0.9 : e === 4 ? 0.78 : 0.7, hum = () => 0.94 + Math.random() * 0.12;
  const deg = d => hz(K + semi(d, mode)), nHz = n => hz(K + semi(n.d, mode) + n.f);       // n.f carries the ficta
  const slow = mood === 'defeat', hot = mood === 'duel', barLen = sp * PER;
  const rest = mood === 'town' && x < 0.3;                        // the tavern before the fight: a quiet band in the corner
  const swap = bar >= 8;                                          // the second punctum: the two melody voices trade
  // Stop-time, the bar before the key lift: the band hits the downbeat and leaves the shawm, the trumpets and the
  // drone alone in the air, until a roll on the last step kicks the new key in.
  const stopTime = hot && x >= 0.75 && bar === 7;
  const rhythm = !stopTime || s === 0 || s === 11;
  // Lute and cittern: down-strum on the beat with the tune picked over it, the muted chuck on the offbeat, an
  // up-stroke on the third eighth. At rest it stops strumming and just picks the tune.
  if (active('lute') && rhythm) {
    if (slow) { if (s === 0) pluck(deg(HOLD[i].d), t, 0.07, S.lute, { dur: 1.6 }); }
    else if (rest) { if (s % 2 === 0) pluck(nHz(HOLD[i]), t, (beat ? 0.075 : 0.055) * hum(), S.lute, { dur: 0.7 }); }
    else if (beat) { strum([hz(root + 12), ...chord.map(hz)], t, 0.066 * acc * (stopTime ? 1.25 : 1), S.lute, { spread: 0.012 }); pluck(nHz(HOLD[i]), t + 0.028, 0.066 * acc * hum(), S.lute, { dur: 0.55, bright: true }); }
    else if (e === 2) { chuck(chord.slice(0, 3).map(hz), t, 0.048 * hum(), S.lute); pluck(nHz(HOLD[i]), t, 0.044 * hum(), S.lute, { dur: 0.4, bright: true }); }
    else if (e === 4) strum(chord.slice(1).map(hz), t, 0.04 * hum(), S.lute, { up: true, dur: 0.32, spread: 0.009, bright: true });
    else if (hot && s % 2 === 1) pluck(hz(chord[(s >> 1) % 4]), t, 0.024, S.lute, { dur: 0.22, bright: true });
  }
  // The drone, the chanter's grace notes and the buzzing bridge.
  if (active('drone')) {
    if (s === 0) { if (slow) droneNote(hz(K - 12), t, barLen * 0.98, 0.042, S.drone); else droneNote(hz(K - 12), t, barLen + 0.3, 0.05, S.drone); }
    if (!slow && beat && !rest) buzz(t, (0.035 + 0.055 * x) * (s ? 0.82 : 1), S.drone, hz(K - 24));
    if (!slow && rest && s === 0) buzz(t, 0.025, S.drone, hz(K - 24));
    if (!slow && !rest && (s === 4 || s === 10)) chanterCut(deg(HOLD[i].d), t, 0.03, S.drone);
    if (hot && x >= 0.6 && (s === 4 || s === 10)) buzz(t, 0.03 * x, S.drone, hz(K - 24));
  }
  // Tabor, bodhran and spoons: dum on the beats, tak on the last eighth of each group, spoons rattling between,
  // a rolling triplet into every fourth bar -- which is where the ouvert and clos endings fall.
  if (active('tabor') && rhythm) {
    if (s === 0) dum(t, 0.27, S.tabor); else if (s === 6) dum(t, rest ? 0.12 : 0.18, S.tabor);
    if (!rest && (s === 4 || s === 10)) tak(t, s === 10 ? 0.15 : 0.12, S.tabor);
    if (hot && (s === 2 || s === 8)) tak(t, 0.07, S.tabor);
    if (!rest && !beat && s % 2 === 0) spoons(t, 0.045, S.tabor);
    if (!rest && bar % 4 === 3 && s >= 8 && s % 2 === 0) frameRoll(t, sp * 2, 0.09 + (s - 8) * 0.02, S.tabor, 3);
  }
  // The tune. In the square a fiddle carries it, scooping into the long notes and leaning on a second string; in
  // the lists it is the shawm; at rest the whistle answers the lute instead; in defeat one fiddle with a sob.
  if (active('lead')) {
    if (rest) { const n = COUNTER[i]; if (n && !active('counter')) pipe(nHz(n), t, sp * n.len * 0.85, 0.05 * hum(), S.lead, { whistle: true }); }   // hand the answer over once the counter stem is up
    else { const n = LEAD[i]; if (n) { const f = nHz(n), dur = sp * n.len, lng = n.len >= 4;
      if (slow) fiddle(f / 2, t, dur * 0.97, 0.1, S.lead, { sob: true, slide: lng ? 1 : 0 });
      else if (hot) shawm(f, t, dur * 0.92, 0.086 * acc * hum(), S.lead, null, lng ? nHz({ d: n.d + 1, f: 0 }) : 0);
      else fiddle(f, t, dur * 0.94, 0.082 * acc * hum(), S.lead, { slide: lng ? 1 : 0, dbl: lng ? -5 : 0 }); } }
  }
  // The heralds. Over the lists they double the long notes of the tune and throw a flourish into the endings;
  // anywhere else this stem is the quieter capped reed.
  if (active('crumhorn') && !rest) {
    const n = LEAD[i];
    if (hot) {
      if (n && n.len >= 4) trumpet(nHz(n), t + 0.01, sp * n.len * 0.9, 0.05 * acc, S.crumhorn);
      if (bar % 4 === 3 && s === 6) flourish(deg(0) / 2, t, sp * 6, 0.05, S.crumhorn, bar % 8 === 7);
    } else if (n) crumhorn(nHz(n), t + 0.008, sp * n.len * 0.9, 0.044 * acc, S.crumhorn);
  }
  if (active('counter') && !stopTime) { const n = (swap ? LONG : COUNTER)[i]; if (n) pipe(nHz(n), t, sp * n.len * (swap ? 0.8 : 0.9), 0.048 * hum(), S.counter, { whistle: true }); }
  if (active('fiddle') && !stopTime) { const n = (swap ? COUNTER : LONG)[i]; if (n) fiddle(nHz(n) / 2, t, sp * n.len * 0.97, 0.05, S.fiddle, { dbl: 7 }); }
  // The cittern, answering: chords three-against-two on the calling phrases, the tune an octave up in the second
  // half of the bar on the answering ones.
  if (active('gittern') && !slow && rhythm && !rest) {
    if (Math.floor(bar / 2) % 2) { if (s >= 6 && s % 2 === 0 && HOLD[i]) pluck(nHz(HOLD[i]) * 2, t, 0.026 * acc, S.gittern, { dur: 0.4, bright: true }); }
    else if (s % 4 === 0) strum(chord.slice(1).map(m => hz(m + 12)), t, 0.026 * (s ? 0.85 : 1), S.gittern, { dur: 0.4, spread: 0.008, bright: true });
  }
  if (active('bass') && rhythm) {
    if (slow) { if (s === 0) bassNote(hz(root), t, barLen * 0.95, 0.14, S.bass); }
    else if (beat) bassNote(hz(root + (s ? 7 : 0)), t, sp * (stopTime ? 2.4 : 5.4), s ? 0.13 : 0.18, S.bass);
    else if (hot && (s === 4 || s === 10)) bassNote(hz(root + 12), t, sp * 1.7, 0.085, S.bass);
  }
  // The viol. Broad and legato under the square, an eighth-note engine under the lists carrying the build into
  // the key lift, one low note holding the room under the defeat.
  if (active('cello')) {
    const n = LONG[i];
    if (slow) { if (s === 0 && bar % 2 === 0) cello(hz(lowString(K - 24)), t, barLen * 1.9, 0.055, S.cello, { bite: 0.4 }); }
    else if (hot) {
      if (rhythm && s % 2 === 0) cello(hz(lowString(root)), t, sp * 1.7, 0.04 * acc, S.cello, { bite: 0.028 });
      if (n) cello(hz(lowString(K + semi(n.d, mode) + n.f)), t, sp * n.len * 0.95, 0.045, S.cello, { fifth: x >= 0.75, bite: 0.12 });
    } else if (n) cello(hz(lowString(K + semi(n.d, mode) + n.f)), t, sp * n.len * 0.97, 0.048, S.cello, { fifth: x >= 0.75, bite: 0.16 });
  }
  // Side drum, kettles and the field bass drum: the tourney's own percussion. The kettles answer each other on
  // the beats, the bass drum marks the bar, the side drum runs the sixteenths in the lists and rolls the endings.
  if (active('drums') && rhythm) {
    if (beat) { kettle(t, s ? 0.2 : 0.26, S.drums, !!s); if (!s) great(t, 0.24, S.drums); }
    if (s === 4 || s === 10) side(t, 0.13, S.drums);
    if (hot && x >= 0.5) { if (s === 2 || s === 8) kettle(t, 0.12, S.drums); if (s % 2 === 1) side(t, 0.045, S.drums); }
    if (bar % 4 === 3 && s >= 9) sideRoll(t, sp, 0.08 + (s - 9) * 0.035, S.drums, 3);
    if (stopTime && beat) great(t, 0.3, S.drums);
  }
  // The square itself: a clap on the second beat of every other bar and a boot every fourth, tankards and a
  // knuckle on a table in the tavern, a whoop on the lift of a phrase when the duel is going badly.
  if (active('crowd') && !slow && (rhythm || s === 6)) {
    if (s === 6 && bar % 2 === 0 && !rest) clap(t, 0.15 * (hot ? 1.15 : 1) * hum(), S.crowd);
    if (s === 0 && bar % 4 === 2 && !rest) stomp(t, 0.2, S.crowd);
    if (hot) {
      if (x >= 0.6 && bar % 8 === 3 && s === 10) hey(t, 0.11, S.crowd);
      if (x >= 0.75 && bar % 8 === 7 && s === 6) whoop(t, 0.085, S.crowd);
    } else {
      if (bar % 4 === 1 && s === 9) clink(t, 0.095, S.crowd);
      if (bar % 8 === 5 && s === 4) knock(t, 0.11, S.crowd);
      if (bar % 8 === 7 && s === 11 && Math.random() < 0.5) clink(t, 0.07, S.crowd);
      if (mood === 'victory' && s === 10) clap(t, 0.14, S.crowd);
    }
  }
  if (active('tamb') && rhythm && !rest) { if (s === 4 || s === 10) tambourine(t, 0.085, S.tamb); else if (s % 2 === 0 && !beat) shaker(t, 0.026, S.tamb); }
  if (active('bells') && rhythm && !slow) {
    if (s === 0) { bell(hz(chord[3] + 12), t, 1.1, 0.05, S.bells); if (hot) jawHarp(hz(root), t, 0.048, S.bells); }
    else if (s === 6) bell(hz(chord[1] + 12), t, 0.8, 0.035, S.bells);
    else if (s === 10 && hot) jawHarp(hz(root), t, 0.04, S.bells);
  }
}
// The processionals. Title: the heralds' trumpets state the motif over the great drum, the kettles and the drone,
// with a flourish at the end of each bar. Victory: bells and a whistle carry it while the square claps it home.
function fanStep(sec, bar, s, t, sp) {
  const M = MOODS[mood], mode = M.mode, S = G.stems, n = sec.mel[bar * PER + s];
  const chord = voicing(chordName, mode).map(o => D4 + o), root = foldTo(38 + rootOf(chordName, mode), 36, 47);
  const win = mood === 'victory', beat = s % 6 === 0;
  if (n) {
    const f = hz(D4 + semi(n.d, mode) + n.f), dur = sp * n.len * 0.92;
    if (win) { bell(f * 2, t, Math.min(dur * 1.7, 1.5), 0.065, S.bells); pipe(f, t, dur, 0.075, S.lead, { whistle: true }); trumpet(f, t, dur * 0.9, 0.04, S.crumhorn); }
    else { trumpet(f, t, dur, 0.075, S.lead); trumpet(f / 2, t, dur, 0.042, S.lead); if (active('counter')) pipe(f * 2, t, dur * 0.9, 0.032, S.counter, { whistle: true }); }
  }
  if (!win && s === 10 && bar % 2 === 1) flourish(hz(D4 + semi(0, mode)) / 2, t, sp * 2, 0.045, S.crumhorn);   // the heralds answer
  if (s === 0) {
    droneNote(hz(D4 - 12), t, sp * PER + 0.3, 0.048, S.drone); bassNote(hz(root), t, sp * (PER - 1), 0.16, S.bass);
    if (win) { strum([hz(root + 12), ...chord.map(hz)], t, 0.045, S.lute, { spread: 0.014 }); bell(hz(chord[2] + 24), t + 0.03, 1.2, 0.042, S.bells); }
  }
  // The viol under the processional: one broad bow per beat on whatever the motif is sounding.
  if (active('cello') && beat) {
    let nn = null; for (let k = s; k >= 0; k--) if (sec.mel[bar * PER + k]) { nn = sec.mel[bar * PER + k]; break; }
    if (nn) cello(hz(foldTo(D4 + semi(nn.d, mode) + nn.f, 36, 55)), t, sp * 6 * 0.96, 0.05, S.cello, { fifth: win, bite: 0.16 });
  }
  if (beat) { great(t, s ? 0.24 : 0.32, S.drums); kettle(t, 0.22, S.drums, !!s); }
  if (s === 4 || s === 10) { tambourine(t, 0.11, S.tabor); if (win) clap(t, 0.22, S.drums); else side(t, 0.11, S.drums); }
  if (s === 6 && bar % 2 === 0) clap(t, win ? 0.17 : 0.11, S.crowd);
  if (win && bar % 2 === 1 && s === 10) whoop(t, 0.09, S.crowd);
  if (!win && s % 6 === 2) tak(t, 0.085, S.tabor);
  if (bar === sec.bars - 1 && s >= 6) { great(t, 0.14 + (s - 6) * 0.03, S.drums); if (s % 2 === 1) sideRoll(t, sp, 0.09 + (s - 6) * 0.02, S.drums, 3); }
}
// Fill: the last beat before a mood change. Through the sting stem so it is heard whatever the band is doing.
function fill(to, s, t, sp) {
  const S = G.stems.sting, k = s - 6;
  if (to === 'defeat') { if (s === 6) great(t, 0.38, S); return; }           // the floor drops out
  if (s % 2 === 0) tak(t, 0.1 + k * 0.02, S); if (s >= 9) sideRoll(t, sp, 0.11 + (s - 9) * 0.05, S, 3);
  if (to === 'duel' && (s === 6 || s === 9 || s === 11)) great(t, 0.26 + k * 0.04, S);
  if (to === 'duel' && s === 11) kettleRoll(t, sp, 0.16, S, 4);              // the kettles roll the tilt on
  if (to === 'victory' && (s === 8 || s === 10)) { clap(t, 0.2, S); if (s === 10) { tambourine(t, 0.15, S); whoop(t, 0.1, S); } }
}

// ---------- API ----------
export const music = {
  moods: Object.keys(MOODS), stings: ['lock_in', 'charge', 'round_start', 'ko', 'reward'],
  start(m = 'town') {
    if (!ctx()) return; if (MOODS[m]) mood = m;
    if (timer) { this.setMood(m); return; }
    build(); const t = now() + 0.05; G.out.gain.cancelScheduledValues(t); G.out.gain.setValueAtTime(OUT, t);
    pending = null; songBar = 0; step = 0; lift = 0; stemT = {}; hist = {}; sched.length = 0; nextT = t + 0.02;
    setSlap(MOODS[mood].bpm, t); updateStems(t, 0.05);
    tick(); timer = setInterval(tick, TICK);
  },
  setMood(m) { if (!MOODS[m]) return; if (!timer) { mood = m; return; } pending = m === mood ? null : m; },
  setIntensity(v) { xTarget = clamp(+v || 0, 0, 1); },
  stop() { if (!timer) return; clearInterval(timer); timer = null; pending = null; G.out.gain.setTargetAtTime(0, now(), 0.15); },
  // One-shot cues, each a fragment of the motif in the current mode and key.
  sting(kind) {
    if (!ctx()) return; build();
    const t = now() + 0.02, M = MOODS[mood], mode = M.mode, S = G.stems.sting, K = D4 + lift, sp = 60 / M.bpm / 6;
    const f = d => hz(K + semi(d, mode)), tri = name => voicing(name, mode).slice(0, 3).map(o => hz(K + o));
    const up = [0, 4, 5, 8], down = [7, 5, 4, 3];                                       // the motif's rise and its fall
    // lock_in: the cittern runs up the courses, a little bell agrees, a tankard goes down on the table.
    if (kind === 'lock_in') { up.forEach((d, i) => pluck(f(d), t + i * sp * 0.8, 0.09, S, { dur: 0.6, bright: true })); strum(tri('I'), t + sp * 2.4, 0.05, S, { bright: true, dur: 0.7, spread: 0.012 }); bell(f(8) * 2, t + sp * 2.4, 0.7, 0.046, S); knock(t, 0.12, S); }
    // charge: the square stamps and claps faster and faster, the heralds calling over it, a "hey!" as the drum lands.
    else if (kind === 'charge') { let tt = t; for (let i = 0; i < 12; i++) { stomp(tt, 0.18 + i * 0.017, S); if (i % 2) clap(tt, 0.1 + i * 0.013, S); if (i % 3 === 0) trumpet(f(up[i / 3]), tt, 0.3 - i * 0.01, 0.07, S); tt += 0.13 - i * 0.007; } great(tt, 0.55, S); flourish(f(0), tt, 0.34, 0.06, S); tambourine(tt, 0.2, S); hey(tt + 0.1, 0.14, S); }
    // round_start: the herald's trumpet, a triplet flourish and the kettles, the way a tilt is called on.
    else if (kind === 'round_start') { const at = [0, 0.14, 0.28, 0.56]; up.forEach((d, i) => { const l = i === 3 ? 0.7 : 0.16; trumpet(f(d), t + at[i], l, 0.085, S); trumpet(f(d) / 2, t + at[i], l, 0.05, S); }); flourish(f(0), t + 0.56, 0.36, 0.055, S); kettle(t, 0.26, S); kettle(t + 0.14, 0.18, S, true); kettle(t + 0.56, 0.26, S); sideRoll(t + 0.3, 0.24, 0.09, S, 4); tambourine(t + 0.56, 0.13, S); }
    // ko: the great drum, the kettles, a trumpet falling off the note, the crowd catching its breath.
    else if (kind === 'ko') { great(t, 0.6, S); great(t + 0.2, 0.4, S); kettle(t, 0.3, S); kettle(t + 0.2, 0.24, S, true); tambourine(t, 0.22, S); down.forEach((d, i) => trumpet(f(d), t + i * 0.09, i === 3 ? 0.55 : 0.1, 0.07, S, i === 3 ? { slideTo: f(d) / 2 } : {})); whoop(t + 0.5, 0.1, S); }
    // reward: the bells pick out the motif, a whistle answers, the lute rings under it, tankards go up.
    else if (kind === 'reward') { [0, 4, 5, 8, 7].forEach((d, i) => bell(f(d) * 2, t + i * 0.075, 1.3, 0.058, S)); pipe(f(8) * 2, t + 0.4, 0.9, 0.042, S, { whistle: true }); strum(voicing('I', mode).map(o => hz(K + o)), t + 0.28, 0.045, S, { dur: 1.4, spread: 0.018 }); tambourine(t + 0.06, 0.11, S); clink(t + 0.2, 0.09, S); }
  },
  // What is sounding right now (for the lab): the scheduled step whose time has come.
  state() {
    const T = ctx() ? now() : 0; let cur = null; for (const e of sched) { if (e.t <= T) cur = e; else break; }
    return { running: !!timer, pending, intensity: xTarget, stems: { ...stemT }, mood, bar: 0, step: 0, per: PER, bars: MOODS[mood].bars, bpm: MOODS[mood].bpm, x, lift, sec: '-', chord: '-', ...cur };
  },
  get out() { return G && G.out; },
};
