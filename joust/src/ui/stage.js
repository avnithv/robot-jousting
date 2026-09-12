// The arena: Tiltford built from the town + arena sheets, two arm sprites, and everything that pops,
// floats, shakes or flashes. Stage coordinates are 1600 x 900; y is the ground line for bottom-anchored props.
import { sfx } from '../audio/audio.js';

export const W = 1600, H = 900;
export const GROUND_Y = 660;
export const HOME = { a: 440, b: 1160 };     // plinth centre x at rest
export const CLASH = { a: 600, b: 1000 };    // plinth centre x during the exchange
export const IMPACT = 0.7;                   // fraction of the beat at which attacks land (1.0 s of 1.4 s)
const SCALE = { arms2: 2.05, arms: 1.5 };    // the two arm sheets were drawn at different sizes

const wait = ms => new Promise(r => setTimeout(r, ms));
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

// The scene: [layer, 'sheet:prop', x (anchor), y (ground), scale, options]
const SCENE = [
  ['town', 'town:tavern', 250, 452, 1.15],
  ['town', 'town:forge', 1350, 452, 1.15],
  ['town', 'arena:gate', 800, 452, 1.1],
  ['town', 'arena:scoreboard', 800, 172, 1.05, { flip: true, id: 'scoreboard' }],
  ['town', 'arena:grandstand', 400, 505, 1.15],
  ['town', 'arena:grandstand', 1200, 505, 1.15, { flip: true }],
  ['town', 'arena:flags_pair', 118, 470, 1.35, { cls: 'flag' }],
  ['town', 'arena:flags_red_cream', 1482, 470, 1.35, { cls: 'flag', flip: true }],
  ['mid', 'arena:heralds_box', 800, 545, 0.95],
  ['mid', 'arena:brazier_tall', 640, 575, 1.4],
  ['mid', 'arena:brazier_tall', 960, 575, 1.4, { flip: true }],
  ['mid', 'arena:banner_blue_post', 1105, 570, 1.3],
  ['mid', 'arena:banner_red_post', 495, 570, 1.3],
  ['fore', 'town:barrel_large', 60, 900, 1.35],
  ['fore', 'town:barrel_small', 150, 890, 1.25],
  ['fore', 'arena:training_dummy', 250, 905, 1.35],
  ['fore', 'arena:trophy', 1560, 905, 1.05],
  ['fore', 'arena:supplies', 1400, 900, 1.2],
  ['fore', 'arena:wheel', 1275, 895, 1.15],
];
const GROUND = [['arena:cobbles_a', 800, 770, 1.6], ['arena:dirt_a', 330, 800, 1.6], ['arena:dirt_b', 1120, 830, 1.5], ['arena:rocks_grass', 1260, 705, 1.3], ['arena:rocks_small', 520, 850, 1.3], ['arena:cobbles_b', 1060, 700, 1.3], ['arena:dirt_small', 260, 715, 1.3], ['town:grass_patch', 1380, 780, 0.9]];

export class Stage {
  constructor(root, atlases) {
    this.root = root; this.atlas = atlases;
    this.L = {}; for (const id of ['sky', 'far', 'town', 'crowd', 'mid', 'ground', 'arena', 'fore', 'fx', 'hud', 'table', 'dialogue', 'overlay']) this.L[id] = root.querySelector('#' + id);
    this.arms = {}; this.pos = { a: HOME.a, b: HOME.b }; this.pose = { a: 'rest', b: 'rest' };
  }

  // ---- sprite lookup ----
  ref(spec, order = ['arena', 'town', 'crowd']) {   // 'sheet:name' or 'name' searched through `order`
    let dir = null, name = spec;
    if (spec.includes(':')) [dir, name] = spec.split(':');
    for (const d of dir ? [dir] : order) if (this.atlas[d]?.[name]) return [d, this.atlas[d][name]];
    throw new Error('no sprite ' + spec);
  }
  img(spec, order) { const [dir, a] = this.ref(spec, order); const i = document.createElement('img'); i.src = `assets/${dir}/${a.file}`; i.dataset.name = a.file; return [i, a, dir]; }
  prop(layer, spec, x, y, scale = 1, opts = {}) {
    const [i, a] = this.img(spec); i.className = 'prop' + (opts.flip ? ' flip' : '') + (opts.cls ? ' ' + opts.cls : '');
    i.style.width = a.w * scale + 'px'; i.style.height = a.h * scale + 'px';
    const ax = opts.flip ? a.w - a.anchor[0] : a.anchor[0];
    i.style.left = x - ax * scale + 'px'; i.style.top = y - a.h * scale + 'px';
    if (opts.z) i.style.zIndex = opts.z; if (opts.id) i.id = opts.id;
    this.L[layer].appendChild(i); return i;
  }

  // ---- building ----
  build() {
    const sky = this.L.sky; el('div', 'sunhaze', sky); el('div', 'sun', sky);
    for (let i = 0; i < 5; i++) { const c = el('div', 'cloud', sky); c.style.left = '0px'; c.style.top = 60 + i * 55 + 'px'; c.style.width = 90 + i * 30 + 'px'; c.style.animationDuration = 140 + i * 40 + 's'; c.style.animationDelay = -i * 37 + 's'; c.style.opacity = 0.45 + i * 0.08; }
    for (const k of ['a', 'b', 'c', 'd']) el('div', 'hill ' + k, this.L.far);
    for (const [layer, name, x, y, s, o] of SCENE) this.prop(layer, name, x, y, s, o);
    for (const [x, y, s, delay] of [[420, 165, 1.35, 0], [1180, 165, 1.35, 1.6]]) { const b = this.prop('town', 'town:heraldic_bunting', x, y, s, { cls: 'sway' }); b.style.animationDelay = -delay + 's'; }
    // live scoreboard digits over the painted "0 0"
    const sb = this.root.querySelector('#scoreboard'); const r = { left: parseFloat(sb.style.left), top: parseFloat(sb.style.top), w: parseFloat(sb.style.width), h: parseFloat(sb.style.height) };
    this.score = {};
    for (const [side, fx] of [['a', 0.13], ['b', 0.55]]) { const d = el('div', 'scorenum', this.L.hud); d.style.left = r.left + r.w * fx + 'px'; d.style.top = r.top + r.h * 0.41 + 'px'; d.style.width = r.w * 0.31 + 'px'; d.textContent = ''; this.score[side] = d; }
    // glows: tavern lanterns, forge fire, gate torches, braziers
    for (const [x, y, rad] of [[195, 305, 55], [420, 315, 50], [1335, 385, 110], [1240, 300, 40], [610, 405, 45], [990, 405, 45], [640, 470, 70], [960, 470, 70]]) { const g = el('div', 'glow', this.L.town); g.style.left = x - rad + 'px'; g.style.top = y - rad + 'px'; g.style.width = rad * 2 + 'px'; g.style.height = rad * 2 + 'px'; g.style.animationDelay = -Math.random() * 2 + 's'; }
    for (let i = 0; i < 6; i++) { const s = el('div', 'smoke', this.L.town); s.style.left = '1300px'; s.style.top = '95px'; s.style.animationDelay = -i * 0.85 + 's'; }
    // crowd: painted spectators (assets/crowd) on the grandstand tiers, packed groups along the fence, the court behind the heralds
    const crowd = this.L.crowd; const C = this.atlas.crowd || {};
    const groups = ['crowd_44', 'crowd_45', 'crowd_09'].filter(n => C[n]); const singles = Object.keys(C).filter(n => !groups.includes(n));
    const spec = (name, x, y, scale, opts = {}) => {
      if (!C[name]) return; const i = this.prop('crowd', 'crowd:' + name, x, y, scale, { flip: opts.flip, cls: 'spec' }); i.style.zIndex = Math.round(y);
      i.style.animationDuration = 1.8 + Math.random() * 1.8 + 's'; i.style.animationDelay = -Math.random() * 3 + 's'; i.style.setProperty('--jump', 8 + Math.random() * 10 + 'px'); return i;
    };
    if (singles.length) {
      for (const cx of [400, 1200]) for (const [gy, sc] of [[398, 0.3], [428, 0.33], [458, 0.36]]) for (let x = cx - 225; x < cx + 225; x += 24 + Math.random() * 14) spec(singles[Math.floor(Math.random() * singles.length)], x, gy + Math.random() * 6, sc * (0.9 + Math.random() * 0.2), { flip: Math.random() < 0.5 });
      for (const [g, x, sc] of [['crowd_44', 210, 0.5], ['crowd_45', 560, 0.48], ['crowd_45', 1120, 0.48], ['crowd_44', 1420, 0.5]]) spec(g, x, 512, sc, { flip: x > 800 });
      spec('crowd_09', 800, 500, 0.42);   // the court, behind the heralds' box
      for (let x = 40; x < 1600; x += 70 + Math.random() * 60) spec(singles[Math.floor(Math.random() * singles.length)], x, 505 + Math.random() * 8, 0.38, { flip: Math.random() < 0.5 });
    } else {   // fallback: silhouettes
      const caps = ['#b8262b', '#1e4e9c', '#d9a441', '#6b4a9c', '#3a7a3a'];
      for (let x = 20; x < 1580; x += 36) { const h = el('div', 'head', crowd); h.style.left = x + 'px'; h.style.top = 470 + 'px'; if (Math.random() < 0.5) { h.classList.add('cap'); h.style.setProperty('--c', caps[Math.floor(Math.random() * caps.length)]); } }
    }
    // fence line with hanging banners
    for (let x = -30; x < 1700; x += 338) this.prop('mid', 'arena:fence_banners_long', x, 565, 1.15);
    // ground
    el('div', 'lists', this.L.ground); el('div', 'chalk', this.L.ground);
    for (const [name, x, y, s] of GROUND) this.prop('ground', name, x, y, s);
    // arms
    this.arms.a = this.makeArm('a', 'red'); this.arms.b = this.makeArm('b', 'blue');
  }
  makeArm(side, color) {
    const wrap = el('div', 'arm' + (side === 'b' ? ' mirror' : ''), this.L.arena); wrap.style.left = HOME[side] + 'px'; wrap.style.top = GROUND_Y + 'px';
    el('div', 'shadow', wrap);
    const inner = el('div', 'arm-inner', wrap);
    const imgs = [];
    for (let k = 0; k < 2; k++) { const i = document.createElement('img'); i.className = 'pose hidden'; inner.appendChild(i); imgs.push(i); }
    const arm = { side, color, wrap, inner, imgs, cur: 0, timers: [] };
    this.arms[side] = arm; this.setPose(side, 'rest', true); wrap.classList.add('idle');
    return arm;
  }
  setScore(side, text) { if (this.score) this.score[side].textContent = text; }

  // ---- arms ----
  setPose(side, pose, instant = false) {
    const arm = this.arms[side]; const name = `${arm.color}_${pose}`;
    let dir = 'arms2', a = this.atlas.arms2[name]; if (!a) { dir = 'arms'; a = this.atlas.arms[name]; } if (!a) { console.warn('no pose', name); return; }
    if (this.pose[side] === pose && !instant) return;
    this.pose[side] = pose; const s = SCALE[dir];
    const nxt = arm.imgs[1 - arm.cur], prv = arm.imgs[arm.cur];
    nxt.src = `assets/${dir}/${a.file}`; nxt.style.width = a.w * s + 'px'; nxt.style.height = a.h * s + 'px';
    nxt.style.left = -a.anchor[0] * s + 'px'; nxt.style.top = -a.h * s + 'px';
    nxt.classList.remove('hidden'); prv.classList.add('hidden'); arm.cur = 1 - arm.cur;
  }
  /** Pose offset. Also published as --tx/--ty/--rot/--sc so the emote keyframes (sag, hop, sway...) can
   *  compose with it: a running animation beats the inline transform, so the vars are how a mope keeps
   *  the "turned away and leaning back" posture it was given. */
  move(side, { dx = 0, dy = 0, rot = 0, sc = 1 } = {}, ms = 250, ease = 'cubic-bezier(.3,1.4,.5,1)') {
    const inner = this.arms[side].inner;
    inner.style.transition = `transform ${ms}ms ${ease}`;
    inner.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${sc})`;
    inner.style.setProperty('--tx', dx + 'px'); inner.style.setProperty('--ty', dy + 'px');
    inner.style.setProperty('--rot', rot + 'deg'); inner.style.setProperty('--sc', sc);
  }
  idle(side, on) { const w = this.arms[side].wrap; w.classList.toggle('idle', on); if (on) { const i = this.arms[side].inner; i.style.transform = ''; i.style.transition = ''; for (const p of ['--tx', '--ty', '--rot', '--sc']) i.style.removeProperty(p); } }
  flag(side, cls, on) { this.arms[side].wrap.classList.toggle(cls, on); }
  clearFlags(side) { for (const c of EMOTE_FLAGS) this.flag(side, c, false); }
  clearTimers(side) { for (const t of this.arms[side].timers) clearTimeout(t); this.arms[side].timers = []; }
  at(side, ms, fn) { this.arms[side].timers.push(setTimeout(fn, ms)); }
  armPoint(side, dx = 0, dy = 0) { const dir = side === 'a' ? 1 : -1; return [this.pos[side] + dir * dx, GROUND_Y + dy]; }
  async slide(side, x, ms) {
    const w = this.arms[side].wrap; w.style.transition = `left ${ms}ms cubic-bezier(.4,0,.2,1)`; w.style.left = x + 'px'; this.pos[side] = x;
    const steps = Math.max(2, Math.round(ms / 220)); for (let i = 0; i < steps; i++) setTimeout(() => sfx.step(), i * 220);
    await wait(ms);
  }
  async charge(ms = 1100) { this.idle('a', false); this.idle('b', false); this.setPose('a', 'ready'); this.setPose('b', 'ready'); sfx.servo(0.8); await Promise.all([this.slide('a', CLASH.a, ms), this.slide('b', CLASH.b, ms)]); for (const s of ['a', 'b']) this.fx('fx_dust2', ...this.armPoint(s, -70, -20), { scale: 1.3, ms: 700, flip: s === 'b' }); }
  async retreat(ms = 900) { for (const s of ['a', 'b']) { this.clearTimers(s); this.clearFlags(s); this.setPose(s, 'ready'); this.move(s, {}, 300); } await Promise.all([this.slide('a', HOME.a, ms), this.slide('b', HOME.b, ms)]); for (const s of ['a', 'b']) { this.setPose(s, 'rest'); this.idle(s, true); } }
  reset() { clearTimeout(this._sceneEnd); this.settleScene(false); this.scene = null; for (const s of ['a', 'b']) { this.clearTimers(s); this.clearFlags(s); this.flag(s, 'hitflash', false); const w = this.arms[s].wrap; w.style.transition = ''; w.style.left = HOME[s] + 'px'; this.pos[s] = HOME[s]; this.setPose(s, 'rest', true); this.idle(s, true); } this.L.fx.innerHTML = ''; }

  /** Choreography for one beat: both timelines plus the impact hook at the canonical instant. */
  /** One beat of the exchange.
   *
   *  `beatMs` is the WHOLE beat, which on live arms is not 1.4 s -- it is the daemon's ease-in, the
   *  trajectory, a 1.5 s hold on the last pose and the ease back to rest, so an attack beat is about 4.5 s.
   *  `hooks.impactAt` says where in that the blow actually lands (0.29 of a 5.8 s beat, not 0.7 of it).
   *
   *  The timeline is NOT stretched over the whole beat: its keys were authored against an impact at IMPACT,
   *  so it is scaled to put that key on the real instant, and then the arm simply holds its end pose while
   *  the real arm holds and eases home. Stretching uniformly would swing the screen for 4 s and land the
   *  blow at 4.0 s when the metal lands it at 1.66 s. */
  playBeat(moves, beatMs, hooks = {}) {
    const at = hooks.impactAt != null ? hooks.impactAt : IMPACT;
    const tlMs = beatMs * (at / IMPACT);            // so the timeline's IMPACT key lands on the real instant
    for (const s of ['a', 'b']) { this.clearTimers(s); this.clearFlags(s); this.runTimeline(s, moves[s], tlMs); }
    this.at('a', tlMs * IMPACT, () => hooks.impact && hooks.impact());
    return tlMs;
  }
  runKey(side, k) {
    if (k.pose) this.setPose(side, k.pose);
    if (k.tf) this.move(side, k.tf, k.ms ?? 220, k.ease);
    if (k.fx) this.fx(typeof k.fx === 'function' ? k.fx(this.arms[side].color) : k.fx, ...this.armPoint(side, k.fxAt?.[0] ?? 150, k.fxAt?.[1] ?? -180), { scale: k.fxScale ?? 1, flip: side === 'b', rot: k.fxRot });
    if (k.sfx) sfx[k.sfx]?.(...(k.sfxArgs || []));
    if (k.flag) for (const c of [].concat(k.flag)) this.flag(side, c, true);
    if (k.unflag) for (const c of [].concat(k.unflag)) this.flag(side, c, false);
    // scene-only extras (timelines never carry these)
    if (k.walk) this.slide(side, this.pos[side] + (side === 'a' ? 1 : -1) * k.walk[0], k.walk[1]);
    if (k.shake) this.shake(k.shake === 2);
    if (k.stamp) this.stamp(k.stamp, k.stampCls ?? 'small');
    if (k.confetti) this.confetti(k.confetti === true ? 90 : k.confetti);
    if (k.cheer) this.cheer(k.cheer);
    if (k.flash) this.flash(k.flash === true ? '#fff' : k.flash);
  }

  // ---- two-arm scenes (openers, finales): see SCENES / MOPES below ----
  /**
   * Play a named two-arm scene (SALUTE_FORMAL, VICTORY_VS_DEFEAT, ...). Both arms are given a keyed track;
   * `swap` flips which arm plays the A role; `mope` replaces the B track with a character's mope
   * (squire / percival / champion / lionheart) so a finale can be the same dance over a different sulk.
   * Lines and vocalizations are handed back out through onSay / onVox / onHerald (or this.onSay / onVox /
   * onHerald, which match.js sets), so the stage never needs to know the cast. Resolves when the scene ends.
   */
  playScene(name, { swap = false, mope = null, keep = false, onSay = null, onVox = null, onHerald = null } = {}) {
    const S = SCENES[name];
    if (!S) { console.warn('no scene', name); return Promise.resolve(false); }
    const cb = { say: onSay || this.onSay, vox: onVox || this.onVox, hrl: onHerald || this.onHerald };
    const role = { A: swap ? 'b' : 'a', B: swap ? 'a' : 'b' };
    const track = { A: S.A || [], B: (mope && MOPES[mope]) || S.B || [] };
    clearTimeout(this._sceneEnd); this.settleScene(false); this.scene = name;   // a scene cut short still resolves
    for (const s of ['a', 'b']) { this.clearTimers(s); this.untell(s); this.clearFlags(s); this.idle(s, false); this.move(s, {}, 200); }
    for (const r of ['A', 'B']) { const side = role[r]; for (const k of track[r]) if (k.at < S.ms) this.at(side, k.at, () => this.sceneKey(side, k, name, cb)); }
    return new Promise(res => { this._sceneRes = res; this._sceneEnd = setTimeout(() => this.endScene(!keep), S.ms); });
  }
  sceneKey(side, k, name, cb) {
    try { this.runKey(side, k); } catch (e) { console.warn('scene key', name, e); }
    try { if (k.say) cb.say?.(side, k.say === 'opener' ? 'opener_' + name : k.say, k.sayMs ?? 2200, k.sayCls ?? null); } catch (e) {}
    try { if (k.vox) cb.vox?.(side, k.vox); } catch (e) {}
    try { if (k.hrl) cb.hrl?.(k.hrl); } catch (e) {}
  }
  /** Always called at the end of a scene: kills its timers so the next turn starts clean. `restore` also
   *  drops the emote classes and puts both arms back to a breathing rest (finales keep their tableau). */
  endScene(restore = true) {
    clearTimeout(this._sceneEnd); this.scene = null;
    for (const s of ['a', 'b']) { this.clearTimers(s); if (restore) { this.clearFlags(s); this.setPose(s, 'rest'); this.idle(s, true); } }
    this.settleScene(true);
  }
  settleScene(ok) { const r = this._sceneRes; this._sceneRes = null; r?.(ok); }   // nobody is left awaiting a dead scene
  runTimeline(side, hw, beatMs) { for (const k of TIMELINES[hw] || TIMELINES.REST) this.at(side, k.at * beatMs, () => this.runKey(side, k)); }
  react(side, kind, beatMs) { const R = REACTIONS[kind]; if (!R) return; this.clearTimers(side); for (const k of R) this.at(side, k.at * beatMs, () => this.runKey(side, k)); }

  // ---- fx ----
  fx(name, x, y, { scale = 1, ms = 700, flip = false, rot = 0 } = {}) {
    const [i, a, dir] = this.img(name, ['arms2', 'arms']); i.className = 'fxs';
    const s = scale * (dir === 'arms2' ? 1.6 : 1);
    const w = a.w * s, h = a.h * s;
    i.style.width = w + 'px'; i.style.height = h + 'px'; i.style.left = x - w / 2 + 'px'; i.style.top = y - h / 2 + 'px';
    i.style.setProperty('--ms', ms + 'ms'); i.style.setProperty('--rot', rot + 'deg'); if (flip) i.style.scale = '-1 1';
    this.L.fx.appendChild(i); setTimeout(() => i.remove(), ms + 50); return i;
  }
  float(x, y, text, cls = 'dmg') { const d = el('div', 'float ' + cls, this.L.fx); d.textContent = text; d.style.left = x + 'px'; d.style.top = y + 'px'; setTimeout(() => d.remove(), 1200); }
  qmark(x, y) { const d = el('div', 'qmark', this.L.fx); d.textContent = '???'; d.style.left = x + 'px'; d.style.top = y + 'px'; setTimeout(() => d.remove(), 1200); }
  stamp(text, cls = '') { const d = el('div', 'stamp ' + cls, this.L.fx); d.textContent = text; setTimeout(() => d.remove(), 1150); }
  shake(hard = false) { const s = this.root; s.classList.remove('shake', 'hard'); void s.offsetWidth; s.classList.add('shake'); if (hard) s.classList.add('hard'); setTimeout(() => s.classList.remove('shake', 'hard'), 600); }
  flash(color = '#fff') { const d = el('div', 'flash', this.L.fx); d.style.setProperty('--c', color); setTimeout(() => d.remove(), 400); }
  cheer(ms = 1500) { this.L.crowd.classList.add('cheer'); setTimeout(() => this.L.crowd.classList.remove('cheer'), ms); }
  confetti(n = 90) {
    const cols = ['#b8262b', '#1e4e9c', '#d9a441', '#f3d27a', '#e9d8b0', '#fff'];
    for (let i = 0; i < n; i++) { const c = el('div', 'confetti', this.L.fx); c.style.left = Math.random() * 1600 + 'px'; c.style.top = '-20px'; c.style.background = cols[i % cols.length]; c.style.animationDuration = 2.2 + Math.random() * 2 + 's'; c.style.animationDelay = Math.random() * 1.5 + 's'; setTimeout(() => c.remove(), 6000); }
  }
  tell(side, category) {
    const arm = this.arms[side]; this.untell(side);
    const b = el('div', 'tellbubble', arm.wrap); b.innerHTML = { attack: '&#9876;<small>a swing</small>', guard: '&#9960;<small>a guard</small>', trick: '?<small>a trick</small>', rest: '&#8230;<small>nothing?</small>' }[category] || '?';
    arm.tellEl = b;
    const twitch = { attack: 'windup', guard: 'high', trick: 'twirl', rest: 'rest' }[category] || 'ready';
    const loop = () => { if (!arm.tellEl) return; this.setPose(side, twitch); arm.tellTimer = setTimeout(() => { if (!arm.tellEl) return; this.setPose(side, 'rest'); arm.tellTimer = setTimeout(loop, 1800 + Math.random() * 1200); }, 260); };
    arm.tellTimer = setTimeout(loop, 600);
  }
  bark(side, text, ms = 1800, cls = '') {
    const arm = this.arms[side]; arm.barkEl?.remove(); clearTimeout(arm.barkTimer);
    const b = el('div', 'bark' + (cls ? ' ' + cls : ''), arm.wrap); b.textContent = text; arm.barkEl = b;
    arm.barkTimer = setTimeout(() => { b.remove(); if (arm.barkEl === b) arm.barkEl = null; }, ms);
  }
  untell(side) { const arm = this.arms[side]; if (arm.tellEl) { arm.tellEl.remove(); arm.tellEl = null; } clearTimeout(arm.tellTimer); }
}

// Timelines: keyframes at fractions of the beat. dx is "toward the opponent" for both arms.
const T = (at, pose, tf, extra = {}) => ({ at, pose, tf, ...extra });
const arc = c => (c === 'red' ? 'fx_arc_red' : 'fx_arc_blue');
export const TIMELINES = {
  REST: [T(0, 'rest', {}, { ms: 300 })],
  STAGGER: [T(0, 'dizzy', { dx: -20, rot: -6 }, { flag: 'wobble', fx: 'fx_stars_ring', fxAt: [10, -300], fxScale: 0.8, sfx: 'stagger' }), T(0.9, 'ready', { dx: 0, rot: 0 }, { unflag: 'wobble' })],
  ATTACK_HIGH: [T(0, 'windup', { dx: -14, rot: -5 }, { ms: 300, sfx: 'servo', sfxArgs: [0.5] }), T(0.42, 'raise', { dx: -6, rot: -8 }, { ms: 200 }), T(0.6, 'swing', { dx: 40, dy: 2, rot: 4 }, { ms: 110, ease: 'cubic-bezier(.2,.9,.3,1)', fx: arc, fxAt: [120, -240], fxRot: 60, fxScale: 1.1, sfx: 'whoosh' }), T(0.69, 'smash', { dx: 64, dy: 8, rot: 6 }, { ms: 90 }), T(0.88, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 300 })],
  ATTACK_LOW_LR: [T(0, 'low', { dx: -14, dy: 6, rot: -8 }, { ms: 300, sfx: 'servo', sfxArgs: [0.5] }), T(0.5, 'twirl', { dx: 50, dy: 18, rot: 12 }, { ms: 180, ease: 'cubic-bezier(.2,.9,.3,1)', fx: arc, fxAt: [140, -110], fxRot: -30, fxScale: 1.1, sfx: 'whoosh', sfxArgs: [0.7] }), T(0.8, 'low', { dx: 24, dy: 6, rot: 0 }, { ms: 200 }), T(0.92, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  ATTACK_LOW_RL: [T(0, 'low', { dx: -14, dy: 6, rot: -8 }, { ms: 300, sfx: 'servo', sfxArgs: [0.5] }), T(0.5, 'twirl', { dx: 50, dy: 22, rot: -10 }, { ms: 180, ease: 'cubic-bezier(.2,.9,.3,1)', fx: arc, fxAt: [140, -100], fxRot: 200, fxScale: 1.1, sfx: 'whoosh', sfxArgs: [0.7] }), T(0.8, 'low', { dx: 24, dy: 6, rot: 0 }, { ms: 200 }), T(0.92, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  ATTACK_THRUST: [T(0, 'ready', { dx: -30, rot: 0 }, { ms: 320 }), T(0.5, 'lunge', { dx: 95, dy: -4 }, { ms: 150, ease: 'cubic-bezier(.2,.9,.3,1)', fx: 'fx_dust2', fxAt: [-40, -30], fxScale: 1.2, sfx: 'whoosh', sfxArgs: [1.4] }), T(0.82, 'high', { dx: 30, dy: 0 }, { ms: 200 }), T(0.95, 'ready', { dx: 0, dy: 0 }, { ms: 250 })],
  FEINT_HIGH: [T(0, 'windup', { dx: -12, rot: -5 }, { ms: 300, sfx: 'servo', sfxArgs: [0.4] }), T(0.4, 'raise', { dx: 8, rot: -8 }, { ms: 220 }), T(0.62, 'ready', { dx: -34, rot: 3 }, { ms: 140, fx: 'fx_exclaim', fxAt: [60, -330], fxScale: 0.7, sfx: 'feint' }), T(0.9, 'ready', { dx: 0, rot: 0 }, { ms: 250 })],
  FEINT_LEFT: [T(0, 'low', { dx: -14, dy: 6, rot: -8 }, { ms: 300, sfx: 'servo', sfxArgs: [0.4] }), T(0.45, 'crouch', { dx: 16, dy: 10, rot: 6 }, { ms: 180 }), T(0.64, 'ready', { dx: -30, dy: 0, rot: -3 }, { ms: 140, fx: 'fx_exclaim', fxAt: [60, -330], fxScale: 0.7, sfx: 'feint' }), T(0.9, 'ready', { dx: 0, rot: 0 }, { ms: 250 })],
  FEINT_RIGHT: null,
  BLOCK_HIGH: [T(0, 'high', { dx: 12, dy: -12, rot: -8 }, { ms: 360, sfx: 'servo', sfxArgs: [0.6] }), T(0.4, 'high', { dx: 18, dy: -16, rot: -10 }, { ms: 200 }), T(0.9, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  BLOCK_MIDDLE: [T(0, 'low', { dx: 12, dy: 6, rot: 16 }, { ms: 360, sfx: 'servo', sfxArgs: [0.6] }), T(0.4, 'low', { dx: 18, dy: 10, rot: 20 }, { ms: 200 }), T(0.9, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  BLOCK_LEFT: null, BLOCK_RIGHT: null,
  PARRY_HIGH: [T(0, 'high', { dx: 12, dy: -12, rot: -8 }, { ms: 360, sfx: 'servo', sfxArgs: [0.6] }), T(0.4, 'high', { dx: 18, dy: -16, rot: -10 }, { ms: 200 }), T(0.78, 'rising', { dx: 44, dy: -6, rot: -4 }, { ms: 140, fx: arc, fxAt: [130, -260], fxRot: -80, fxScale: 0.9 }), T(0.93, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  PARRY_LOW: [T(0, 'low', { dx: 12, dy: 6, rot: 16 }, { ms: 360, sfx: 'servo', sfxArgs: [0.6] }), T(0.4, 'low', { dx: 18, dy: 10, rot: 20 }, { ms: 200 }), T(0.78, 'rising', { dx: 44, dy: 4, rot: 10 }, { ms: 140, fx: arc, fxAt: [130, -200], fxRot: -80, fxScale: 0.9 }), T(0.93, 'ready', { dx: 0, dy: 0, rot: 0 }, { ms: 250 })],
  BRACE: [T(0, 'crouch', { dx: -8, dy: 8, sc: 0.96 }, { ms: 380, sfx: 'servo', sfxArgs: [0.6] }), T(0.4, 'crouch', { dx: -4, dy: 12, sc: 0.94 }, { ms: 200 }), T(0.9, 'ready', { dx: 0, dy: 0, sc: 1 }, { ms: 250 })],
  WIND_UP: [T(0, 'raise', { dx: -22, rot: -6 }, { ms: 400, sfx: 'windup' }), T(0.4, 'raise', { dx: -26, rot: -8 }, { flag: 'quiver', fx: 'fx_exclaim', fxAt: [30, -400], fxScale: 0.8 }), T(0.95, 'raise', {}, { unflag: 'quiver' })],
  TWIRL: [T(0, 'twirl', { rot: -12 }, { ms: 300, sfx: 'buff' }), T(0.3, 'swing', { rot: 12 }, { ms: 300, fx: 'fx_stars_ring', fxAt: [60, -330], fxScale: 0.9 }), T(0.6, 'twirl', { rot: -8 }, { ms: 300 }), T(0.9, 'ready', { rot: 0 }, { ms: 250 })],
};
TIMELINES.FEINT_RIGHT = TIMELINES.FEINT_LEFT; TIMELINES.BLOCK_LEFT = TIMELINES.BLOCK_MIDDLE; TIMELINES.BLOCK_RIGHT = TIMELINES.BLOCK_MIDDLE;

// Reactions start at the impact instant (fractions are of the beat, measured from impact).
const burstFor = c => (c === 'red' ? 'fx_burst_blue' : 'fx_burst_orange');   // the *attacker's* colour hits you: red arm is hit by blue bursts
export const REACTIONS = {
  hit: [T(0, 'hit', { dx: -58, dy: -8, rot: -14 }, { ms: 90, ease: 'cubic-bezier(.2,.9,.3,1)', flag: 'hitflash', fx: burstFor, fxAt: [70, -210], fxScale: 1.3 }), T(0.09, null, null, { unflag: 'hitflash' }), T(0.3, 'ready', { dx: -10, dy: 0, rot: -3 }, { ms: 300 })],
  hit_low: [T(0, 'hit', { dx: -48, dy: 14, rot: 10 }, { ms: 90, ease: 'cubic-bezier(.2,.9,.3,1)', flag: 'hitflash', fx: burstFor, fxAt: [70, -110], fxScale: 1.2 }), T(0.09, null, null, { unflag: 'hitflash' }), T(0.3, 'ready', { dx: -10, dy: 0, rot: -3 }, { ms: 300 })],
  stagger: [T(0, 'dizzy', { dx: -30, rot: -8 }, { ms: 160, flag: 'wobble', fx: 'fx_stars_ring', fxAt: [10, -300], fxScale: 0.8 })],
  clash: [T(0, 'swing', { dx: 34, dy: -6, rot: 0 }, { ms: 80 }), T(0.12, 'windup', { dx: -34, rot: -6 }, { ms: 200 }), T(0.34, 'ready', { dx: 0, rot: 0 }, { ms: 300 })],
  blocked_attacker: [T(0, 'swing', { dx: 20, rot: 6 }, { ms: 80 }), T(0.1, 'windup', { dx: -44, rot: -10 }, { ms: 220, ease: 'cubic-bezier(.2,.9,.3,1)' }), T(0.32, 'ready', { dx: 0, rot: 0 }, { ms: 300 })],
  blocked_defender: [T(0.02, null, { dx: 36, dy: -12, rot: -10 }, { ms: 120, fx: c => (c === 'blue' ? 'fx_shield_blue' : 'fx_spark_yellow'), fxAt: [130, -200], fxScale: 1.0 }), T(0.26, null, { dx: 0, dy: 0, rot: 0 }, { ms: 300 })],
  exposed: [T(0.02, 'confused', { dx: 10, rot: 4 }, { ms: 200 }), T(0.3, 'confused', { dx: -6, rot: -3 }, { ms: 250 })],
  confused: [T(0.02, 'confused', { rot: 3 }, { ms: 200 }), T(0.3, 'confused', { rot: -3 }, { ms: 250 })],
  wary: [T(0, null, { dx: 6, dy: -4 }, { ms: 250 }), T(0.25, null, { dx: 0, dy: 0 }, { ms: 250 })],
  rebound: [T(0, null, { dx: 46, rot: 8 }, { ms: 80 }), T(0.14, 'ready', { dx: -10, rot: -2 }, { ms: 260 })],
};

// =====================================================================================================
// SCENES: two-arm theatre, named as in robot-jousting/docs/emotes_brainstorm.md so the real arms can play
// the same beat by the same name (match.js also calls bridge.emote(name, { swap })).
// Keys are absolute milliseconds. A key is a TIMELINES key plus scene extras:
//   say: bark event ('opener' becomes opener_<SCENE>)   vox: vocalize kind   hrl: herald event
//   walk: [dx, ms] (a real step toward the opponent)    shake / cheer / confetti / flash / stamp
// Role A is the red arm unless playScene is called with { swap: true }. dx is toward the opponent for both.
// Every scene gives BOTH arms something to do: an arm parked at rest is a missed line of dialogue.
// =====================================================================================================
export const EMOTE_FLAGS = ['wobble', 'quiver', 'sag', 'sway', 'shiver', 'sobbob', 'slump', 'tantrum', 'jitter', 'hop', 'jig', 'bounce', 'chatter'];
const K = (at, pose, tf, x = {}) => ({ at, pose, tf, ...x });

export const SCENES = {
  // ---------------- openers ----------------
  // Mutual respect: both blades vertical, a nod in phase, down to guard together. Mirroring = rapport.
  SALUTE_FORMAL: {
    ms: 4200,
    A: [
      K(0, 'ready', {}, { ms: 300, sfx: 'servo', sfxArgs: [0.6] }),
      K(300, 'raise', { dy: -16, rot: -2 }, { ms: 700, ease: 'cubic-bezier(.4,0,.3,1)', sfx: 'horn' }),
      K(1050, null, null, { fx: 'fx_spark_yellow', fxAt: [40, -380], fxScale: 0.6, say: 'intro', sayMs: 2400 }),
      K(1500, 'raise', { dy: -6, rot: 8 }, { ms: 260 }),
      K(1800, 'raise', { dy: -16, rot: -2 }, { ms: 260 }),
      K(2900, 'ready', {}, { ms: 520, sfx: 'servo', sfxArgs: [0.7] }),
      K(3500, null, null, { say: 'opener', sayMs: 2200 }),
    ],
    B: [
      K(0, 'ready', {}, { ms: 300 }),
      K(320, 'raise', { dy: -16, rot: -2 }, { ms: 700, ease: 'cubic-bezier(.4,0,.3,1)', sfx: 'servo', sfxArgs: [0.6] }),
      K(1520, 'raise', { dy: -6, rot: 8 }, { ms: 260 }),
      K(1820, 'raise', { dy: -16, rot: -2 }, { ms: 260 }),
      K(2100, null, null, { say: 'intro', sayMs: 2300 }),
      K(2900, 'ready', {}, { ms: 520, sfx: 'servo', sfxArgs: [0.7] }),
    ],
  },
  // Boxing's glove touch: both extend, the blades tap once at the centre line, both retreat to guard.
  GLOVE_TOUCH: {
    ms: 3900,
    A: [
      K(0, 'ready', {}, { ms: 300, sfx: 'servo', sfxArgs: [0.5] }),
      K(350, 'lunge', { dx: 92, dy: -4 }, { ms: 620, ease: 'cubic-bezier(.3,.9,.4,1)', say: 'intro', sayMs: 2000 }),
      K(1000, null, { dx: 78, dy: -4 }, { ms: 140, sfx: 'block', fx: 'fx_spark', fxAt: [360, -250], fxScale: 0.8 }),
      K(1200, 'ready', { dx: 0 }, { ms: 520 }),
      K(2000, 'ready', { dy: 6, rot: 6 }, { ms: 220 }),
      K(2300, 'ready', {}, { ms: 260, say: 'opener', sayMs: 2200 }),
    ],
    B: [
      K(0, 'ready', {}, { ms: 300, sfx: 'servo', sfxArgs: [0.5] }),
      K(380, 'lunge', { dx: 92, dy: -4 }, { ms: 600, ease: 'cubic-bezier(.3,.9,.4,1)' }),
      K(1000, null, { dx: 78, dy: -4 }, { ms: 140, fx: 'fx_dust2', fxAt: [-50, -20], fxScale: 0.8 }),
      K(1220, 'ready', { dx: 0 }, { ms: 520 }),
      K(1900, null, null, { say: 'intro', sayMs: 2200 }),
      K(2100, 'ready', { dy: 6, rot: 6 }, { ms: 220 }),
      K(2400, 'ready', {}, { ms: 260 }),
    ],
  },
  // Held tension: a slow lean in, blades level a hand apart, a tremor, and both snap back on the same frame.
  STAREDOWN: {
    ms: 4200,
    A: [
      K(0, 'ready', {}, { ms: 300, sfx: 'servo', sfxArgs: [0.4] }),
      K(300, 'cocked', { dx: 58, dy: -6, rot: -3 }, { ms: 1700, ease: 'cubic-bezier(.4,0,.6,1)' }),
      K(800, null, null, { say: 'intro', sayMs: 2200 }),
      K(2100, null, null, { flag: 'shiver' }),
      K(2900, null, null, { unflag: 'shiver', fx: 'fx_exclaim', fxAt: [140, -360], fxScale: 0.55 }),
      K(3050, 'ready', { dx: -12, rot: 3 }, { ms: 160, sfx: 'servo', sfxArgs: [0.8] }),
      K(3250, 'ready', {}, { ms: 320, say: 'opener', sayMs: 2000 }),
    ],
    B: [
      K(0, 'ready', {}, { ms: 300 }),
      K(300, 'cocked', { dx: 58, dy: -6, rot: -3 }, { ms: 1700, ease: 'cubic-bezier(.4,0,.6,1)', sfx: 'servo', sfxArgs: [0.4] }),
      K(1700, null, null, { say: 'intro', sayMs: 2200 }),
      K(2100, null, null, { flag: 'shiver' }),
      K(2900, null, null, { unflag: 'shiver' }),
      K(3050, 'ready', { dx: -12, rot: 3 }, { ms: 160, sfx: 'servo', sfxArgs: [0.8] }),
      K(3250, 'ready', {}, { ms: 320 }),
    ],
  },
  // Status: A twirls the blade and beckons; B fidgets, wavers and shrinks back a step.
  COCKY_VS_NERVOUS: {
    ms: 4200,
    A: [
      K(0, 'ready', {}, { ms: 260 }),
      K(300, 'twirl', { rot: -14 }, { ms: 280, sfx: 'buff', say: 'intro', sayMs: 2200 }),
      K(650, 'swing', { rot: 12 }, { ms: 260, fx: 'fx_stars_ring', fxAt: [70, -320], fxScale: 0.75 }),
      K(950, 'twirl', { rot: -8 }, { ms: 260 }),
      K(1300, 'cocked', { dx: 34 }, { ms: 380 }),
      K(1750, null, { dx: 8 }, { ms: 240, vox: 'giggle' }),
      K(2050, null, { dx: 34 }, { ms: 240 }),
      K(2400, null, { dx: 8 }, { ms: 240 }),
      K(2700, null, null, { say: 'opener', sayMs: 2200, vox: 'laugh' }),
      K(3300, 'ready', {}, { ms: 380 }),
    ],
    B: [
      K(0, 'rest', {}, { ms: 260 }),
      K(300, null, null, { flag: 'jitter' }),
      K(600, 'guard', { dx: -14, dy: 4 }, { ms: 500, sfx: 'servo', sfxArgs: [0.4] }),
      K(1400, 'crouch', { dx: -34, dy: 12, sc: 0.97 }, { ms: 600, vox: 'gasp' }),
      K(2200, null, null, { say: 'intro', sayMs: 2200 }),
      K(2900, 'guard', { dx: -16, dy: 2 }, { ms: 420 }),
      K(3400, 'ready', { dx: -6 }, { ms: 420, unflag: 'jitter' }),
    ],
  },
  // Fencers circling: mirrored pan sweeps out of phase, then both lock facing on the same instant.
  CIRCLING: {
    ms: 3800,
    A: [
      K(0, 'ready', {}, { ms: 260, sfx: 'servo', sfxArgs: [0.5] }),
      K(220, null, { dx: 34, dy: -8, rot: -6 }, { ms: 900, ease: 'ease-in-out', fx: 'fx_dust2', fxAt: [-60, -20], fxScale: 0.7 }),
      K(900, null, null, { say: 'intro', sayMs: 2000 }),
      K(1150, null, { dx: -22, dy: 6, rot: 7 }, { ms: 900, ease: 'ease-in-out' }),
      K(2050, null, { dx: 22, rot: -5 }, { ms: 700, ease: 'ease-in-out', fx: 'fx_dust', fxAt: [-50, -20], fxScale: 0.7 }),
      K(2750, 'ready', {}, { ms: 340, sfx: 'servo', sfxArgs: [0.9] }),
      K(3050, null, null, { say: 'opener', sayMs: 2000 }),
    ],
    B: [
      K(0, 'ready', {}, { ms: 260 }),
      K(220, null, { dx: -22, dy: 6, rot: 7 }, { ms: 900, ease: 'ease-in-out' }),
      K(1150, null, { dx: 34, dy: -8, rot: -6 }, { ms: 900, ease: 'ease-in-out', fx: 'fx_dust2', fxAt: [-60, -20], fxScale: 0.7 }),
      K(1900, null, null, { say: 'intro', sayMs: 2000 }),
      K(2050, null, { dx: -16, rot: 5 }, { ms: 700, ease: 'ease-in-out' }),
      K(2750, 'ready', {}, { ms: 340, sfx: 'servo', sfxArgs: [0.9] }),
    ],
  },
  // Status, loudly: A rises tall and raises the blade; B bows low and waits to be noticed.
  CHAMPION_ENTRANCE: {
    ms: 4600,
    A: [
      K(0, 'ready', {}, { ms: 300, hrl: 'opener' }),
      K(250, 'rising', { dy: -10 }, { ms: 900, sfx: 'servo', sfxArgs: [1.4] }),
      K(1250, 'raise', { dy: -22, rot: -2 }, { ms: 1300, ease: 'cubic-bezier(.4,0,.3,1)' }),
      K(1700, null, null, { say: 'intro', sayMs: 2400 }),
      K(2300, null, null, { fx: 'fx_stars_ring', fxAt: [50, -400], fxScale: 1.1, sfx: 'horn' }),
      K(3100, 'smash', { dy: 8 }, { ms: 180, sfx: 'hit', sfxArgs: [0.8], shake: 1, fx: 'fx_dust2', fxAt: [-40, -20], fxScale: 1.4 }),
      K(3350, 'ready', {}, { ms: 420, say: 'opener', sayMs: 2200 }),
    ],
    B: [
      K(0, 'rest', {}, { ms: 300 }),
      K(400, 'crouch', { dy: 16, rot: 8, sc: 0.97 }, { ms: 900, ease: 'cubic-bezier(.4,0,.3,1)', sfx: 'servo', sfxArgs: [0.8] }),
      K(2400, null, null, { say: 'intro', sayMs: 2200 }),
      K(3100, null, { dy: 22, rot: 10, sc: 0.96 }, { ms: 160 }),
      K(3500, 'ready', {}, { ms: 700 }),
    ],
  },
  // They have done this before: one curt nod each, a mutual shrug, straight to en garde.
  OLD_RIVALS: {
    ms: 3400,
    A: [
      K(0, 'ready', {}, { ms: 260, sfx: 'servo', sfxArgs: [0.5] }),
      K(420, null, { dy: 8, rot: 7 }, { ms: 150 }),
      K(620, null, {}, { ms: 220, say: 'intro', sayMs: 1900 }),
      K(1900, 'confused', { dy: -9 }, { ms: 200 }),
      K(2150, 'ready', { dy: 2 }, { ms: 240 }),
      K(2500, 'ready', {}, { ms: 280, sfx: 'servo', sfxArgs: [0.9], say: 'opener', sayMs: 1800 }),
    ],
    B: [
      K(0, 'ready', {}, { ms: 260 }),
      K(1000, null, { dy: 8, rot: 7 }, { ms: 150, sfx: 'servo', sfxArgs: [0.5] }),
      K(1200, null, {}, { ms: 220, say: 'intro', sayMs: 1900 }),
      K(1900, 'confused', { dy: -9 }, { ms: 200 }),
      K(2150, 'ready', { dy: 2 }, { ms: 240 }),
      K(2500, 'ready', {}, { ms: 280, sfx: 'servo', sfxArgs: [0.9] }),
    ],
  },
  // Tempo as mood: A taps the table faster and faster; B stretches, yawns, and finally gets up.
  IMPATIENT: {
    ms: 3900,
    A: [
      K(0, 'ready', {}, { ms: 260 }),
      K(250, 'low', { dy: 12 }, { ms: 110, sfx: 'step' }), K(420, 'ready', { dy: 0 }, { ms: 150 }),
      K(800, 'low', { dy: 12 }, { ms: 110, sfx: 'step' }), K(940, 'ready', { dy: 0 }, { ms: 140 }),
      K(1150, null, null, { say: 'intro', sayMs: 2000 }),
      K(1250, 'low', { dy: 12 }, { ms: 100, sfx: 'step' }), K(1370, 'ready', { dy: 0 }, { ms: 130 }),
      K(1600, 'low', { dy: 12 }, { ms: 90, sfx: 'step' }), K(1700, 'ready', { dy: 0 }, { ms: 110 }),
      K(1880, 'low', { dy: 12 }, { ms: 80, sfx: 'step' }), K(1960, 'ready', { dy: 0 }, { ms: 100 }),
      K(2100, 'low', { dy: 12 }, { ms: 70, sfx: 'step' }), K(2170, 'ready', { dy: 0 }, { ms: 90 }),
      K(2300, 'low', { dy: 14 }, { ms: 70, sfx: 'step', fx: 'fx_dust', fxAt: [40, -20], fxScale: 0.7 }),
      K(2420, 'raise', { dy: -14, rot: -4 }, { ms: 260, vox: 'hmph', fx: 'fx_exclaim', fxAt: [40, -380], fxScale: 0.6 }),
      K(2800, 'ready', {}, { ms: 340, say: 'opener', sayMs: 2200 }),
    ],
    B: [
      K(0, 'rest', {}, { ms: 300 }),
      K(400, 'crouch', { dy: 14, sc: 0.98 }, { ms: 800 }),
      K(1400, 'rising', { dy: -14, rot: -7 }, { ms: 900, ease: 'cubic-bezier(.4,0,.3,1)', vox: 'sigh', sfx: 'servo', sfxArgs: [1.5] }),
      K(2300, null, null, { say: 'intro', sayMs: 2200 }),
      K(2500, 'ready', {}, { ms: 520, sfx: 'servo', sfxArgs: [0.7] }),
    ],
  },

  // ---------------- finales ----------------
  // The full dance: blade pumps with hops, a twirl, a crowd wave, a strut to the centre and back, a bow.
  VICTORY_VS_DEFEAT: {
    ms: 8800,
    A: [
      K(0, 'raise', { dy: -14 }, { ms: 300, sfx: 'horn', vox: 'cheer' }),
      K(250, null, null, { say: 'win', sayMs: 2400, sayCls: 'shout' }),
      K(420, null, null, { flag: 'hop', fx: 'fx_dust2', fxAt: [-60, -20], fxScale: 1.2 }),
      K(700, 'high', { dy: -20, rot: -4 }, { ms: 200, sfx: 'servo', sfxArgs: [0.4] }),
      K(1100, 'raise', { dy: -14 }, { ms: 200, fx: 'fx_stars_ring', fxAt: [40, -400], fxScale: 0.9 }),
      K(1500, 'high', { dy: -20, rot: -4 }, { ms: 200, sfx: 'servo', sfxArgs: [0.4] }),
      K(1900, 'raise', { dy: -14 }, { ms: 200, cheer: 1300, fx: 'fx_spark_yellow', fxAt: [60, -380], fxScale: 0.9 }),
      K(2300, 'twirl', { rot: -18 }, { ms: 220, unflag: 'hop', sfx: 'whoosh', sfxArgs: [1.2] }),
      K(2600, 'swing', { rot: 16 }, { ms: 200, fx: 'fx_stars_ring', fxAt: [70, -300], fxScale: 1 }),
      K(2860, 'twirl', { rot: -10 }, { ms: 200 }),
      K(3120, 'ready', {}, { ms: 260, say: 'dance', sayMs: 2200, sayCls: 'shout' }),
      K(3400, null, null, { flag: 'bounce', confetti: 80, cheer: 1600 }),
      K(3550, 'high', { dx: -30, rot: -11 }, { ms: 420 }),
      K(4020, null, { dx: 30, rot: 11 }, { ms: 420 }),
      K(4470, null, { dx: -22, rot: -9 }, { ms: 400, vox: 'laugh' }),
      K(4920, 'ready', {}, { ms: 320 }),
      K(5150, null, null, { walk: [150, 850], say: 'dance', sayMs: 2200, hrl: 'dance' }),
      K(6050, 'cocked', { dx: 14 }, { ms: 260, vox: 'chatter' }),
      K(6350, null, null, { walk: [-150, 820] }),
      K(7250, 'ready', {}, { ms: 300, unflag: 'bounce' }),
      K(7500, 'crouch', { dy: 18, rot: 13 }, { ms: 520, sfx: 'servo', sfxArgs: [0.9] }),
      K(8150, 'raise', { dy: -12 }, { ms: 420, cheer: 1200, say: 'dance', sayMs: 2000, sayCls: 'shout' }),
    ],
    B: null,   // filled in below with MOPES.default
  },
  // The winner celebrates, then salutes and bows to the loser. Respect, after the fact.
  GRACIOUS_WIN: {
    ms: 8400,
    A: [
      K(0, 'raise', { dy: -14 }, { ms: 300, sfx: 'horn', vox: 'cheer' }),
      K(250, null, null, { say: 'win', sayMs: 2400, sayCls: 'shout' }),
      K(500, null, null, { flag: 'hop', fx: 'fx_dust2', fxAt: [-60, -20], fxScale: 1.1 }),
      K(900, 'high', { dy: -20, rot: -4 }, { ms: 200 }),
      K(1300, 'raise', { dy: -14 }, { ms: 200, cheer: 1300, fx: 'fx_stars_ring', fxAt: [40, -400], fxScale: 0.9 }),
      K(1800, 'ready', {}, { ms: 360, unflag: 'hop' }),
      K(2200, null, null, { confetti: 60, say: 'dance', sayMs: 2200 }),
      K(2600, 'cocked', {}, { ms: 260, flag: 'bounce', walk: [120, 820] }),
      K(3600, 'ready', {}, { ms: 300, unflag: 'bounce' }),
      K(4000, 'raise', { dy: -12, rot: -2 }, { ms: 460, sfx: 'servo', sfxArgs: [0.8] }),
      K(4700, null, null, { say: 'dance', sayMs: 2200, hrl: 'dance' }),
      K(5100, 'crouch', { dy: 20, rot: 14 }, { ms: 700, ease: 'cubic-bezier(.4,0,.3,1)', sfx: 'servo', sfxArgs: [1.1] }),
      K(6300, 'ready', {}, { ms: 520, vox: 'hmm' }),
      K(6800, null, null, { walk: [-120, 800] }),
      K(7700, 'rest', {}, { ms: 420, cheer: 900 }),
    ],
    B: null,
  },
  // The winner shrugs at the tantrum, then dances a little jig about it.
  SORE_LOSER: {
    ms: 8400,
    A: [
      K(0, 'ready', {}, { ms: 300 }),
      K(400, 'confused', { dy: -9 }, { ms: 250 }),
      K(700, null, { dy: 3 }, { ms: 250, say: 'win', sayMs: 2200, sayCls: 'shout' }),
      K(1200, null, null, { flag: 'chatter', vox: 'laugh' }),
      K(2000, 'twirl', { rot: -16 }, { ms: 220, unflag: 'chatter', sfx: 'buff' }),
      K(2300, 'swing', { rot: 14 }, { ms: 200, fx: 'fx_stars_ring', fxAt: [70, -300], fxScale: 0.9 }),
      K(2600, 'ready', {}, { ms: 260 }),
      K(2900, 'high', { dy: -8 }, { ms: 260, flag: 'jig', sfx: 'horn', cheer: 1600, confetti: 70, say: 'dance', sayMs: 2200, sayCls: 'shout' }),
      K(4600, null, null, { hrl: 'dance', vox: 'giggle' }),
      K(5200, 'raise', { dy: -18 }, { ms: 300, unflag: 'jig', fx: 'fx_spark_yellow', fxAt: [60, -380], fxScale: 0.9 }),
      K(5600, 'ready', {}, { ms: 280, flag: 'bounce', walk: [140, 820], say: 'dance', sayMs: 2200 }),
      K(6650, 'cocked', { dx: 14 }, { ms: 260, vox: 'chatter' }),
      K(7100, null, null, { walk: [-140, 760] }),
      K(7900, 'ready', {}, { ms: 320, unflag: 'bounce', cheer: 900 }),
    ],
    B: null,
  },
  // Sarcasm: a slow, deliberate blade clap at the loser, a laugh, a strut, a flourish.
  SLOW_CLAP: {
    ms: 8600,
    A: [
      K(0, 'ready', {}, { ms: 300, say: 'win', sayMs: 2400, sayCls: 'shout' }),
      K(700, 'clash', { dx: 18, dy: -6 }, { ms: 160, sfx: 'block' }), K(900, 'ready', { dx: 0 }, { ms: 260 }),
      K(1400, 'clash', { dx: 18, dy: -6 }, { ms: 160, sfx: 'block' }), K(1600, 'ready', { dx: 0 }, { ms: 260 }),
      K(2100, 'clash', { dx: 18, dy: -6 }, { ms: 160, sfx: 'block', fx: 'fx_spark', fxAt: [150, -260], fxScale: 0.6 }), K(2300, 'ready', { dx: 0 }, { ms: 260 }),
      K(2800, 'clash', { dx: 18, dy: -6 }, { ms: 160, sfx: 'block' }), K(3000, 'ready', { dx: 0 }, { ms: 260 }),
      K(3400, null, null, { flag: 'chatter', vox: 'chatter', say: 'dance', sayMs: 2200, sayCls: 'shout' }),
      K(4300, null, null, { unflag: 'chatter', hrl: 'dance', cheer: 1200, confetti: 60 }),
      K(4500, 'cocked', {}, { ms: 260, flag: 'bounce', walk: [130, 820] }),
      K(5500, null, { dx: 16 }, { ms: 260, say: 'dance', sayMs: 2200, vox: 'giggle' }),
      K(6000, 'twirl', { rot: -14 }, { ms: 220, unflag: 'bounce', sfx: 'whoosh', sfxArgs: [1.1] }),
      K(6300, 'swing', { rot: 12 }, { ms: 200, fx: 'fx_stars_ring', fxAt: [70, -300], fxScale: 0.9 }),
      K(6600, 'ready', {}, { ms: 260, walk: [-130, 780] }),
      K(7600, 'raise', { dy: -12 }, { ms: 380, cheer: 1000, vox: 'laugh' }),
    ],
    B: null,
  },
};

// =====================================================================================================
// MOPES: the loser's track, chosen by character, so the same dance plays over a different sulk.
// Every mope runs for the WHOLE finale (never an arm parked at rest while the other one crows) and ends
// in a slump. Beats: the shock, the giving up, the turning away, the sulky glance back, the collapse.
// =====================================================================================================
export const MOPES = {
  // generic: sag, turn away, rock, one sulky glance, slump
  default: [
    K(0, 'stagger', { dy: 10, rot: -8 }, { ms: 300, flag: 'shiver' }),
    K(700, 'dizzy', { dy: 14, rot: 6 }, { ms: 620, unflag: 'shiver', flag: 'sag', vox: 'sigh', say: 'lose', sayMs: 2400, sayCls: 'mutter' }),
    K(1900, 'rest', { dx: -26, dy: 12, rot: 9, sc: 0.96 }, { ms: 820, sfx: 'servo', sfxArgs: [1.3] }),
    K(2800, null, null, { unflag: 'sag', flag: 'sway' }),
    K(4200, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(4900, 'confused', { dx: -8, dy: 10, rot: -5 }, { ms: 520, unflag: 'sway' }),
    K(5700, 'rest', { dx: -26, dy: 12, rot: 9, sc: 0.96 }, { ms: 620, flag: 'sway', vox: 'hmph' }),
    K(7000, 'rest', { dx: -16, dy: 20, rot: 8, sc: 0.94 }, { ms: 900, unflag: 'sway', flag: 'slump', sfx: 'deny' }),
    K(7900, null, null, { say: 'mope', sayMs: 2200, sayCls: 'mutter' }),
  ],
  // Bluebell: a very big feeling, two table slaps, then sniffles she would rather nobody saw
  squire: [
    K(0, 'stagger', { dy: 8, rot: -6 }, { ms: 260, flag: 'shiver', vox: 'gasp' }),
    K(600, 'dizzy', { dy: 6, rot: -2 }, { ms: 200, unflag: 'shiver', flag: 'tantrum', say: 'lose', sayMs: 2200, sayCls: 'mutter' }),
    K(1250, 'smash', { dy: 20 }, { ms: 150, sfx: 'step', shake: 1, fx: 'fx_dust2', fxAt: [40, -20], fxScale: 1.1 }),
    K(1500, 'stagger', { dy: 6, rot: -4 }, { ms: 200 }),
    K(1900, 'smash', { dy: 20 }, { ms: 150, sfx: 'step', shake: 1, fx: 'fx_dust', fxAt: [20, -20], fxScale: 1 }),
    K(2300, 'rest', { dy: 14, rot: 7 }, { ms: 700, unflag: 'tantrum', flag: 'sag', vox: 'sob' }),
    K(3200, null, { dx: -32, dy: 14, rot: 11, sc: 0.95 }, { ms: 800 }),
    K(3700, null, null, { unflag: 'sag', flag: 'sobbob' }),
    K(4100, null, null, { vox: 'sob', say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(5300, null, null, { vox: 'sob' }),
    K(5700, 'confused', { dx: -10, dy: 12, rot: -5 }, { ms: 520, unflag: 'sobbob', flag: 'sway' }),
    K(6400, 'rest', { dx: -30, dy: 14, rot: 11, sc: 0.95 }, { ms: 600, unflag: 'sway', flag: 'sobbob', vox: 'sob' }),
    K(7200, 'rest', { dx: -18, dy: 20, rot: 9, sc: 0.93 }, { ms: 900, unflag: 'sobbob', flag: 'slump', say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(8100, null, null, { vox: 'sob' }),
  ],
  // Sir Percival: disbelief, a turned back, two immaculate tuts, and a glance to check you are still there
  percival: [
    K(0, 'confused', { dy: 4, rot: -4 }, { ms: 300, flag: 'shiver' }),
    K(800, 'stagger', { dy: 10, rot: 5 }, { ms: 600, unflag: 'shiver', vox: 'hmph', say: 'lose', sayMs: 2400, sayCls: 'mutter' }),
    K(1700, 'rest', { dx: -38, dy: 10, rot: 11, sc: 0.94 }, { ms: 900, ease: 'cubic-bezier(.4,0,.3,1)', sfx: 'servo', sfxArgs: [1.3] }),
    K(2600, null, null, { flag: 'sway' }),
    K(2950, null, null, { vox: 'tut' }),
    K(3400, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(4400, 'confused', { dx: -16, dy: 8, rot: -6 }, { ms: 520, unflag: 'sway' }),
    K(5000, null, null, { vox: 'tut' }),
    K(5400, 'rest', { dx: -38, dy: 12, rot: 11, sc: 0.94 }, { ms: 620, flag: 'sway', say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(6800, null, null, { unflag: 'sway', flag: 'sag' }),
    K(7400, 'rest', { dx: -26, dy: 18, rot: 11, sc: 0.93 }, { ms: 900, unflag: 'sag', flag: 'slump', vox: 'sigh' }),
    K(8200, null, null, { say: 'mope', sayMs: 2200, sayCls: 'mutter' }),
  ],
  // The Iron Champion: no tantrum, just a shutdown, joint by joint, with the servo whine falling each time
  champion: [
    K(0, 'stagger', { dy: 6, rot: -4 }, { ms: 260, flag: 'shiver', say: 'lose', sayMs: 2400, sayCls: 'mutter' }),
    K(900, 'dizzy', { dy: 10, rot: -6 }, { ms: 520, unflag: 'shiver', sfx: 'servo', sfxArgs: [1.6], fx: 'fx_spark', fxAt: [40, -300], fxScale: 0.6 }),
    K(1800, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(2100, 'low', { dy: 16, rot: 5 }, { ms: 700, sfx: 'servo', sfxArgs: [1.2] }),
    K(3000, null, null, { flag: 'shiver', fx: 'fx_spark', fxAt: [20, -200], fxScale: 0.5 }),
    K(3400, null, null, { unflag: 'shiver' }),
    K(3600, 'crouch', { dy: 22, rot: 6, sc: 0.97 }, { ms: 800, sfx: 'servo', sfxArgs: [0.9], vox: 'sigh' }),
    K(4600, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(5000, null, null, { flag: 'sag' }),
    K(5600, null, { dy: 26, rot: 10, sc: 0.95 }, { ms: 900, sfx: 'servo', sfxArgs: [0.6], fx: 'fx_dust2', fxAt: [-30, -20], fxScale: 1 }),
    K(6700, 'rest', { dy: 24, rot: 9, sc: 0.93 }, { ms: 800, unflag: 'sag', flag: 'slump', sfx: 'deny' }),
    K(7500, null, null, { say: 'mope', sayMs: 2200, sayCls: 'mutter' }),
  ],
  // Lionheart (when the player loses): the slump is real, but the Lion picks its head back up
  lionheart: [
    K(0, 'stagger', { dy: 10, rot: -8 }, { ms: 260, flag: 'wobble' }),
    K(900, 'rest', { dy: 16, rot: -6 }, { ms: 700, unflag: 'wobble', flag: 'sag', vox: 'sigh', say: 'lose', sayMs: 2400, sayCls: 'mutter' }),
    K(2200, null, null, { unflag: 'sag', flag: 'sway' }),
    K(2600, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(3400, null, { dx: -28, dy: 14, rot: 7, sc: 0.96 }, { ms: 820 }),
    K(4400, null, null, { vox: 'sigh' }),
    K(4800, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(5600, 'ready', { dy: 4 }, { ms: 700, unflag: ['sway', 'sag'], sfx: 'servo', sfxArgs: [1] }),
    K(6400, null, { dy: 12, rot: 8 }, { ms: 260 }),
    K(6720, null, {}, { ms: 360, vox: 'hmm' }),
    K(7100, null, null, { say: 'mope', sayMs: 2400, sayCls: 'mutter' }),
    K(7800, 'rest', { dy: 4 }, { ms: 520 }),
  ],
};
for (const n of ['VICTORY_VS_DEFEAT', 'GRACIOUS_WIN', 'SORE_LOSER', 'SLOW_CLAP']) SCENES[n].B = MOPES.default;
export const SCENE_NAMES = Object.keys(SCENES);
