// Audition page for the servo foley engine: one button per move and one-shot, the beat / gain controls, a plot of
// the selected move's joint velocities with the detected events and a live playhead, and a peak meter on the layer.
import { initAudio, sfx } from '../src/audio/audio.js';
import { loadMoves, playMove, playTrajectory, oneShot, ONE_SHOTS, JOINTS, getMove, moveNames, analyzeTrajectory, setGain, getOutput, stopAll } from '../src/audio/foley.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; parent.appendChild(e); return e; };
const state = { beatMs: 1400, gain: 1, arm: 'a', align: 'fit', impact: 'auto', layer: false };
const SYNTH = ['ATTACK_THRUST', 'PARRY_HIGH', 'STAGGER', 'TWIRL', 'WIND_UP'];
const COLORS = ['#e6544a', '#d9a441', '#6cc46c', '#4fa3e0', '#b58ae6', '#f0f0f0'];
const IMPACT = 0.7, GUARD = 0.4;                      // stage.IMPACT, and the chain compiler's GUARD / BEAT
let selected = 'ATTACK_HIGH', playhead = null, last = null;

const log = (...a) => { $('#log').textContent += a.join(' ') + '\n'; };
window.addEventListener('error', e => log('error:', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => log('rejection:', e.reason?.message || e.reason));

// ---- controls ----
const audio = () => { initAudio(); meter(); };
$('#beat').oninput = e => { state.beatMs = +e.target.value; $('#beatv').textContent = state.beatMs + ' ms'; };
$('#gain').oninput = e => { state.gain = +e.target.value; $('#gainv').textContent = state.gain.toFixed(2); setGain(state.gain); };
$('#arm').onchange = e => (state.arm = e.target.value);
$('#align').onchange = e => (state.align = e.target.value);
$('#impact').onchange = e => (state.impact = e.target.value);
$('#layer').onchange = e => (state.layer = e.target.checked);
$('#stop').onclick = () => { audio(); stopAll(); playhead = null; draw(); };

function opts(extra = {}) {
  const o = { beatMs: state.beatMs, arm: state.arm, ...extra };
  if (state.align === 'pin') { o.impactAt = IMPACT; o.guardAt = GUARD; }
  if (state.impact !== 'auto' && o.impact === undefined) o.impact = state.impact;
  return o;
}
const follow = (t0 = 0) => (t, done) => { playhead = done ? null : t0 + t; draw(); };
function play(name, from = 0) {
  audio(); select(name);
  const m = getMove(name);
  if (state.align === 'raw' || from > 0) {   // raw speed, or a slice starting at `from` (canvas click): drive playTrajectory directly
    const k = Math.max(0, m.t.findIndex(v => v >= from - 1e-6)), t = m.t.slice(k).map(v => +(v - m.t[k]).toFixed(3)), q = m.q.slice(k);
    const rate = state.align === 'raw' ? 1 : m.t[m.t.length - 1] / (state.beatMs / 1000);
    last = playTrajectory(t, q, { rate, arm: state.arm, onTime: follow(m.t[k]), name, impact: m.impact != null && m.impact >= m.t[k] ? m.impact - m.t[k] : null, kind: m.kind, impactKind: state.impact === 'auto' ? undefined : state.impact });
  } else last = playMove(name, opts({ onTime: follow() }));
  $('#plotinfo').textContent = `${name}: ${m.synthetic ? 'synthetic' : 'library'} clip ${m.t[m.t.length - 1].toFixed(2)} s, played at ${last.rate.toFixed(2)}x over ${last.duration.toFixed(2)} s, impact ${m.impact == null ? 'none' : m.impact.toFixed(2) + ' s -> ' + ((last.at - initAudio().currentTime) + m.impact / last.rate).toFixed(2) + ' s from now'}`;
}
function select(name) { selected = name; for (const b of $('#moves').children) b.classList.toggle('on', b.dataset.name === name); draw(); }

// ---- buttons ----
async function build() {
  await loadMoves('../assets/motions/moves.json');
  const names = moveNames(); if (!names.length) log('moves.json not loaded: every move is synthetic');
  for (const n of [...names, ...SYNTH]) { const b = el('button', names.includes(n) ? '' : 'syn', $('#moves'), n); b.dataset.name = n; b.onclick = () => play(n); }
  for (const k of ONE_SHOTS) el('button', '', $('#shots'), k).onclick = () => { audio(); oneShot(k, { pan: state.arm === 'a' ? -0.55 : 0.55 }); };
  const PAIRS = [
    ['ATTACK_HIGH vs BLOCK_HIGH (blocked)', [['ATTACK_HIGH', 'BLOCK_HIGH', 'block']]],
    ['ATTACK_HIGH vs ATTACK_HIGH (clash)', [['ATTACK_HIGH', 'ATTACK_HIGH', 'clash']]],
    ['ATTACK_LOW_LR vs FEINT_HIGH (hit)', [['ATTACK_LOW_LR', 'FEINT_HIGH', 'hit']]],
    ['BLOCK_LEFT vs ATTACK_LOW_RL (blocked)', [['BLOCK_LEFT', 'ATTACK_LOW_RL', 'block']]],
    ['3-beat exchange', [['ATTACK_HIGH', 'BLOCK_HIGH', 'block'], ['FEINT_LEFT', 'ATTACK_LOW_RL', 'hit'], ['BLOCK_LEFT', 'ATTACK_LOW_LR', 'block']]],
  ];
  for (const [label, beats] of PAIRS) el('button', '', $('#pairs'), label).onclick = () => exchange(beats);
  select(selected);
}
// Both arms on one clock, like stage.playBeat: a beat every beatMs, the outcome's transient at each impact.
function exchange(beats) {
  audio(); const ctx = initAudio(); const t0 = ctx.currentTime + 0.05, beat = state.beatMs / 1000;
  beats.forEach(([ma, mb, outcome], i) => {
    const at = t0 + i * beat, kinds = { block: ['block', 'block'], clash: ['clash', 'clash'], hit: ['hit', undefined] };
    const [ia, ib] = kinds[outcome] || [];
    playMove(ma, opts({ arm: 'a', at, impact: ia, onTime: i === 0 ? follow() : undefined })); playMove(mb, opts({ arm: 'b', at, impact: ib }));
    if (state.layer) setTimeout(() => ({ block: sfx.block, clash: sfx.clash, hit: sfx.hit }[outcome] || (() => {}))(), (at - ctx.currentTime + IMPACT * beat) * 1000);
    if (i === 0) select(ma);
  });
}

// ---- plot ----
function draw() {
  const m = getMove(selected), A = analyzeTrajectory(m.t, m.q), cv = $('#plot'), g = cv.getContext('2d'), W = cv.width, H = cv.height, L = 44, R = 12, T = 10, B = 22, vmax = 360;
  const x = t => L + (W - L - R) * t / Math.max(A.dur, 0.02), y = v => T + (H - T - B) * (0.5 - v / (2 * vmax));
  g.clearRect(0, 0, W, H); g.font = '10px ui-monospace, monospace'; g.lineWidth = 1;
  g.strokeStyle = '#2c2e36'; g.fillStyle = '#6b6960';
  for (const v of [-300, -150, 0, 150, 300]) { g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - R, y(v)); g.stroke(); g.fillText(v, 4, y(v) + 3); }
  for (let t = 0; t <= A.dur + 1e-6; t += 0.2) { g.beginPath(); g.moveTo(x(t), T); g.lineTo(x(t), H - B); g.stroke(); g.fillText(t.toFixed(1), x(t) - 8, H - 8); }
  g.strokeStyle = '#4a4d58'; g.setLineDash([3, 3]); for (const kt of m.key_times || []) { g.beginPath(); g.moveTo(x(kt), T); g.lineTo(x(kt), H - B); g.stroke(); } g.setLineDash([]);
  if (m.impact != null) { g.strokeStyle = '#b8262b'; g.lineWidth = 2; g.beginPath(); g.moveTo(x(m.impact), T); g.lineTo(x(m.impact), H - B); g.stroke(); g.lineWidth = 1; g.fillStyle = '#e6544a'; g.fillText('impact ' + m.impact.toFixed(2) + ' s', x(m.impact) + 4, T + 10); }
  for (let j = 0; j < 6; j++) { g.strokeStyle = COLORS[j]; g.beginPath(); for (let i = 0; i < A.n; i++) { const px = x(i * A.dt), py = y(A.dq[j][i]); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); }
  for (const e of A.events) {
    const px = x(e.t), py = y(A.dq[e.j][Math.round(e.t / A.dt)]); g.fillStyle = COLORS[e.j]; g.beginPath();
    if (e.type === 'stop') { g.moveTo(px - 5, py - 6); g.lineTo(px + 5, py - 6); g.lineTo(px, py + 3); }
    else if (e.type === 'reverse') { g.moveTo(px, py - 7); g.lineTo(px + 5, py + 3); g.lineTo(px - 5, py + 3); }
    else { g.moveTo(px, py - 7); g.lineTo(px + 5, py); g.lineTo(px, py + 7); g.lineTo(px - 5, py); }
    g.closePath(); g.fill();
  }
  JOINTS.forEach((n, j) => { g.fillStyle = COLORS[j]; g.fillText(n, L + 8 + j * 56, H - B - 6); });
  if (playhead != null) { g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x(playhead), T); g.lineTo(x(playhead), H - B); g.stroke(); }
}
$('#plot').onclick = e => { const r = e.target.getBoundingClientRect(), m = getMove(selected), A = analyzeTrajectory(m.t, m.q); const f = ((e.clientX - r.left) * ($('#plot').width / r.width) - 44) / ($('#plot').width - 56); play(selected, Math.max(0, Math.min(1, f)) * A.dur); };

// ---- peak meter on the servo layer (after its limiter) ----
let an = null;
function meter() {
  if (an) return; const out = getOutput(); if (!out) return; const ctx = initAudio();
  an = ctx.createAnalyser(); an.fftSize = 2048; out.connect(an); const buf = new Float32Array(an.fftSize); let hold = 0, holdT = 0;
  const tick = () => {
    an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
    const now = performance.now(); if (p >= hold || now - holdT > 1000) { hold = p; holdT = now; }
    const bar = $('#meter i'); bar.style.width = Math.min(100, hold * 100) + '%'; bar.classList.toggle('hot', hold > 0.95); $('#peakv').textContent = hold.toFixed(2);
    requestAnimationFrame(tick);
  };
  tick();
}

window.lab = { state, play, exchange, oneShot, playMove, playTrajectory, getMove, analyzeTrajectory, stopAll, get last() { return last; } };
build();
