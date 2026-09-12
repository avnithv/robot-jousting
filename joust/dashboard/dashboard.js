import { CARDS, REST } from '../src/game/cards.js';
import { resolveBeat, emptyStatus } from '../src/game/rules.js';
// Arm Studio: move library, trajectory viewer, pair viewer, sound hook and arm status.
// Vanilla ES module, no build step. Data comes from data/*.json (tools/make_dashboard_data.py).
import * as K from './fk.js';

const $ = s => document.querySelector(s);
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = (v, d = 2) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '–';
const cm = v => (v * 100).toFixed(1);
const JOINT_COLORS = ['#f3d27a', '#e04a4a', '#e9a55a', '#7fe07a', '#4d8de0', '#b9a58a'];   // pan, lift, elbow, wrist_flex, wrist_roll, jaw
const ARM = { A: { body: '#b8262b', light: '#e04a4a', dark: '#5e0f12', trail: 'rgba(224, 74, 74, 0.55)' },
              B: { body: '#1e4e9c', light: '#4d8de0', dark: '#0d2148', trail: 'rgba(77, 141, 224, 0.55)' } };

// ---------------------------------------------------------------- data
async function loadJSON(p) { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }
let MOVES, CHAINS, PAIRS, HUBS, TRANS, META;
try {
  [MOVES, CHAINS, PAIRS, HUBS, TRANS, META] = await Promise.all(['moves', 'chains', 'pairs', 'hubs', 'transitions', 'meta'].map(n => loadJSON(`data/${n}.json`)));
} catch (e) {
  document.querySelector('main').prepend(el('div', 'section-head', `<h2>No data yet</h2><p>${esc(e.message)} — run <code>python3 tools/make_dashboard_data.py</code> and reload.</p>`));
  throw e;
}
const ALL = { ...MOVES, ...CHAINS };
const MOVE_NAMES = META.moves, CHAIN_NAMES = META.chains;
const REST_Q = MOVES.REST ? MOVES.REST.q[0] : [0, -89, 47, 3, 76, 8];
const RULES = META.rules;

// ---------------------------------------------------------------- tooltip
const tip = $('#tooltip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-help]'); if (!t) { tip.hidden = true; return; }
  tip.innerHTML = (t.dataset.helpTitle ? `<b>${esc(t.dataset.helpTitle)}</b>` : '') + esc(t.dataset.help); tip.hidden = false;
});
document.addEventListener('mousemove', e => { if (tip.hidden) return; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px'; tip.style.top = (e.clientY + 18 + h > innerHeight ? e.clientY - h - 10 : e.clientY + 18) + 'px'; });
document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-help]')) tip.hidden = true; });

// ---------------------------------------------------------------- drawing helpers
function setupCanvas(c) {
  const dpr = devicePixelRatio || 1; const r = c.getBoundingClientRect();
  const W = Math.max(10, Math.round(r.width)), H = Math.max(10, Math.round(r.height));
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, W, H };
}
function poly(ctx, pts, width, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.restore();
}
function dashed(ctx, x1, y1, x2, y2, color, dash = [6, 4], width = 1) {
  ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function label(ctx, text, x, y, color = '#c9b285', size = 12, align = 'left', font = 'Alegreya, Georgia, serif') {
  ctx.save(); ctx.fillStyle = color; ctx.font = `${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y); ctx.restore();
}

/** One arm as a chain, in screen space (fn maps world [x, ?, z] -> [sx, sy] via the given projector). */
function drawArm(ctx, pose, arm, proj, opts = {}) {
  const C = ARM[arm]; const P = pose.anchors.map(proj); const ft = proj(pose.fixedTip), hilt = proj(pose.hilt), tipP = proj(pose.tip);
  const k = opts.scale || 1;
  // shadow under the chain
  poly(ctx, [P[0], P[1], P[2], P[3], P[4], ft], 14 * k, 'rgba(0,0,0,0.35)');
  poly(ctx, [P[0], P[1]], 9 * k, C.dark); poly(ctx, [P[1], P[2]], 11 * k, C.body); poly(ctx, [P[2], P[3]], 9 * k, C.body);
  poly(ctx, [P[3], P[4]], 7 * k, C.light); poly(ctx, [P[4], ft], 6 * k, C.dark);
  poly(ctx, [P[5], hilt], 4 * k, C.light);                                   // moving jaw carrying the sword
  poly(ctx, [hilt, tipP], 6.5 * k, '#3a3f48'); poly(ctx, [hilt, tipP], 4 * k, '#dfe3ea'); // blade
  ctx.save(); ctx.fillStyle = '#d9a441'; ctx.beginPath(); ctx.arc(hilt[0], hilt[1], 3.4 * k, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tipP[0], tipP[1], 2 * k, 0, 7); ctx.fill();
  for (const i of [1, 2, 3, 4]) { ctx.beginPath(); ctx.arc(P[i][0], P[i][1], (i === 1 ? 5 : 4.2) * k, 0, 7); ctx.fillStyle = C.dark; ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#f3d27a'; ctx.stroke(); }
  ctx.restore();
}

/** Side view of the arena with both arms, rule lines and a top-down inset. */
class ArenaView {
  constructor(canvas, inset) {
    this.c = canvas; this.i = inset; this.world = { xmin: -0.30, xmax: 0.91, zmin: -0.075, zmax: 0.72 }; this.state = null;
    new ResizeObserver(() => this.redraw()).observe(canvas);
  }
  redraw() { if (this.state) this.draw(this.state); }
  draw(s) {
    this.state = s; const { ctx, W, H } = setupCanvas(this.c); const w = this.world;
    const pad = 26, sc = Math.min((W - 2 * pad) / (w.xmax - w.xmin), (H - 2 * pad) / (w.zmax - w.zmin));
    const x0 = (W - sc * (w.xmax - w.xmin)) / 2, y0 = H - pad;
    const X = x => x0 + (x - w.xmin) * sc, Z = z => y0 - (z - w.zmin) * sc; const proj = p => [X(p[0]), Z(p[2])];
    // background + ground
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1c1712'); g.addColorStop(1, '#100c09'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4a2f1c'; ctx.fillRect(0, Z(0), W, H - Z(0)); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, Z(0), W, 3);
    // grid every 10 cm
    for (let x = -0.3; x <= 0.91; x += 0.1) { const xx = X(x); dashed(ctx, xx, Z(w.zmax), xx, Z(0), 'rgba(233,216,176,0.07)', [1, 3]); if (Math.abs(x % 0.2) < 1e-6 || Math.abs(x) < 1e-9) label(ctx, x.toFixed(1), xx, Z(0) + 11, 'rgba(233,216,176,0.5)', 10, 'center'); }
    for (let z = 0.1; z <= w.zmax; z += 0.1) { const zz = Z(z); dashed(ctx, X(w.xmin), zz, X(w.xmax), zz, 'rgba(233,216,176,0.07)', [1, 3]); label(ctx, z.toFixed(1), X(w.xmin) - 4, zz, 'rgba(233,216,176,0.5)', 10, 'right'); }
    label(ctx, 'metres', X(w.xmax), Z(0) + 11, 'rgba(233,216,176,0.5)', 10, 'right');
    // rules: centre line, hand limits, wrist floors
    dashed(ctx, X(K.CENTRE_X), Z(w.zmax), X(K.CENTRE_X), Z(0), 'rgba(217,164,65,0.7)', [7, 5], 1.2); label(ctx, 'centre 0.305', X(K.CENTRE_X) + 5, Z(w.zmax) + 10, '#d9a441', 11);
    dashed(ctx, X(K.HAND_X_MAX), Z(w.zmax), X(K.HAND_X_MAX), Z(0), 'rgba(255,140,140,0.65)', [4, 4]); label(ctx, 'A hand ≤ 0.27', X(K.HAND_X_MAX) - 5, Z(w.zmax) + 26, '#ff9a9a', 11, 'right');
    dashed(ctx, X(K.BASE_GAP - K.HAND_X_MAX), Z(w.zmax), X(K.BASE_GAP - K.HAND_X_MAX), Z(0), 'rgba(140,180,255,0.65)', [4, 4]); label(ctx, 'B hand ≤ 0.27', X(K.BASE_GAP - K.HAND_X_MAX) + 5, Z(w.zmax) + 26, '#9ab8ff', 11);
    for (const [name, z] of [['wrist pitch floor 0.120', K.WRIST_FLOORS.wrist_flex], ['wrist roll floor 0.092', K.WRIST_FLOORS.wrist_roll]]) { dashed(ctx, X(w.xmin), Z(z), X(w.xmax), Z(z), 'rgba(143,181,216,0.45)', [2, 4]); label(ctx, name, X(w.xmax) - 4, Z(z) - 7, 'rgba(143,181,216,0.8)', 10, 'right'); }
    // bases
    for (const [arm, bx] of [['A', 0], ['B', K.BASE_GAP]]) {
      ctx.fillStyle = '#2a2a30'; ctx.fillRect(X(bx - 0.045), Z(K.PAN_AXIS_Z), 0.09 * sc, K.PAN_AXIS_Z * sc); ctx.strokeStyle = '#555'; ctx.strokeRect(X(bx - 0.045), Z(K.PAN_AXIS_Z), 0.09 * sc, K.PAN_AXIS_Z * sc);
      label(ctx, arm, X(bx), Z(0) + 26, arm === 'A' ? '#e04a4a' : '#4d8de0', 22, 'center', 'Grenze Gotisch, serif');
    }
    // trails (whole path faint, elapsed part bright)
    for (const arm of ['A', 'B']) {
      const tr = s.trails && s.trails[arm]; if (!tr || tr.length < 2) continue;
      poly(ctx, tr.map(proj), 1.5, ARM[arm].trail, 0.35);
      const n = Math.max(1, Math.min(tr.length, Math.round(tr.length * (s.frac == null ? 1 : s.frac))));
      poly(ctx, tr.slice(0, n).map(proj), 2, ARM[arm].light, 0.9);
    }
    // closest-approach line
    if (s.closest && s.closest.d < 0.2) { const p = proj(s.closest.p), q = proj(s.closest.q); dashed(ctx, p[0], p[1], q[0], q[1], s.closest.d <= 0.024 ? '#ff8080' : '#f3d27a', [3, 3], 1.5); }
    if (s.B) drawArm(ctx, s.B, 'B', proj); if (s.A) drawArm(ctx, s.A, 'A', proj);
    if (s.caption) label(ctx, s.caption, W / 2 - 40, 14, 'rgba(233,216,176,0.85)', 15, 'center', 'Grenze Gotisch, serif');
    this.drawInset(s);
  }
  drawInset(s) {
    if (!this.i) return; const { ctx, W, H } = setupCanvas(this.i);
    const xmin = -0.3, xmax = 0.91, ymax = 0.36, pad = 8; const sc = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (2 * ymax));
    const X = x => (W - sc * (xmax - xmin)) / 2 + (x - xmin) * sc, Y = y => H / 2 - y * sc; const proj = p => [X(p[0]), Y(p[1])];
    ctx.fillStyle = 'rgba(20,16,12,0.92)'; ctx.fillRect(0, 0, W, H);
    dashed(ctx, X(K.CENTRE_X), 0, X(K.CENTRE_X), H, 'rgba(217,164,65,0.6)', [5, 4]);
    dashed(ctx, X(xmin), Y(0), X(xmax), Y(0), 'rgba(233,216,176,0.15)', [1, 3]);
    for (const [arm, bx] of [['A', 0], ['B', K.BASE_GAP]]) { ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.arc(X(bx), Y(0), 0.045 * sc, 0, 7); ctx.fill(); }
    for (const arm of ['B', 'A']) {
      const p = s[arm]; if (!p) continue; const C = ARM[arm]; const P = p.anchors.map(proj);
      poly(ctx, [P[0], P[1], P[2], P[3], P[4], proj(p.fixedTip)], 4, C.body); poly(ctx, [proj(p.hilt), proj(p.tip)], 3, '#dfe3ea');
      ctx.fillStyle = '#d9a441'; ctx.beginPath(); ctx.arc(...proj(p.hilt), 2, 0, 7); ctx.fill();
    }
    label(ctx, 'top view · pan', 6, 9, 'rgba(233,216,176,0.7)', 10);
    if (s.A) label(ctx, `pan A ${f2(s.A.pan, 0)}°`, W - 6, 9, '#ff9a9a', 10, 'right');
    if (s.B && s.B.pan != null) label(ctx, `pan B ${f2(s.B.pan, 0)}°`, W - 6, H - 9, '#9ab8ff', 10, 'right');
  }
}

/** Small side-view silhouette of one pose in its own frame (cards, hub table). */
function drawMiniPose(canvas, qSim, arm = 'A') {
  const { ctx, W, H } = setupCanvas(canvas); const f = K.fk(qSim);
  const xmin = -0.26, xmax = 0.47, zmin = -0.06, zmax = 0.72, pad = 4; const sc = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (zmax - zmin));
  const X = x => (W - sc * (xmax - xmin)) / 2 + (x - xmin) * sc, Z = z => H - pad - (z - zmin) * sc; const proj = p => [X(p[0]), Z(p[2])];
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(74,47,28,0.6)'; ctx.fillRect(0, Z(0), W, H - Z(0));
  dashed(ctx, X(K.HAND_X_MAX), 0, X(K.HAND_X_MAX), Z(0), 'rgba(184,38,43,0.5)', [2, 2]);
  const pose = { anchors: f.anchors, fixedTip: f.fixedTip, hilt: f.hilt, tip: f.tip };
  drawArm(ctx, pose, arm, proj, { scale: 0.42 });
}

// ---------------------------------------------------------------- transport
class Player {
  constructor({ playBtn, scrub, timeEl, speedSel, loopChk, onTime, onStop, onLoop }) {
    Object.assign(this, { playBtn, scrub, timeEl, speedSel, loopChk, onTime, onStop, onLoop }); this.t = 0; this.duration = 1; this.playing = false; this.last = 0; this.holdUntil = 0; this.pendingLoop = false;
    playBtn.onclick = () => this.toggle();
    scrub.oninput = () => { this.seek(+scrub.value); };
    this.speedSel.onchange = () => { this.speed = +this.speedSel.value; };
    this.speed = +speedSel.value;
    this.tick = this.tick.bind(this);
  }
  setDuration(d) { this.duration = d; this.scrub.max = d; this.seek(Math.min(this.t, d)); }
  seek(t) { this.t = Math.max(0, Math.min(this.duration, t)); this.scrub.value = this.t; this.timeEl.textContent = `${f2(this.t)} / ${f2(this.duration)} s`; this.onTime(this.t); }
  play() { if (this.playing) return; if (this.t >= this.duration - 1e-6) this.seek(0); this.pendingLoop = false; this.playing = true; this.playBtn.textContent = 'Pause'; this.playBtn.classList.add('playing'); this.last = performance.now(); requestAnimationFrame(this.tick); }
  pause() { if (!this.playing) return; this.playing = false; this.pendingLoop = false; this.playBtn.textContent = 'Play'; this.playBtn.classList.remove('playing'); if (this.onStop) this.onStop(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  tick(now) {
    if (!this.playing) return; const dt = Math.min(0.1, (now - this.last) / 1000) * this.speed; this.last = now;
    if (now < this.holdUntil) { requestAnimationFrame(this.tick); return; }
    if (this.pendingLoop) { this.pendingLoop = false; this.seek(0); if (this.onLoop) this.onLoop(); requestAnimationFrame(this.tick); return; }
    const t = this.t + dt;
    if (t >= this.duration) { this.seek(this.duration); if (this.loopChk.checked) { this.holdUntil = now + 450; this.pendingLoop = true; requestAnimationFrame(this.tick); } else this.pause(); return; }
    this.seek(t); requestAnimationFrame(this.tick);
  }
}
function keyMarks(container, move, duration, offset = 0) {
  container.innerHTML = '';
  if (!move) return;
  if (move.beats) { move.beats.forEach((b, i) => { const s = el('span', 'impact', `beat ${i + 1} · ${b.move}`); s.style.left = (100 * (offset + b.pinned_at) / duration) + '%'; container.appendChild(s); }); return; }
  move.key_times.forEach((kt, i) => {
    const isPin = move.pin && move.pin.key === i; const s = el('span', isPin ? (move.type === 'block' ? 'guard' : 'impact') : '', isPin ? (move.type === 'block' ? `guard ${f2(kt + offset)}s` : `impact ${f2(kt + offset)}s`) : `k${i}`);
    const pct = 100 * (kt + offset) / duration; s.style.left = pct + '%'; if (pct > 88) s.classList.add('right');
    s.dataset.help = `key ${i} at ${f2(kt)} s: [${move.keys[i].map(v => v.toFixed(0)).join(', ')}]`; container.appendChild(s);
  });
}
function tipTrail(move, arm) { return move.tip.map(p => K.toWorld(p, arm)); }

// ---------------------------------------------------------------- velocity plot
class VelPlot {
  constructor(canvas, legendEl) { this.c = canvas; this.move = null; this.t = 0; new ResizeObserver(() => this.draw(this.t)).observe(canvas);
    legendEl.innerHTML = K.JOINTS.map((j, i) => `<span><span class="sw" style="background:${JOINT_COLORS[i]}"></span>${j}</span>`).join('') + `<span><span class="sw" style="background:#ff6a6a"></span>300 deg/s cap</span>`; }
  setMove(m) { this.move = m; this.ymax = Math.max(360, Math.ceil(m.stats.peak_max * 1.15 / 50) * 50); this.draw(0); }
  draw(t) {
    this.t = t; const m = this.move; const { ctx, W, H } = setupCanvas(this.c); ctx.fillStyle = '#14100c'; ctx.fillRect(0, 0, W, H); if (!m) return;
    const padL = 44, padR = 12, padT = 12, padB = 24; const X = tt => padL + (tt / m.duration) * (W - padL - padR), Y = v => padT + (1 - v / this.ymax) * (H - padT - padB);
    for (let v = 0; v <= this.ymax; v += 100) { dashed(ctx, padL, Y(v), W - padR, Y(v), 'rgba(233,216,176,0.12)', [1, 3]); label(ctx, v, padL - 6, Y(v), 'rgba(233,216,176,0.6)', 10, 'right'); }
    for (let tt = 0; tt <= m.duration + 1e-9; tt += 0.25) { label(ctx, tt.toFixed(2), X(tt), H - 9, 'rgba(233,216,176,0.6)', 10, 'center'); }
    label(ctx, 'deg/s', 4, padT, 'rgba(233,216,176,0.6)', 10);
    (m.key_times || []).forEach((kt, i) => { dashed(ctx, X(kt), padT, X(kt), H - padB, 'rgba(217,164,65,0.5)', [3, 3]); label(ctx, `k${i}`, X(kt) + 3, padT + 6, 'rgba(217,164,65,0.8)', 10); });
    if (m.beats) m.beats.forEach(b => { dashed(ctx, X(b.pinned_at), padT, X(b.pinned_at), H - padB, 'rgba(255,140,140,0.6)', [3, 3]); });
    dashed(ctx, padL, Y(K.SERVO_CAP), W - padR, Y(K.SERVO_CAP), '#ff6a6a', [8, 4], 1.5);
    for (let k = 5; k >= 0; k--) { const pts = m.t.map((tt, i) => [X(tt), Y(Math.abs(m.vel[i][k]))]); poly(ctx, pts, k === 5 ? 1 : 1.8, JOINT_COLORS[k], k === 5 ? 0.55 : 0.95); }
    ctx.save(); ctx.strokeStyle = '#f3d27a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(t), padT); ctx.lineTo(X(t), H - padB); ctx.stroke(); ctx.restore();
    const v = K.sampleAt(m.vel, m.t, t); const worst = v.slice(0, 5).reduce((a, b, i) => Math.abs(b) > Math.abs(v[a]) ? i : a, 0);
    label(ctx, `${K.JOINTS[worst]} ${Math.abs(v[worst]).toFixed(0)} deg/s`, Math.min(X(t) + 6, W - 120), padT + 22, Math.abs(v[worst]) > K.SERVO_CAP ? '#ff8080' : '#f3d27a', 11);
  }
}

// ---------------------------------------------------------------- sound hook (optional ../src/audio/servo.js)
// servo.js (another engineer's module) exposes loadMoves(url?), playTrajectory(t, q, {rate, arm, at, onTime, impact, kind})
// -> handle {stop(), done}, playMove(name, {beatMs}). Feature-detected: everything here is a no-op when it is missing.
let servo = null, audioMod = null;
async function listing(dir) { try { const r = await fetch(dir, { cache: 'no-store' }); return r.ok ? await r.text() : null; } catch (e) { return null; } }
async function loadServo() {
  try {
    const audioDir = await listing('../src/audio/');
    if (audioDir !== null && !/foley\.js/.test(audioDir)) throw new Error('../src/audio/foley.js is not there yet');
    audioMod = await import('../src/audio/audio.js');
    servo = await import('../src/audio/foley.js');
    // its move library lives in ../assets/motions/moves.json (built by another tool); only ask for it when it exists
    const assets = await listing('../assets/');
    if (typeof servo.loadMoves === 'function' && (assets === null || /motions/.test(assets))) await servo.loadMoves('../assets/motions/moves.json');
    for (const b of document.querySelectorAll('.audition')) { b.disabled = false; b.title = 'Play the knight foley in sync with the canvas'; }
    theatreEnable();
    console.info('Arm Studio: audition enabled (foley.js found)');
  } catch (e) { servo = null; console.info('Arm Studio: audition disabled –', e.message); }
}
const audition = { armed: null };   // { tracks: [{move, arm, offset, sync}], player, handles, btn }
function auditionButtons() { for (const b of document.querySelectorAll('.audition')) { const on = audition.armed && audition.armed.btn === b; b.classList.toggle('playing', !!on); b.textContent = on ? 'Sounding…' : 'Audition'; } }
function stopAudition() {
  const a = audition.armed; if (!a) return; audition.armed = null;
  for (const h of a.handles) { try { if (h && typeof h.stop === 'function') h.stop(); } catch (e) { /* ignore */ } }
  auditionButtons();
}
function fireAudition() {   // (re)start the sound for the armed tracks from the player's t = 0
  const a = audition.armed; if (!a || !servo) return; const c = audioMod.getCtx ? audioMod.getCtx() : null; const base = (c ? c.currentTime : 0) + 0.06; a.handles = [];
  for (const tr of a.tracks) {
    const m = tr.move; if (!m) continue;
    const opts = { rate: a.player.speed, arm: tr.arm, at: base + tr.offset / a.player.speed, name: m.name, kind: m.type, impact: m.pin ? m.pin.key_t : null };
    if (tr.sync) opts.onTime = tt => { if (audition.armed === a && a.player.playing && !a.player.pendingLoop) a.player.seek(tt + tr.offset); };
    try { a.handles.push(servo.playTrajectory(m.t, m.q, opts)); } catch (e) { console.warn('audition failed', e); }
  }
}
function startAudition(tracks, player, btn) {
  if (!servo) return false;
  if (audition.armed && audition.armed.btn === btn) { stopAudition(); return true; }
  try { if (audioMod && typeof audioMod.initAudio === 'function') audioMod.initAudio(); } catch (e) { console.warn('initAudio failed', e); }
  stopAudition(); player.pause(); player.seek(0);
  audition.armed = { tracks, player, handles: [], btn }; player.play(); fireAudition(); auditionButtons(); return true;
}
function onLoopAudition(player) { if (audition.armed && audition.armed.player === player) { for (const h of audition.armed.handles) { try { h.stop(); } catch (e) { /* ignore */ } } fireAudition(); } }

// ---------------------------------------------------------------- hero + status
function hero() {
  const chips = [['moves', MOVE_NAMES.length], ['beat', `${META.beat.beat_s} s`], ['impact', `${META.beat.impact_s} s`], ['guard set', `${META.beat.guard_s} s`],
    ['servo cap', `${RULES.servo_cap_dps} deg/s`], ['bases', `${RULES.base_gap} m apart`], ['hand', `≤ ${RULES.hand_x_max} m`], ['lift', `≥ ${RULES.lift_min}°`]];
  $('#hero-chips').innerHTML = chips.map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`).join('');
  $('#hero-note').textContent = `Data generated ${META.generated} from ${META.source}.`;
  $('#foot-gen').textContent = `Arm Studio · data generated ${META.generated}`;
}
async function pollStatus() {
  const pills = Object.fromEntries([...document.querySelectorAll('#status .pill')].map(p => [p.dataset.arm, p]));
  const set = (p, cls, text, help) => { p.className = 'pill ' + (p.dataset.arm === 'armA' ? 'a ' : p.dataset.arm === 'armB' ? 'b ' : 'srv ') + cls; p.querySelector('b').textContent = text; p.title = help || ''; };
  try {
    const r = await fetch('../api/status', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const s = await r.json();
    set(pills.server, 'on', 'server', `arms: ${JSON.stringify(s.arms || {})}${s.repo ? ' · chain compiler available' : ' · no JOUST_REPO'}`);
    for (const k of ['armA', 'armB']) {
      const a = s[k] || { offline: true };
      if (a.offline) set(pills[k], 'off', 'offline', a.reason || a.error || 'daemon not reachable');
      else set(pills[k], a.busy ? 'busy' : 'on', a.busy ? 'moving' : (a.torque === false ? 'limp' : 'online'), JSON.stringify(a).slice(0, 300));
    }
  } catch (e) {
    set(pills.server, 'off', 'server?', String(e.message)); for (const k of ['armA', 'armB']) set(pills[k], 'unknown', 'unknown', 'no status');
  }
}

// ---------------------------------------------------------------- library cards
function speedBars(m) {
  const max = Math.max(360, m.stats.peak_max * 1.05);
  return `<div class="speeds">` + K.JOINTS.map((j, i) => { const v = m.peak[j]; const hot = i < 5 && v > K.SERVO_CAP; return `<span class="n">${j}</span><span class="bar"><i class="${hot ? 'hot' : ''}" style="width:${Math.min(100, 100 * v / max)}%"></i><em style="left:${100 * K.SERVO_CAP / max}%"></em></span><span class="v ${hot ? 'hot' : ''}">${v.toFixed(0)}${i < 5 ? '' : ' (jaw)'}</span>`; }).join('') + `</div>`;
}
function flagsHTML(m, dark = false) {
  const hard = m.violations.filter(v => v.severity === 'hard'), adv = m.violations.filter(v => v.severity === 'advisory');
  let h = hard.length ? '' : `<span class="flag ok" data-help="Hand within 0.27 m, blade above the base plane, every positioning servo under 300 deg/s, lift above -89, roll inside the wrap.">passes the hard rules</span>`;
  h += hard.map(v => `<span class="flag hard" data-help="${esc(v.note)} — at t = ${v.t} s" data-help-title="${v.rule}">${v.rule.replace('_', ' ')} ${v.joint && v.joint !== 'hand' && v.joint !== 'blade' ? '· ' + v.joint : ''} @ ${v.t}s</span>`).join('');
  h += adv.map(v => `<span class="flag advisory" data-help="${esc(v.note)} — at t = ${v.t} s" data-help-title="advisory">${v.rule.replace(/_/g, ' ')} @ ${v.t}s</span>`).join('');
  return h;
}
function keyStats(m) {
  const s = m.stats; const hx = s.max_hand_x > K.HAND_X_MAX + 1e-3, bz = s.min_blade_z < 0, pk = s.peak_max > K.SERVO_CAP;
  return `<div class="kstats">
    <span>max hand x <b class="${hx ? 'hot' : ''}">${s.max_hand_x.toFixed(3)} m</b></span><span>min blade z <b class="${bz ? 'hot' : ''}">${(s.min_blade_z * 100).toFixed(1)} cm</b></span>
    <span>peak servo <b class="${pk ? 'hot' : ''}">${s.peak_max.toFixed(0)} deg/s ${s.peak_max_joint}</b></span><span>end blade pitch <b>${s.end_pitch.toFixed(0)}°</b></span>
    <span>min wrist pitch z <b>${(s.min_wrist_flex_z * 100).toFixed(1)} cm</b></span><span>min wrist roll z <b>${(s.min_wrist_roll_z * 100).toFixed(1)} cm</b></span>
    <span>lift range <b>${s.min_lift.toFixed(0)}° min</b></span><span>real roll <b>${s.roll_real_range[0].toFixed(0)}…${s.roll_real_range[1].toFixed(0)}°</b></span>
  </div>`;
}
function paramsHTML(m) {
  const p = m.params; if (!p || !p.rows.length) return '';
  return `<div class="params">` + p.rows.map(r => `<span class="k ${r.help ? '' : 'nohelp'}" ${r.help ? `data-help="${esc(r.help)}" data-help-title="${esc(r.key)}"` : ''}>${esc(r.key)}</span><span class="val">${esc(Array.isArray(r.value) ? '[' + r.value.join(', ') + ']' : r.value)}</span>`).join('') + `</div>` + (p.stale ? `<div class="stale">sim/params/${m.name}.json has changed since this trajectory was tuned</div>` : '');
}
function buildCards() {
  const wrap = $('#cards'); wrap.innerHTML = '';
  const names = [...MOVE_NAMES, ...CHAIN_NAMES];
  for (const n of names) {
    const m = ALL[n]; const card = el('article', `card type-${m.type}`); card.dataset.type = m.type; card.dataset.name = n;
    const hard = m.violations.some(v => v.severity === 'hard'), adv = m.violations.some(v => v.severity === 'advisory');
    card.innerHTML = `<div class="band"><i class="ok ${hard ? 'bad' : adv ? 'warn' : ''}" data-help="${hard ? 'breaks a hard rule' : adv ? 'advisory notes only' : 'clean'}"></i>${esc(n)}<span class="type">${m.type}${m.chain ? ' · ' + m.chain.join(' → ') : ''}</span><span class="dur">${m.duration.toFixed(2)} s</span></div>`;
    if (m.video) {
      const clip = el('div', 'clip'); const v = document.createElement('video'); v.src = m.video; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.addEventListener('loadedmetadata', () => { if (v.paused && v.currentTime === 0) v.currentTime = Math.min(0.6, v.duration / 2); }, { once: true });   // decode a poster frame (mid-move, not the rest pose)
      clip.append(v, el('span', 'hint', 'hover to play')); card.appendChild(clip);
      let pinned = false; const play = () => { clip.classList.add('playing'); v.play().catch(() => {}); }; const stop = () => { clip.classList.remove('playing'); v.pause(); };
      clip.onmouseenter = play; clip.onmouseleave = () => { if (!pinned) stop(); }; clip.onclick = () => { pinned = !pinned; pinned ? play() : stop(); };
    } else if (m.beats) {
      const b = el('div', 'body'); b.innerHTML = `<h4>Beats <small>compiled by sim/chain.py</small></h4><div class="kstats">` + m.beats.map((bt, i) => `<span>${i + 1}. ${bt.move} <b>${bt.start}–${bt.end}s · pin ${bt.pinned_at}s · ${esc(bt.transition)}</b></span>`).join('') + `</div>`; card.appendChild(b);
    }
    if (m.params && m.params.doc) card.appendChild(el('div', 'doc', esc(m.params.doc)));
    const body = el('div', 'body');
    body.innerHTML = `<h4>Peak servo speed <small>deg/s · cap ${K.SERVO_CAP}</small></h4>${speedBars(m)}
      <h4>Key poses <small>${m.keys.length} keys · real degrees [pan, lift, elbow, wrist, roll, jaw]</small></h4><div class="keys"></div>
      <h4>Audit</h4><div class="flags">${flagsHTML(m)}</div>${keyStats(m)}` + (m.params && m.params.rows.length ? `<h4>Parameters <small>hover a name for its help</small></h4>${paramsHTML(m)}` : '');
    card.appendChild(body);
    const keys = body.querySelector('.keys');
    m.keys.forEach((k, i) => {
      const isPin = m.pin && m.pin.key === i; const kd = el('div', 'key' + (isPin ? ' pin' : '')); const c = document.createElement('canvas'); kd.appendChild(c);
      kd.appendChild(el('div', 'kt', `${isPin ? (m.type === 'block' ? 'guard ' : 'impact ') : 'k' + i + ' '}${f2(m.key_times[i])}s`)); kd.appendChild(el('div', 'kq', `[${k.map(v => v.toFixed(0)).join(',')}]`));
      kd.dataset.help = `key ${i} at ${f2(m.key_times[i])} s: [${k.map(v => v.toFixed(1)).join(', ')}]` + (isPin ? ` — pinned at ${m.pin.beat_t} s of the beat by chain.py` : ''); keys.appendChild(kd);
      requestAnimationFrame(() => drawMiniPose(c, K.toSim(k)));
    });
    const actions = el('div', 'actions');
    const bView = el('button', 'btn quiet', 'Trajectory'); bView.onclick = () => { viewer.load(n); location.hash = '#viewer'; viewer.player.play(); };
    const bA = el('button', 'btn', 'A ⟶ pair'); bA.onclick = () => { pair.set(n, null); location.hash = '#pair'; };
    const bB = el('button', 'btn blue', 'B ⟶ pair'); bB.onclick = () => { pair.set(null, n); location.hash = '#pair'; };
    const bAud = el('button', 'btn quiet audition', 'Audition'); bAud.disabled = !servo; bAud.title = servo ? 'Play the servo sound in sync with the canvas' : 'Needs ../src/audio/servo.js'; bAud.onclick = () => { viewer.load(n); location.hash = '#viewer'; startAudition([{ move: m, arm: 'a', offset: 0, sync: true }], viewer.player, $('#v-audition')); };
    actions.append(bView, bA, bB, bAud); card.appendChild(actions); wrap.appendChild(card);
  }
  const filters = $('#filters'); const types = ['all', 'attack', 'feint', 'block', 'rest', 'chain'];
  filters.innerHTML = types.map(t => `<button data-t="${t}" class="${t === 'all' ? 'on' : ''}">${t}</button>`).join('');
  filters.onclick = e => { const b = e.target.closest('button'); if (!b) return; filters.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); for (const c of wrap.children) c.classList.toggle('hidden', b.dataset.t !== 'all' && c.dataset.type !== b.dataset.t); };
}

// ---------------------------------------------------------------- trajectory viewer
const viewer = {
  view: null, plot: null, player: null, move: null, trail: null, restB: null,
  init() {
    this.view = new ArenaView($('#stage-canvas'), $('#inset-canvas')); this.plot = new VelPlot($('#vel-canvas'), $('#vel-legend'));
    this.restB = K.poseWorld(K.toSim(REST_Q), 'B'); this.restB.pan = REST_Q[0];
    const sel = $('#v-move'); sel.innerHTML = `<optgroup label="moves">${MOVE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</optgroup>` + (CHAIN_NAMES.length ? `<optgroup label="compiled chains">${CHAIN_NAMES.map(n => `<option value="${n}">${n} (${ALL[n].chain.join(' → ')})</option>`).join('')}</optgroup>` : '');
    sel.onchange = () => this.load(sel.value);
    this.player = new Player({ playBtn: $('#v-play'), scrub: $('#v-scrub'), timeEl: $('#v-time'), speedSel: $('#v-speed'), loopChk: $('#v-loop'), onTime: t => this.render(t), onStop: stopAudition, onLoop: () => onLoopAudition(this.player) });
    $('#v-trail').onchange = () => this.render(this.player.t);
    $('#v-audition').onclick = () => startAudition([{ move: this.move, arm: 'a', offset: 0, sync: true }], this.player, $('#v-audition'));
    $('#v-joints').innerHTML = K.JOINTS.map((j, i) => `<div class="jrow"><span class="n" style="color:${JOINT_COLORS[i]}">${j}</span><span class="bar"><em></em><i></i></span><span class="v"></span><span class="s"></span></div>`).join('');
    this.jrows = [...$('#v-joints').children].map(r => ({ i: r.querySelector('i'), v: r.querySelector('.v'), s: r.querySelector('.s') }));
    this.load(MOVE_NAMES[0]);
  },
  load(name) {
    this.move = ALL[name]; if (!this.move) return; $('#v-move').value = name; stopAudition();
    this.trail = tipTrail(this.move, 'A'); this.player.setDuration(this.move.duration); this.plot.setMove(this.move); keyMarks($('#v-keys'), this.move, this.move.duration);
    $('#v-audit').innerHTML = flagsHTML(this.move); this.player.seek(0);
  },
  render(t) {
    const m = this.move; if (!m) return; const q = K.sampleQ(m, t); const qs = K.toSim(q); const poseA = K.poseWorld(qs, 'A'); poseA.pan = q[0];
    this.view.draw({ A: poseA, B: this.restB, trails: $('#v-trail').checked ? { A: this.trail } : null, frac: t / m.duration, caption: `${m.name} · ${f2(t)} s` });
    this.plot.draw(t);
    const v = K.sampleAt(m.vel, m.t, t);
    K.JOINTS.forEach((j, i) => { const r = this.jrows[i]; const [lo, hi] = META.joint_range_sim[j]; const sim = qs[i]; const frac = (sim - lo) / (hi - lo);
      r.i.style.left = (100 * Math.max(0, Math.min(1, frac))) + '%'; r.v.textContent = q[i].toFixed(1) + '°'; const sp = Math.abs(v[i]); r.s.textContent = sp.toFixed(0) + '°/s'; r.s.classList.toggle('hot', i < 5 && sp > K.SERVO_CAP); });
    const f = poseA.own; const hx = f.handR > K.HAND_X_MAX + 1e-3;
    $('#v-hand').innerHTML = `<div><span>hand reach (x)</span><b class="${hx ? 'hot' : ''}">${f.handR.toFixed(3)} m</b></div><div><span>hand height (z)</span><b>${f.hilt[2].toFixed(3)} m</b></div><div><span>hand sideways (y)</span><b>${f.hilt[1].toFixed(3)} m</b></div>
      <div><span>blade tip x / z</span><b class="${f.tip[2] < 0 ? 'hot' : ''}">${f.tip[0].toFixed(3)} / ${f.tip[2].toFixed(3)} m</b></div><div><span>blade pitch</span><b>${f.pitch.toFixed(0)}°</b></div>
      <div><span>wrist pitch joint z</span><b class="${f.anchors[3][2] < K.WRIST_FLOORS.wrist_flex ? 'hot' : ''}">${(f.anchors[3][2] * 100).toFixed(1)} cm</b></div><div><span>wrist roll joint z</span><b class="${f.anchors[4][2] < K.WRIST_FLOORS.wrist_roll ? 'hot' : ''}">${(f.anchors[4][2] * 100).toFixed(1)} cm</b></div>
      <div><span>sim roll (real − 76)</span><b>${qs[4].toFixed(0)}°</b></div>`;
  },
};

// ---------------------------------------------------------------- pair viewer
const pair = {
  view: null, player: null, a: null, b: null, align: null, curve: null, min: null,
  init() {
    this.view = new ArenaView($('#pair-canvas'), $('#pair-inset'));
    const opts = `<optgroup label="moves">${MOVE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</optgroup>` + (CHAIN_NAMES.length ? `<optgroup label="compiled chains">${CHAIN_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')}</optgroup>` : '');
    $('#p-a').innerHTML = opts; $('#p-b').innerHTML = opts; $('#p-a').onchange = $('#p-b').onchange = () => this.set($('#p-a').value, $('#p-b').value);
    this.player = new Player({ playBtn: $('#p-play'), scrub: $('#p-scrub'), timeEl: $('#p-time'), speedSel: $('#p-speed'), loopChk: $('#p-loop'), onTime: t => this.render(t), onStop: stopAudition, onLoop: () => onLoopAudition(this.player) });
    $('#p-audition').onclick = () => { if (this.a) startAudition([{ move: this.a, arm: 'a', offset: this.align.offA, sync: true }, { move: this.b, arm: 'b', offset: this.align.offB, sync: false }], this.player, $('#p-audition')); };
    new ResizeObserver(() => this.drawCurve()).observe($('#dist-canvas'));
    this.buildMatrix();
    this.set(MOVES.ATTACK_HIGH ? 'ATTACK_HIGH' : MOVE_NAMES[0], MOVES.BLOCK_HIGH ? 'BLOCK_HIGH' : MOVE_NAMES[0]);
  },
  set(a, b) {
    if (a) $('#p-a').value = a; if (b) $('#p-b').value = b; a = $('#p-a').value; b = $('#p-b').value; this.a = ALL[a]; this.b = ALL[b]; stopAudition();
    const chainy = !!(this.a.chain || this.b.chain);
    this.align = chainy ? { offA: 0, offB: 0, stretch: 0, impactT: null, guardT: null, duration: Math.max(this.a.duration, this.b.duration) } : K.alignPair(this.a, this.b);
    // distance curve at 50 Hz
    const n = Math.round(this.align.duration * 50) + 1; this.curve = new Array(n); this.min = { d: Infinity, t: 0 };
    for (let i = 0; i < n; i++) { const t = i / 50; const c = this.closest(t); this.curve[i] = c.d; if (c.d < this.min.d) this.min = { d: c.d, t }; }
    this.player.setDuration(this.align.duration);
    this.trails = { A: tipTrail(this.a, 'A'), B: tipTrail(this.b, 'B') };
    const km = $('#p-keys'); km.innerHTML = ''; km.classList.add('two'); const kA = el('div'), kB = el('div'); keyMarks(kA, this.a, this.align.duration, this.align.offA); keyMarks(kB, this.b, this.align.duration, this.align.offB);
    [...kA.children].forEach(s => { s.classList.add('arm-a'); s.textContent = 'A ' + s.textContent; km.appendChild(s); }); [...kB.children].forEach(s => { s.classList.add('arm-b'); s.textContent = 'B ' + s.textContent; km.appendChild(s); });
    const al = this.align; const pre = PAIRS.pairs[a] && PAIRS.pairs[a][b];
    $('#p-align').innerHTML = `<div><span>A ${esc(a)} starts at</span><b>${f2(al.offA)} s</b></div><div><span>B ${esc(b)} starts at</span><b>${f2(al.offB)} s</b></div>` +
      (chainy ? `<div><span>chains</span><b>compiled together, no padding</b></div>` : `<div><span>impact on the beat clock</span><b>${f2(al.impactT)} s</b></div><div><span>guard set</span><b>${f2(al.guardT)} s</b></div><div><span>beat stretched by</span><b class="${al.stretch > 0.005 ? 'hot' : 'good'}">${f2(al.stretch)} s</b></div>`) +
      `<div><span>pair length</span><b>${f2(al.duration)} s</b></div>` + (pre ? `<div><span>precomputed min (python)</span><b>${pre.min_cm} cm @ ${pre.min_t} s</b></div>` : '');
    this.drawCurve(); this.player.seek(0);
    document.querySelectorAll('#matrix button').forEach(x => x.classList.toggle('sel', x.dataset.a === a && x.dataset.b === b));
  },
  poses(t) {
    const qa = K.sampleQ(this.a, t - this.align.offA), qb = K.sampleQ(this.b, t - this.align.offB);
    const A = K.poseWorld(K.toSim(qa), 'A'), B = K.poseWorld(K.toSim(qb), 'B'); A.pan = qa[0]; B.pan = qb[0]; return { A, B };
  },
  closest(t) { const { A, B } = this.poses(t); const c = K.segClosest(A.hilt, A.tip, B.hilt, B.tip); c.A = A; c.B = B; c.hands = K.norm(K.sub(A.hilt, B.hilt)); return c; },
  render(t) {
    if (!this.a) return; const c = this.closest(t);
    this.view.draw({ A: c.A, B: c.B, trails: this.trails, frac: t / this.align.duration, closest: c, caption: `${this.a.name} vs ${this.b.name} · ${f2(t)} s` });
    const d = $('#pair-dist'); d.className = 'pair-dist ' + (c.d <= 0.024 ? 'touch' : c.d < 0.05 ? 'near' : ''); d.innerHTML = `${cm(c.d)} cm<small>blade to blade${c.d <= 0.024 ? ' · touching' : ''}</small>`;
    $('#p-report').innerHTML = `<div><span>now</span><b class="${c.d <= 0.024 ? 'hot' : ''}">${cm(c.d)} cm</b></div><div><span>closest over the pair</span><b class="${this.min.d <= 0.024 ? 'hot' : this.min.d < 0.05 ? '' : 'good'}">${cm(this.min.d)} cm at ${f2(this.min.t)} s</b></div><div><span>at the end</span><b>${cm(this.curve[this.curve.length - 1])} cm</b></div><div><span>hand to hand now</span><b class="${c.hands < 0.08 ? 'hot' : ''}">${cm(c.hands)} cm</b></div><div><span>touching threshold</span><b>2.4 cm</b></div>`;
    this.drawCurve(t);
  },
  drawCurve(t = this.player ? this.player.t : 0) {
    const cv = $('#dist-canvas'); const { ctx, W, H } = setupCanvas(cv); ctx.fillStyle = '#14100c'; ctx.fillRect(0, 0, W, H); if (!this.curve) return;
    const padL = 30, padR = 8, padT = 8, padB = 18; const ymax = Math.max(0.2, Math.min(0.6, Math.max(...this.curve) * 1.1)); const dur = this.align.duration;
    const X = tt => padL + tt / dur * (W - padL - padR), Y = v => padT + (1 - v / ymax) * (H - padT - padB);
    for (let v = 0; v <= ymax + 1e-9; v += 0.1) { dashed(ctx, padL, Y(v), W - padR, Y(v), 'rgba(233,216,176,0.12)', [1, 3]); label(ctx, (v * 100).toFixed(0), padL - 4, Y(v), 'rgba(233,216,176,0.6)', 9, 'right'); }
    label(ctx, 'cm', 2, padT, 'rgba(233,216,176,0.6)', 9);
    dashed(ctx, padL, Y(0.024), W - padR, Y(0.024), '#ff6a6a', [4, 3]);
    if (this.align.impactT != null) { dashed(ctx, X(this.align.impactT), padT, X(this.align.impactT), H - padB, 'rgba(255,140,140,0.6)', [3, 3]); label(ctx, 'impact', X(this.align.impactT) + 3, padT + 5, '#ff9a9a', 9); }
    if (this.align.guardT != null) { dashed(ctx, X(this.align.guardT), padT, X(this.align.guardT), H - padB, 'rgba(140,180,255,0.6)', [3, 3]); label(ctx, 'guard', X(this.align.guardT) + 3, H - padB - 6, '#9ab8ff', 9); }
    poly(ctx, this.curve.map((d, i) => [X(i / 50), Y(Math.min(d, ymax))]), 1.8, '#f3d27a');
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(t), padT); ctx.lineTo(X(t), H - padB); ctx.stroke(); ctx.restore();
    for (let tt = 0; tt <= dur + 1e-9; tt += 0.5) label(ctx, tt.toFixed(1), X(tt), H - 7, 'rgba(233,216,176,0.6)', 9, 'center');
  },
  buildMatrix() {
    const T = $('#matrix'); const names = PAIRS.moves; const cls = d => d <= 2.4 ? 'touch' : d < 5 ? 'near' : d < 10 ? 'close' : 'clear';
    T.innerHTML = `<thead><tr><th class="corner">A ↓ &nbsp; B →</th>${names.map(n => `<th class="col">${n}</th>`).join('')}</tr></thead><tbody>` +
      names.map(a => `<tr><th class="row">${a}</th>${names.map(b => { const p = PAIRS.pairs[a][b]; return `<td><button class="${cls(p.min_cm)}" data-a="${a}" data-b="${b}" data-help="A ${a} vs B ${b}: closest ${p.min_cm} cm at ${p.min_t} s, ${p.end_cm} cm at the end; hands ${p.min_hand_cm} cm apart at nearest; impact on the clock at ${p.impact_t} s${p.stretch ? ' (beat stretched ' + p.stretch + ' s)' : ''}">${p.min_cm.toFixed(1)}</button></td>`; }).join('')}</tr>`).join('') + `</tbody>`;
    T.onclick = e => { const b = e.target.closest('button'); if (!b) return; this.set(b.dataset.a, b.dataset.b); this.player.play(); };
  },
};

// ---------------------------------------------------------------- data section
function dataSection() {
  const hubs = $('#hubs'); hubs.innerHTML = `<tr><th>hub</th><th>pose</th><th>q sim [pan, lift, elbow, wrist, roll, jaw]</th><th>hand x, z</th><th>tip z</th></tr>` +
    Object.entries(HUBS.poses).map(([n, h]) => `<tr><td><b>${n}</b></td><td class="pose"><canvas data-q="${h.q_sim.join(',')}"></canvas></td><td class="mono">[${h.q_sim.join(', ')}]</td><td class="mono">${h.hand[0].toFixed(3)}, ${h.hand[2].toFixed(3)}</td><td class="mono">${h.tip[2].toFixed(3)}</td></tr>`).join('');
  hubs.querySelectorAll('canvas').forEach(c => requestAnimationFrame(() => drawMiniPose(c, c.dataset.q.split(',').map(Number))));
  $('#hubs-doc').textContent = HUBS.doc;
  const tr = $('#transitions'); tr.innerHTML = `<tr><th>from → to</th><th>via</th></tr>` + Object.entries(TRANS.routes).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono">${(v.via || []).join(' → ')}</td></tr>`).join('');
  $('#transitions-doc').textContent = TRANS.doc;
  const c = META.conventions, r = META.rules; const items = [['joints', c.q], ['roll', c.roll_note], ['pan', c.pan], ['pitch', c.pitch], ['jaw', c.jaw], ['hand', c.hand],
    ['hand rule', `hilt ≤ ${r.hand_x_max} m forward of its own base (centre line at ${r.centre_x} m, bases ${r.base_gap} m apart)`], ['servo cap', `${r.servo_cap_dps} deg/s`], ['lift', `shoulder_lift ≥ ${r.lift_min}° (hard, measured on the arm)`],
    ['roll wrap', `real wrist_roll never crosses ±${r.roll_real_limit}`], ['wrist floors', r.wrist_floors_note], ['beat', META.beat.note], ['B arm', META.geometry.note]];
  $('#conventions').innerHTML = `<dl>${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

// ---------------------------------------------------------------- boot
// ---------------------------------------------------------------- theatre: the MuJoCo clip with the knight foley locked to it
// The clips are rendered from trajectory t=0 at 30 fps with a 0.5 s hold at the end (sim/tune.py replay()), so clip
// time == trajectory time. The foley is scheduled on the audio clock from the instant the video reports `playing`,
// offset by where the video is; pause / seek / end stop it; a playlist walks every move.
const TH = { video: null, name: null, handle: null, playlist: null, meterRAF: 0 };
function theatreEnable() { const b = $('#th-play'), a = $('#th-all'); if (b) { b.disabled = false; b.textContent = 'Play with sound'; } if (a) a.disabled = false; }
function thStopSound() { if (TH.handle) { try { TH.handle.stop(); } catch (e) { /* ignore */ } TH.handle = null; } }
function thSync() {
  thStopSound(); if (!servo || !TH.name) return;
  try { if (audioMod && audioMod.initAudio) audioMod.initAudio(); } catch (e) { /* no audio */ }
  const c = audioMod && audioMod.getCtx ? audioMod.getCtx() : null; if (!c) return;
  const m = servo.getMove(TH.name); if (!m || m.synthetic) return;
  TH.handle = servo.playTrajectory(m.t, m.q, { rate: 1, arm: 'c', at: c.currentTime + 0.02, offset: TH.video.currentTime, impact: m.impact, kind: m.kind, name: TH.name });
  thMeter();
}
function thMeter() {
  if (!servo || !servo.getOutput || !audioMod || !audioMod.getCtx) return; const c = audioMod.getCtx(), o = servo.getOutput(); if (!c || !o) return;
  if (!TH.an) { TH.an = c.createAnalyser(); TH.an.fftSize = 1024; o.connect(TH.an); TH.buf = new Float32Array(1024); }
  cancelAnimationFrame(TH.meterRAF); const bar = $('#th-level'); const t0 = performance.now();
  const tick = () => { TH.an.getFloatTimeDomainData(TH.buf); let p = 0; for (const v of TH.buf) p = Math.max(p, Math.abs(v)); if (bar) bar.style.width = Math.min(100, p * 130) + '%'; if (performance.now() - t0 < 6000 || TH.handle) TH.meterRAF = requestAnimationFrame(tick); else if (bar) bar.style.width = '0%'; };
  TH.meterRAF = requestAnimationFrame(tick);
}
function thLoad(name, { play = false } = {}) {
  const v = TH.video; if (!v) return; thStopSound(); TH.name = name;
  const mv = MOVES[name]; const doc = mv && mv.params && mv.params._doc ? mv.params._doc.split('.')[0] : '';
  $('#th-title').textContent = name; $('#th-sub').textContent = `${doc}${mv ? ` · ${mv.duration.toFixed(2)} s` : ''}${servo && servo.getMove(name) && servo.getMove(name).impact != null ? ` · impact ${servo.getMove(name).impact.toFixed(2)} s` : ''}`;
  for (const b of document.querySelectorAll('#th-moves button')) b.classList.toggle('on', b.dataset.name === name);
  v.src = `videos/tuned_${name}.mp4`; v.load(); if (play) v.play().catch(() => {});
}
function thNext() {
  if (!TH.playlist) return; const i = TH.playlist.indexOf(TH.name); const next = TH.playlist[i + 1];
  if (!next) { TH.playlist = null; $('#th-all').textContent = 'Play all moves'; return; }
  setTimeout(() => thLoad(next, { play: true }), 550);
}
function theatreInit() {
  const v = $('#th-video'); if (!v) return; TH.video = v;
  const names = Object.keys(MOVES).filter(n => !/^CHAIN/.test(n)); const order = ['attack', 'feint', 'block', 'rest'];
  names.sort((a, b) => order.indexOf(MOVES[a].kind) - order.indexOf(MOVES[b].kind) || a.localeCompare(b));
  const box = $('#th-moves'); box.innerHTML = '';
  for (const n of names) { const b = el('button', `th-move ${MOVES[n].kind}`, n); b.dataset.name = n; b.onclick = () => { TH.playlist = null; thLoad(n, { play: true }); }; box.appendChild(b); }
  v.addEventListener('playing', thSync);
  v.addEventListener('pause', () => { if (!v.ended) thStopSound(); });
  v.addEventListener('seeking', thStopSound);
  v.addEventListener('ended', () => { thStopSound(); if (TH.playlist) thNext(); else if ($('#th-loop').checked) { v.currentTime = 0; v.play().catch(() => {}); } });
  $('#th-play').onclick = () => { TH.playlist = null; if (!TH.name) thLoad(names[0]); v.currentTime = 0; v.play().catch(() => {}); };
  $('#th-all').onclick = () => { if (TH.playlist) { TH.playlist = null; v.pause(); $('#th-all').textContent = 'Play all moves'; return; } TH.playlist = names.filter(n => n !== 'REST'); $('#th-all').textContent = 'Stop the run'; thLoad(TH.playlist[0], { play: true }); };
  $('#th-stop').onclick = () => { TH.playlist = null; $('#th-all').textContent = 'Play all moves'; v.pause(); thStopSound(); };
  thLoad(names[0]);
}

// ---------------------------------------------------------------- interactions: the rules table as a matrix
const IX_CARDS = ['chop', 'slash_l', 'thrust', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'parry_high', 'parry_low', 'brace', 'windup', 'flourish', 'rest'];
const IX_KIND = {   // headline, css class, special?
  clash: ['Clash', 'k-clash', true], both_hit: ['Both hit', 'k-hit', false], blocked: ['Blocked', 'k-block', false], hit: ['Hit', 'k-hit', false],
  feint_punished: ['Punished', 'k-punish', true], clean_hit: ['Clean hit', 'k-clean', true], feint_exposed: ['Exposed', 'k-expose', true], feint_braced: ['Braced', 'k-block', false],
  double_feint: ['Both flinch', 'k-trick', true], double_guard: ['Stare-down', 'k-none', false], feint_wasted: ['Feint at air', 'k-none', false], nothing: ['Nothing', 'k-none', false],
};
const IX_CUES = {   // what the game layers on the outcome (match.js): foley transient, crowd, who barks what
  clash: 'foley: bind of steel (both). crowd: cheer. bark: one fighter, "clash". both grunt.',
  both_hit: 'foley: two clangs. crowd: ooh. barks: hit_landed / took_hit (coin flip).',
  blocked: 'foley: parry ring / shield thud / scrape. crowd: cheer if you blocked, boo if they turtled. bark: blocker "blocked" (or "parry"), attacker "got_blocked".',
  hit: 'foley: clang + thud on the plate (wrong guard: +1). crowd: cheer / ooh. bark: "hit_landed" sometimes, victim "took_hit".',
  feint_punished: 'foley: clang + thud. crowd: cheer / ooh. bark: attacker gloats "punished_feint", victim ouch.',
  clean_hit: 'foley: heavy wham, then the stagger sway. crowd: cheer / ooh. bark: attacker "clean_hit"; victim ouch, then "staggered".',
  feint_exposed: 'foley: swish and jingle. crowd: laugh (gasp if it was you). bark: feinter gloats "feint_worked" with a laugh; the guard gasps, then "exposed".',
  feint_braced: 'foley: swish into a clank. bark: none.',
  double_feint: 'foley: two swishes. crowd: laugh. bark: "double_feint", both hmm.',
  double_guard: 'foley: two armour clanks. crowd: a small boo.',
  feint_wasted: 'foley: swish. crowd: laugh.',
  nothing: 'quiet beat (Wind Up: roar + "windup"; Flourish: cheer + stars).',
};
function ixCard(id) { return id === 'rest' ? REST : CARDS[id]; }
function ixLabel(c) { const line = c.type === 'attack' ? (c.line === 'any' ? 'any line' : c.line) : c.type === 'block' ? 'blocks ' + (c.blocks.length === 2 ? 'both' : c.blocks[0]) : c.type === 'feint' ? c.line + ' feint' : c.type === 'special' ? 'trick' : 'open'; return `${c.name}<small>${line}${c.taught === false ? ' · untaught' : ''}</small>`; }
function ixHw(c) { return c.taught === false && c.fallback ? c.fallback : c.hw; }
function ixStatus(st) { const out = []; if (st.exposed) out.push('Exposed'); if (st.staggered) out.push('Staggered'); if (st.riposte) out.push('Riposte +2'); if (st.parry) out.push('Parry ×2'); if (st.windup) out.push('Wind up +3'); if (st.flourish) out.push('+' + st.flourish + ' cards'); return out.join(', ') || '–'; }
let crowdMod = null, voiceMod = null, barksMod = null;
(async () => { try { crowdMod = await import('../src/audio/crowd.js'); voiceMod = await import('../src/audio/voice.js'); barksMod = await import('../src/game/barks.js'); } catch (e) { console.info('sound board: crowd/voice/barks not loaded', e.message); } })();
const IX_CROWD = { clash: ['cheer', 1.1], both_hit: ['ooh', 1.2], blocked: ['cheer', 0.6], hit: ['cheer', 0.9], feint_punished: ['cheer', 1.0], clean_hit: ['cheer', 1.3], feint_exposed: ['laugh', 0.9], feint_braced: ['laugh', 0.5], double_feint: ['laugh', 1], double_guard: ['boo', 0.4], feint_wasted: ['laugh', 0.7], nothing: null };
const IX_BARK = { clash: ['a', 'clash'], both_hit: ['a', 'hit_landed'], blocked: ['b', 'blocked'], hit: ['a', 'hit_landed'], feint_punished: ['a', 'punished_feint'], clean_hit: ['a', 'clean_hit'], feint_exposed: ['a', 'feint_worked'], double_feint: ['a', 'double_feint'], feint_wasted: ['b', 'plan'] };
let ixHandles = [], ixCrowdOff = 0;
function playInteraction(A, B, r) {
  if (!servo) return; try { if (audioMod && audioMod.initAudio) audioMod.initAudio(); } catch (e) {}
  for (const h of ixHandles) { try { h.stop(); } catch (e) {} } ixHandles = [];
  const kinds = { a: undefined, b: undefined };
  for (const e of r.events) { if (e.type === 'hit') kinds[e.from] = 'hit'; else if (e.type === 'blocked') { kinds[e.attacker] = 'block'; kinds[e.blocker] = 'block'; } else if (e.type === 'clash') { kinds.a = 'clash'; kinds.b = 'clash'; } }
  const beatMs = 1400, IMP = 0.7;
  for (const [s, c] of [['a', A], ['b', B]]) { const hw = r.played[s].hw === 'STAGGER' || r.played[s].hw === 'REST' ? r.played[s].hw : ixHw(c); ixHandles.push(servo.playMove(hw, { beatMs, arm: s, impactAt: IMP, guardAt: 0.4, impact: kinds[s] })); }
  const cr = IX_CROWD[r.kind]; if (cr && crowdMod) { try { if (!crowdMod.crowd.running) { crowdMod.crowd.start(); crowdMod.crowd.setEnergy(0.55); } setTimeout(() => crowdMod.crowd.react(cr[0], cr[1]), beatMs * IMP); clearTimeout(ixCrowdOff); ixCrowdOff = setTimeout(() => { try { crowdMod.crowd.stop(); } catch (e) {} }, 6000); } catch (e) {} }   // the bed fades out a few seconds after the last click
  const bk = IX_BARK[r.kind]; if (bk && voiceMod && barksMod) { try { const [side, ev] = bk; const who = side === 'a' ? 'lionheart' : 'percival'; const line = barksMod.bark(who, ev); if (line) setTimeout(() => { voiceMod.say(line, { voice: voiceMod.VOICES[who], mood: barksMod.barkMood(who, ev), charMs: 26 }); $('#ix-detail').insertAdjacentHTML('beforeend', `<span class="row"><b>${who === 'lionheart' ? 'Lionheart' : 'Sir Percival'}:</b> "${line}"</span>`); }, beatMs * IMP + 250); } catch (e) {} }
  const [x, y] = r.events.some(e => e.type === 'staggered') ? ['staggered', 1] : [null, 0]; if (x) setTimeout(() => { try { ixHandles.push(servo.playMove('STAGGER', { beatMs, arm: r.events.find(e => e.type === 'staggered').side })); } catch (e) {} }, beatMs);
}
function interactions() {
  const table = $('#ix-table'); if (!table) return; const detail = $('#ix-detail'); const dimBox = $('#ix-special');
  const cards = IX_CARDS.map(ixCard);
  let html = '<thead><tr><th class="row">you ↓ · them →</th>' + cards.map(c => `<th>${ixLabel(c)}</th>`).join('') + '</tr></thead><tbody>';
  const cells = [];
  for (const A of cards) {
    html += `<tr><th class="row">${ixLabel(A)}</th>`;
    for (const B of cards) {
      const r = resolveBeat(A.id === 'rest' ? null : A, B.id === 'rest' ? null : B, emptyStatus(), emptyStatus());
      const [label, cls, special] = IX_KIND[r.kind] || [r.kind, 'k-none', false];
      const dmg = [r.damage.b ? `you deal ${r.damage.b}` : '', r.damage.a ? `you take ${r.damage.a}` : ''].filter(Boolean).join(' · ');
      const extras = r.events.filter(e => ['windup', 'flourish', 'riposte_set', 'parry_set', 'staggered', 'exposed'].includes(e.type)).map(e => ({ windup: 'wind up +3', flourish: 'draw 2', riposte_set: 'riposte +2', parry_set: 'parry ×2', staggered: 'stagger', exposed: 'exposed' }[e.type])).join(', ');
      const i = cells.length; cells.push({ A, B, r, special, label });
      html += `<td class="${cls}${special ? '' : ' plain'}" data-i="${i}"><b>${label}</b>${dmg || extras ? `${dmg}${dmg && extras ? '<br>' : ''}${extras}` : ''}</td>`;
    }
    html += '</tr>';
  }
  table.innerHTML = html + '</tbody>';
  const applyDim = () => { for (const td of table.querySelectorAll('td')) td.classList.toggle('dim', dimBox.checked && td.classList.contains('plain')); };
  dimBox.onchange = applyDim; applyDim();
  table.addEventListener('click', e => { const td = e.target.closest('td'); if (!td) return; const { A, B, r } = cells[+td.dataset.i]; playInteraction(A, B, r); td.classList.add('played'); setTimeout(() => td.classList.remove('played'), 1600); });
  table.addEventListener('mouseover', e => {
    const td = e.target.closest('td'); if (!td) return; const { A, B, r, label } = cells[+td.dataset.i];
    const hwA = ixHw(A), hwB = ixHw(B); const p = PAIRS && PAIRS.pairs && PAIRS.pairs[hwA] && PAIRS.pairs[hwA][hwB];
    const phys = p ? `${hwA} vs ${hwB}: blades come within <b>${p.min_cm.toFixed(1)} cm</b> at ${p.min_t.toFixed(2)} s${p.min_cm <= p.touch_cm ? ' (contact)' : ''}, ending ${p.end_cm.toFixed(1)} cm apart` : `${hwA} vs ${hwB}: no simulated pair`;
    const untaught = [A, B].filter(c => c.taught === false).map(c => `${c.name} is not taught yet (the arm plays ${c.fallback})`).join('; ');
    detail.innerHTML = `<span class="row"><b>${A.name}</b> against <b>${B.name}</b>: ${label}. ${r.events.map(e => e.type).join(' → ') || 'no events'}.</span>
      <span class="row">Damage: you deal ${r.damage.b}, you take ${r.damage.a}. Statuses after: you ${ixStatus(r.status.a)}; them ${ixStatus(r.status.b)}.</span>
      <span class="row">Arms: ${phys}.${untaught ? ' ' + untaught + '.' : ''}</span>
      <span class="row">Cues: ${IX_CUES[r.kind] || ''}</span>`;
  });
}

hero(); theatreInit(); interactions(); buildCards(); viewer.init(); pair.init(); dataSection();
pollStatus(); setInterval(pollStatus, 4000);
loadServo();
$('#reel').play().catch(() => {});
window.armStudio = { viewer, pair, MOVES, CHAINS, META, K };
