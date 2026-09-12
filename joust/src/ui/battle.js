// HUD (banners, hp, statuses, beat pips) and the card table (hand, beat slots, energy, lock-in, duel row).
import { card, REST, STAGGER, TYPE_LABEL, ENERGY_PER_TURN, BEATS_PER_TURN } from '../game/cards.js';
import { GLYPH, ART_STYLE, artSrc, BOLT, COUNTER_MARK } from './icons.js';
import { sfx } from '../audio/audio.js';

// VOLTAGE: the charge the arm stores (0..VOLT_MAX). Rendered as a gauge under each fighter's HP bar.
export const VOLT_MAX = 2;

// moves with a rendered MuJoCo clip in assets/clips/ (robot-jousting/videos)
const CLIPS = ['ATTACK_HIGH', 'ATTACK_LOW_LR', 'ATTACK_LOW_RL', 'BLOCK_HIGH', 'BLOCK_LEFT', 'BLOCK_RIGHT', 'BLOCK_MIDDLE', 'FEINT_HIGH', 'FEINT_LEFT', 'FEINT_RIGHT', 'REST'];
const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };

export function cardEl(c, { color = 'red', faceDown = false, key = null, needsVolt = false } = {}) {
  const d = el('div', 'card');
  if (faceDown) { d.classList.add('back'); if (color === 'red') d.classList.add('red'); return d; }
  d.classList.add('type-' + c.type); d.dataset.id = c.id;
  const line = c.type === 'attack' ? `<b>${c.line === 'any' ? 'any line' : c.line + ' line'}</b><span>${c.dmg} damage</span>`
    : c.type === 'block' ? `<b>blocks ${c.blocks.length === 2 ? 'both' : c.blocks[0]}</b><span>${c.parry ? 'parry' : c.brace ? 'brace' : 'guard'}</span>`
    : c.type === 'feint' ? `<b>${c.line} line</b><span>feint</span>`
    : c.type === 'rush' ? `<b>rush, ${!c.line || c.line === 'any' ? 'any' : c.line} line</b><span>${c.dmg ?? 4} damage, needs ${c.volt ?? 1} ${BOLT}volt</span>`
    : c.type === 'counter' ? `<b>stops any attack</b><span>throws it back, spent when it fires</span>`
    : `<b>${TYPE_LABEL[c.type] || c.type}</b><span>${c.effect || ''}</span>`;
  const art = ART_STYLE[c.id] || ART_STYLE[c.type]; const style = art ? ` style="${art}"` : '';
  d.innerHTML = `<div class="band">${c.name}</div><div class="cost">${c.cost}</div>
    <div class="art"><img src="${artSrc(c.id, color, c.type)}" alt=""${style}><div class="glyph">${GLYPH[c.type] || ''}</div></div>
    <div class="line">${line}</div><div class="text">${c.text}</div>${key ? `<div class="key">${key}</div>` : ''}`;
  // Signal only: the rules decide whether a fireball may be played, the card just looks unplayable without charge.
  if (needsVolt) { d.classList.add('disabled', 'novolt'); el('div', 'voltnote', d, `${BOLT}needs voltage`); }
  if (c.taught === false) d.title = 'Not yet taught to the real arm: plays in sim, falls back to ' + c.fallback + ' on hardware.';
  return d;
}

export class Battle {
  constructor(hudLayer, tableLayer) {
    this.hud = hudLayer; this.table = tableLayer;
    // banners
    this.banner = {};
    for (const s of ['a', 'b']) {
      const b = el('div', 'banner ' + s, hudLayer);
      b.innerHTML = `<div class="name"></div><div class="house"></div><div class="hpbar"><div class="ghost"></div><div class="fill"></div><div class="num"></div></div>
        <div class="volt empty" data-v="0"><div class="vlabel">${BOLT}<span>Voltage</span></div><div class="vsegs">${'<i class="seg"><b></b></i>'.repeat(VOLT_MAX)}</div></div>
        <div class="statuses"></div>`;
      this.banner[s] = { root: b, name: b.querySelector('.name'), house: b.querySelector('.house'), bar: b.querySelector('.hpbar'), fill: b.querySelector('.fill'), ghost: b.querySelector('.ghost'), num: b.querySelector('.num'), statuses: b.querySelector('.statuses'), volt: b.querySelector('.volt'), voltWord: b.querySelector('.volt .vlabel span'), segs: [...b.querySelectorAll('.volt .seg')], voltAt: null };
    }
    this.round = el('div', 'roundtitle', hudLayer, `<div class="t"></div><div class="s"></div><div class="beats"><i></i><i></i><i></i></div><div class="planclock hidden"><b></b><span>to lock in</span></div>`);
    this.pips = [...this.round.querySelectorAll('.beats i')];
    this.clock = this.round.querySelector('.planclock'); this.clockNum = this.clock.querySelector('b');
    // The host's paused banner. It sits on the HUD layer (never inside #stage's scaled content) so it reads
    // from across a room, and it is removed, not hidden, when the fight runs again.
    this.paused = el('div', 'pausedbanner hidden', hudLayer, `<b>Paused</b><span>the host has the fight held</span>`);
    // table
    this.slots = el('div', 'slots hidden', tableLayer);
    this.slotEls = [];
    for (let i = 0; i < BEATS_PER_TURN; i++) { const s = el('div', 'slot', this.slots, `<div class="n">Beat ${i + 1}</div><div class="hint">empty</div>`); s.addEventListener('click', () => this.unslot(i)); this.slotEls.push(s); }
    this.hand = el('div', 'hand hidden', tableLayer);
    this.command = el('div', 'command hidden', tableLayer, `<div class="label">Energy</div><div class="energy"></div><button class="lockbtn">Lock in</button><div class="turn"></div>`);
    this.energyEl = this.command.querySelector('.energy'); this.lockBtn = this.command.querySelector('.lockbtn'); this.turnEl = this.command.querySelector('.turn');
    this.duel = el('div', 'duel hidden', tableLayer);
    // move preview: the MuJoCo clip of the real arm playing the hovered card's move
    this.preview = el('div', 'preview hidden', tableLayer, `<div class="cap">What the arm will do</div><video muted loop playsinline></video><div class="mv"></div>`);
    this.previewVideo = this.preview.querySelector('video'); this.previewName = this.preview.querySelector('.mv');
    this.lockBtn.addEventListener('click', () => this.lock());
    // The tail of a drag also arrives as a click (on whatever mousedown/mouseup had in common, or on the
    // drag source once it has pointer capture). Swallow that one click before it reaches a card or a slot,
    // or dropping a card would immediately unslot it again. draggable() raises the flag on a real drag; any
    // fresh press anywhere on the table clears it, so a stale flag can never eat a later genuine click.
    this.table.addEventListener('pointerdown', () => { this.suppressClick = false; }, true);
    this.table.addEventListener('click', e => { if (this.suppressClick) { this.suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
    window.addEventListener('keydown', e => this.key(e));
    this.plan = null; this.suppressClick = false;
  }
  show(on) { this.hud.classList.toggle('hidden', !on); }
  setNames(a, b) { this.banner.a.name.textContent = a.name; this.banner.a.house.textContent = a.title; this.banner.b.name.textContent = b.name; this.banner.b.house.textContent = b.title; }
  setRound(title, sub) { this.round.querySelector('.t').textContent = title; this.round.querySelector('.s').textContent = sub; }
  setHp(side, hp, max) {
    const b = this.banner[side]; const f = Math.max(0, hp / max);
    b.fill.style.transform = `scaleX(${f})`; b.num.textContent = `${hp} / ${max}`; b.bar.classList.toggle('low', f <= 0.3 && hp > 0);
    clearTimeout(b.ghostT); b.ghostT = setTimeout(() => { b.ghost.style.transform = `scaleX(${f})`; }, 700);
  }
  setStatus(side, st) {
    st = st || {};
    this.setVoltage(side, st.voltage);
    const box = this.banner[side].statuses; box.innerHTML = '';
    const chips = [];
    if (st.staggered) chips.push(['Staggered', 'bad']); if (st.exposed) chips.push(['Exposed', 'bad']);
    if (st.riposte) chips.push(['Riposte +2']); if (st.windup) chips.push(['Wind up +3']); if (st.parry) chips.push(['Parry ×2']); if (st.flourish) chips.push([`Flourish +${st.flourish} cards`]);
    if (st.counter > 0) chips.push([`Counter ×${st.counter}`, 'counterchip', COUNTER_MARK]);
    for (const [t, cls, icon] of chips) el('span', 'status ' + (cls || ''), box, (icon || '') + `<span>${t}</span>`);
  }
  /** The VOLTAGE gauge under the HP bar. `v` undefined (the mechanics have not landed yet) reads as 0. */
  setVoltage(side, v) {
    const B = this.banner[side]; if (!B.volt) return;
    const n = Math.max(0, Math.min(VOLT_MAX, Math.round(Number(v) || 0)));
    const prev = B.voltAt == null ? n : B.voltAt;          // first paint never crackles
    B.voltAt = n; B.volt.dataset.v = n;
    B.volt.classList.toggle('charged', n >= VOLT_MAX); B.volt.classList.toggle('empty', n === 0);
    if (B.voltWord) B.voltWord.textContent = n >= VOLT_MAX ? 'Charged' : 'Voltage';
    B.volt.title = `Voltage ${n} / ${VOLT_MAX}`;
    B.segs.forEach((s, i) => {
      const on = i < n; s.classList.toggle('on', on);
      if (on && i >= prev) { s.classList.remove('crackle'); void s.offsetWidth; s.classList.add('crackle'); }   // restart the one-shot
      else if (!on) s.classList.remove('crackle');
    });
  }
  setBeat(i) { this.pips.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('done', i != null && k < i); }); }
  /** The plan countdown (Host Controls -> Settings -> Plan timer). `left` in seconds, or null to hide it.
   *  It shows in two places: under the round title, and on the Lock in button while the table is up. */
  setTimer(left, total = 0) {
    const off = left == null || !(total > 0);
    this.clock.classList.toggle('hidden', off);
    if (!off) {
      const n = Math.max(0, Math.round(left));
      this.clockNum.textContent = n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : String(n);
      this.clock.classList.toggle('urgent', n <= 10);
    }
    this.timerLeft = off ? null : left;
    this.paintLockLabel();
  }
  /** Lock in (0:22) -- the same countdown where the player's eyes already are. */
  paintLockLabel() {
    if (!this.plan) return;
    const base = this.plan.chain.every(x => x === null) ? 'Rest' : 'Lock in';
    const t = this.timerLeft;
    this.lockBtn.textContent = t == null ? base : `${base} · ${Math.max(0, Math.round(t))}s`;
    this.lockBtn.classList.toggle('urgent', t != null && t <= 10);
  }
  /** The host froze the fight: say so on the stage, big enough to read from the back of the room. */
  setPaused(on) { this.paused.classList.toggle('hidden', !on); }

  // ---- planning ----
  /** Show hand + slots; resolves with an array of card ids (null = empty beat) when the player locks in.
   *  `status` is optional and is THIS side's status object (e.g. match.js: `status: this.st.a`, or from a
   *  planView, `view.status[view.side]`). Only st.voltage is read, and only to grey a Rush the player cannot
   *  pay for: the rules still decide. Leave it out and nothing is greyed for voltage. */
  planTurn({ hand, energy, turn, color = 'red', status = null }) {
    return new Promise(resolve => {
      this.plan = { hand: [...hand], energy, spent: 0, chain: Array(BEATS_PER_TURN).fill(null), resolve, color, status };
      this.turnEl.textContent = `Turn ${turn}`;
      this.duel.classList.add('hidden'); this.slots.classList.remove('hidden'); this.command.classList.remove('hidden'); this.hand.classList.remove('hidden');
      this.renderHand(); this.renderSlots(); sfx.draw();
      this.showPreview(null, true);
    });
  }
  /** Voltage still unspent by the chain as planned, or null when the caller passed no status (mechanics not in yet). */
  voltLeft() {
    const P = this.plan; if (!P || !P.status || P.status.voltage == null) return null;
    let v = Number(P.status.voltage) || 0;
    for (const id of P.chain) if (id) v -= card(id).volt || 0;
    return v;
  }
  hoverCard(id) { if (this.previewId !== id) sfx.hover(); this.showPreview(id); }
  /** Debounced + deduplicated: sweeping across the fan used to reload the <video> once per card and strobe. */
  showPreview(id, now = false) {
    if (id === this.previewId && !now) return;
    this.previewId = id; clearTimeout(this.previewT);
    if (now) this.paintPreview(id); else this.previewT = setTimeout(() => this.paintPreview(id), 70);
  }
  paintPreview(id) {
    const c = id && card(id); if (!c) { this.previewName.textContent = 'hover a card'; this.previewVideo.removeAttribute('src'); this.previewVideo.load(); this.preview.classList.remove('hidden'); return; }
    const hw = CLIPS.includes(c.hw) ? c.hw : (c.fallback && CLIPS.includes(c.fallback) ? c.fallback : null);
    this.previewName.textContent = hw ? (hw === c.hw ? c.hw : `${c.hw}: not taught yet, the arm plays ${hw}`) : `${c.hw || c.name}: not taught yet`;
    const src = hw ? `assets/clips/tuned_${hw}.mp4` : '';
    if (this.previewVideo.getAttribute('src') !== src) { if (src) { this.previewVideo.src = src; this.previewVideo.play().catch(() => {}); } else { this.previewVideo.removeAttribute('src'); this.previewVideo.load(); } }
    this.preview.classList.remove('hidden');
  }
  renderHand() {
    const P = this.plan; this.hand.innerHTML = '';
    const n = P.hand.length; const spread = Math.min(9, 44 / Math.max(n - 1, 1));
    const volt = this.voltLeft();
    P.hand.forEach((id, i) => {
      const c = card(id);
      const d = cardEl(c, { color: P.color, key: i + 1, needsVolt: !!(c.volt && volt != null && volt < c.volt) });
      // The fan angle lives on a wrapper that never moves: the lift on hover used to slide the card out from
      // under the pointer, which unhovered it, which put it back - a flicker loop at the edge of every card.
      const fan = el('div', 'fan', this.hand);
      const r = (i - (n - 1) / 2) * spread; fan.style.setProperty('--r', r + 'deg'); fan.style.setProperty('--y', Math.abs(r) + 'px');
      if (c.cost > P.energy - P.spent) d.classList.add('disabled');      // greying is about energy only: a full chain can still be replaced
      d.addEventListener('click', e => this.slotCard(i, e));
      d.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); });
      d.addEventListener('mouseenter', () => this.hoverCard(id));
      this.draggable(d, { from: 'hand', index: i, id });
      fan.appendChild(d);
    });
    this.renderEnergy();
    this.paintLockLabel();
    this.lockBtn.title = P.chain.every(x => x === null) ? 'Lock in an empty chain: the arm rests all three beats' : 'Lock in this chain (Enter)';
  }
  /** Coins are updated in place so spending and refunding both animate (rebuilding them skipped the transition). */
  renderEnergy() {
    const P = this.plan; if (!P) return; const box = this.energyEl;
    if (box.children.length !== ENERGY_PER_TURN) { box.innerHTML = ''; for (let i = 0; i < ENERGY_PER_TURN; i++) el('div', 'coin', box); }
    [...box.children].forEach((coin, i) => { coin.classList.toggle('spent', i < P.spent); coin.classList.toggle('locked', i >= P.energy); });
  }
  renderSlots() {
    const P = this.plan; const next = P.chain.indexOf(null); const full = next < 0;
    this.slotEls.forEach((s, i) => {
      s.querySelector('.card')?.remove(); s.classList.toggle('next', i === next);
      s.classList.toggle('replace', full && i === BEATS_PER_TURN - 1);   // where a click would land once the chain is full
      const hint = s.querySelector('.hint');
      if (P.chain[i]) { hint.style.display = 'none'; const ce = cardEl(card(P.chain[i]), { color: P.color }); ce.addEventListener('mouseenter', () => this.hoverCard(P.chain[i])); this.draggable(ce, { from: 'slot', index: i, id: P.chain[i] }); s.appendChild(ce); }
      else { hint.style.display = ''; hint.textContent = i === next ? 'play a card' : 'empty · rests'; }
    });
  }
  /** Click or number key: fill the next free beat, or replace the last one when the chain is already full. */
  slotCard(handIndex, ev) {
    const P = this.plan; if (!P) return;
    if (ev && ev.detail > 1) return;                       // the second half of a double-click would slot a card nobody aimed at
    if (!(handIndex >= 0 && handIndex < P.hand.length)) return;
    const next = P.chain.indexOf(null);
    this.placeCard(handIndex, next < 0 ? BEATS_PER_TURN - 1 : next);
  }
  /** Put hand card `handIndex` into beat `slot`; an occupant goes back to the hand. */
  placeCard(handIndex, slot) {
    const P = this.plan; if (!P) return false; if (!(slot >= 0 && slot < BEATS_PER_TURN)) return false;
    const id = P.hand[handIndex]; if (id == null) return false; const c = card(id); const occupant = P.chain[slot];
    const budget = P.energy - P.spent + (occupant ? card(occupant).cost : 0);
    if (c.cost > budget) { sfx.deny(); return false; }
    P.hand.splice(handIndex, 1); if (occupant) { P.spent -= card(occupant).cost; P.hand.push(occupant); }
    P.chain[slot] = id; P.spent += c.cost; sfx.card(); this.renderHand(); this.renderSlots(); return true;
  }
  /** Move a slotted card to another beat (swapping) or back to the hand. */
  moveSlot(from, to) {
    const P = this.plan; if (!P || !P.chain[from]) return;
    if (to == null) { this.unslot(from); return; }
    if (to === from) return;
    [P.chain[from], P.chain[to]] = [P.chain[to], P.chain[from]]; sfx.card(); this.renderHand(); this.renderSlots();
  }
  // ---- drag and drop (pointer events; a ghost follows the pointer in stage coordinates) ----
  draggable(elm, src) {
    elm.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.plan) return;
      const start = { x: e.clientX, y: e.clientY }, pid = e.pointerId; let ghost = null, over = null;
      const stageEl = document.getElementById('stage');
      // the stage is 1600x900 scaled by --s, so ghost coordinates live in stage space
      const toStage = ev => { const r = stageEl.getBoundingClientRect(), s = r.width / 1600 || 1; return [(ev.clientX - r.left) / s, (ev.clientY - r.top) / s]; };
      // elementsFromPoint, not elementFromPoint: the hand box overlaps the bottom quarter of the slots, and a
      // drop there must still land in the beat. The ghost is pointer-events:none so it never shows up here.
      const slotAt = ev => { const s = document.elementsFromPoint(ev.clientX, ev.clientY).find(t => t.classList && t.classList.contains('slot')); return s ? this.slotEls.indexOf(s) : -1; };
      const end = () => {                                          // returns true if this was a real drag, not a click
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
        try { if (elm.hasPointerCapture?.(pid)) elm.releasePointerCapture(pid); } catch { /* pointer already gone */ }
        this.slotEls.forEach(s => s.classList.remove('over')); elm.classList.remove('drag-src');
        if (!ghost) return false;
        ghost.remove(); ghost = null; this.suppressClick = true; return true;
      };
      const move = ev => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 7) return;   // still a click, not a drag
          ghost = elm.cloneNode(true); ghost.className = 'card drag-ghost type-' + card(src.id).type; ghost.querySelector('.key')?.remove();
          this.table.appendChild(ghost); elm.classList.add('drag-src'); sfx.unslot();
          try { elm.setPointerCapture(pid); } catch { /* capture is a nicety; the window listeners still carry the drag */ }
        }
        const [x, y] = toStage(ev); ghost.style.left = x - 75 + 'px'; ghost.style.top = y - 107 + 'px';
        const k = slotAt(ev); if (k !== over) { over = k; this.slotEls.forEach((s, i) => s.classList.toggle('over', i === k)); }
      };
      const up = ev => {
        const k = ghost ? slotAt(ev) : -1;
        if (!end()) return;                                        // never moved: let the click handler slot/unslot
        if (src.from === 'hand') { if (k >= 0) this.placeCard(src.index, k); else this.renderHand(); }
        else this.moveSlot(src.index, k >= 0 ? k : null);
      };
      // the system took the pointer away (a touch became a browser gesture): drop nothing, leave the table clean
      const cancel = () => { if (end()) { this.renderHand(); this.renderSlots(); } };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    });
  }
  unslot(i) {
    const P = this.plan; if (!P || !P.chain[i]) return;
    const id = P.chain[i]; P.spent -= card(id).cost; P.hand.push(id);
    // keep order compact: shift later beats down
    P.chain.splice(i, 1); P.chain.push(null); sfx.unslot(); this.renderHand(); this.renderSlots();
    this.showPreview(null);          // the card left the slot: stop showing its clip as if it were still hovered
  }
  /** Lock the chain in. Called by the button, by Enter, and by the plan timer when it runs out (whatever is
   *  in the three beats at that moment goes in; an empty beat rests). */
  lock() {
    const P = this.plan; if (!P) return; this.plan = null; sfx.lock();
    this.lockBtn.classList.remove('urgent');
    clearTimeout(this.previewT); this.previewId = undefined; this.lockBtn.blur();   // or Enter next turn would fire the button AND the key handler
    this.hand.classList.add('hidden'); this.slots.classList.add('hidden'); this.command.classList.add('hidden'); this.preview.classList.add('hidden'); this.previewVideo.pause();
    P.resolve(P.chain);
  }
  key(e) {
    if (!this.plan || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (i < this.plan.hand.length) { e.preventDefault(); this.slotCard(i); } }
    else if (e.key === 'Backspace') { e.preventDefault(); const last = this.plan.chain.map(x => !!x).lastIndexOf(true); if (last >= 0) this.unslot(last); }
    else if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13) { e.preventDefault(); this.lock(); }
  }

  // ---- exchange ----
  showDuel(chainA, chainB, colors = { a: 'red', b: 'blue' }) {
    this.duel.innerHTML = ''; this.pairs = [];
    for (let i = 0; i < BEATS_PER_TURN; i++) {
      const pair = el('div', 'pair', this.duel);
      const fa = this.flipper(chainA[i], colors.a), fb = this.flipper(chainB[i], colors.b);
      pair.appendChild(fa.root); el('div', 'vs', pair, 'vs'); pair.appendChild(fb.root); const out = el('div', 'outcome', pair, '');
      this.pairs.push({ root: pair, a: fa, b: fb, out });
    }
    this.duel.classList.remove('hidden');
  }
  flipper(id, color) {
    const root = el('div', 'flipper'); const inner = el('div', 'inner', root);
    const back = cardEl(null, { color, faceDown: true }); back.classList.add('back');
    const front = cardEl(id ? card(id) : REST, { color }); front.classList.add('front');
    inner.appendChild(back); inner.appendChild(front);
    return { root, inner, front, setFront(c) { const f = cardEl(c, { color }); f.classList.add('front'); inner.replaceChild(f, this.front); this.front = f; } };
  }
  /** Flip beat i: show what each arm actually did (after stagger / exposed substitutions). */
  revealBeat(i, playedA, playedB, plannedA, plannedB) {
    this.pairs.forEach((p, k) => { p.root.classList.toggle('active', k === i); p.root.classList.toggle('done', k < i); });
    const p = this.pairs[i];
    for (const [f, played, planned] of [[p.a, playedA, plannedA], [p.b, playedB, plannedB]]) {
      if (planned && played.id !== planned.id) { f.setFront(planned); f.front.classList.add(played.type === 'stagger' ? 'staggered' : 'fizzled'); }
      else f.setFront(played);
      f.root.classList.add('shown');
    }
    sfx.card();
  }
  setOutcome(i, text) { this.pairs[i].out.textContent = text; }
  hideDuel() { this.duel.classList.add('hidden'); }
}
