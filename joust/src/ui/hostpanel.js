// Host Controls: the drawer behind the `host` gear in the settings strip.
//
// The big screen is run by a person standing next to it -- the host -- and until now everything they might
// need mid-evening (pause the fight, skip a long animation, call a draw, change the starting HP, deal with a
// player who has wandered off to the bar) lived in the source, a URL parameter, or nowhere. This is that
// panel. It has three sections:
//
//   Fight       what can be done to the fight on the stage RIGHT NOW: pause, skip, restart, end it with a
//               winner or a draw, or walk out to the title.
//   Settings    what the NEXT fight will use: starting HP and counters per side, the sim beat length, the
//               plan timer, the opening and finishing poses, sim/live arms, the audio toggles, the campaign's
//               tells and Marla's chatter. All of it persists (src/game/settings.js, localStorage).
//   Phone duel  only when a room is open: the code and both links, who is connected and how stale, force
//               lock, kick and reissue a seat, swap colours, start a rematch, auto-forfeit.
//
// It is a renderer and nothing else: every button calls into hostctl's `session` (what is on the stage) or
// into `settings`. Closed, it is display:none, so it cannot eat a click meant for the arena; the controls are
// deliberately oversized, because the host is usually standing a metre back with a drink in one hand.
import { control, session } from '../game/hostctl.js';
import * as settings from '../game/settings.js';
import { getPref, setPref, initAudio } from '../audio/audio.js';
import { SIDE_NAME } from '../net/room.js';

const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** "connected", "14 s ago", "never" -- how long since that phone last spoke to the server. */
function ageWord(secs) {
  if (secs == null) return 'never seen';
  if (secs < 3) return 'connected';
  if (secs < 60) return `${Math.round(secs)} s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  return 'long gone';
}
function ageClass(secs) { return secs == null ? 'off' : secs < 6 ? 'ok' : secs < 40 ? 'warn' : 'off'; }

export class HostPanel {
  constructor({ poseOptions = null, onHw = null, onPref = null, hwMode = 'sim' } = {}) {
    this.poses = poseOptions || { openers: [], finales: [] };
    this.onHw = onHw;                 // main.js owns the sim/live switch (it reloads the page)
    this.onPref = onPref || ((k, on) => setPref(k, on));   // keeps the settings strip's buttons in step
    this.hwMode = hwMode;
    this.open = false;
    this.armed = {};                  // two-step confirmations, by key, surviving a repaint
    this.root = null;
    this.build();
    this.offs = [
      control.on(() => this.paint()),
      session.on(() => this.paint()),
      settings.onChange(() => this.paint()),
    ];
    // The paused banner on the stage is this panel's business too: one subscription, one place.
    control.on(c => { document.body.classList.toggle('hostpaused', c.paused); });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.close(); }
    });
  }
  setPoseOptions(opts) { this.poses = opts || this.poses; if (this.open) this.paint(); }

  // ---- shell ---------------------------------------------------------------------------------------------
  build() {
    const r = el('div', 'hostdrawer', document.body);
    r.hidden = true;
    r.innerHTML = `
      <div class="hdhead">
        <div class="hdtitle">Host controls</div>
        <button class="hdx" title="Close (Esc)">Close</button>
      </div>
      <div class="hdbody">
        <section class="hdsec" data-sec="fight"><h3>Fight</h3><div class="hdrows"></div></section>
        <section class="hdsec" data-sec="hw"><h3>Arms <small>the real metal</small></h3><div class="hdrows"></div></section>
        <section class="hdsec" data-sec="phones"><h3>Phone duel</h3><div class="hdrows"></div></section>
        <section class="hdsec" data-sec="settings"><h3>Settings <small>applied to the next fight</small></h3><div class="hdrows"></div></section>
      </div>`;
    this.root = r;
    const rows = k => r.querySelector(`[data-sec=${k}] .hdrows`);
    this.box = { fight: rows('fight'), hw: rows('hw'), phones: rows('phones'), settings: rows('settings') };
    this.secs = { fight: r.querySelector('[data-sec=fight]'), hw: r.querySelector('[data-sec=hw]'),
                  phones: r.querySelector('[data-sec=phones]'), settings: r.querySelector('[data-sec=settings]') };
    r.querySelector('.hdx').onclick = () => this.close();
  }
  toggle() { this.open ? this.close() : this.show(); }
  show() {
    this.open = true; this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('in'));
    document.getElementById('hostbtn')?.classList.add('on');
    this.paint();
    // Ask the server who is out there BEFORE the first tick, or the freshly opened panel would show the age
    // of the last acts long-poll (up to 25 s) and read as "gone" for a phone that is perfectly happy.
    this.pollRoom().then(() => this.paint());
    this.pollHw().then(() => this.paint());
    // While the drawer is open, keep the phone connection states honest. Only the phone rows are repainted
    // on the tick: rebuilding the settings every second would fight whoever is dragging the beat slider.
    clearInterval(this.tick);
    this.tick = setInterval(async () => {
      this.pollRoom(); await this.pollHw();
      if (session.room) this.paintPhones();
      this.paintFight(); this.paintHw();
    }, 1000);
  }
  close() {
    this.open = false; this.root.classList.remove('in');
    document.getElementById('hostbtn')?.classList.remove('on');
    clearInterval(this.tick); this.tick = null;
    setTimeout(() => { if (!this.open) this.root.hidden = true; }, 220);   // ...after the slide-out
  }
  async pollRoom() {
    const room = session.room; if (!room || this._polling) return;
    this._polling = true;
    try { await room.state(); } catch (e) { /* the room may have closed under us */ }
    this._polling = false;
  }

  // ---- little control factories -------------------------------------------------------------------------
  row(box, label, hint = '') {
    const d = el('div', 'hdrow', box);
    el('div', 'hdlab', d, `${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}`);
    return el('div', 'hdctl', d);
  }
  btn(box, text, fn, { cls = '', disabled = false, title = '' } = {}) {
    const b = el('button', 'hdbtn ' + cls, box, esc(text));
    b.disabled = !!disabled; if (title) b.title = title;
    b.onclick = () => { try { fn(); } catch (e) { console.warn('host control', e); } };
    return b;
  }
  /** A row of mutually exclusive choices, sized for a thumb from a metre away. */
  seg(box, values, cur, fn, fmt = v => String(v)) {
    const s = el('div', 'hdseg', box);
    for (const v of values) {
      const b = el('button', 'hdbtn seg' + (v === cur ? ' on' : ''), s, esc(fmt(v)));
      b.onclick = () => fn(v);
    }
    return s;
  }
  /** minus / value / plus, because a number input is a bad target from across a room. */
  stepper(box, value, [lo, hi], fn, fmt = v => String(v)) {
    const s = el('div', 'hdstep', box);
    const minus = el('button', 'hdbtn step', s, '−');
    const val = el('div', 'hdval', s, esc(fmt(value)));
    const plus = el('button', 'hdbtn step', s, '+');
    minus.disabled = value <= lo; plus.disabled = value >= hi;
    minus.onclick = () => fn(Math.max(lo, value - 1));
    plus.onclick = () => fn(Math.min(hi, value + 1));
    return { s, val };
  }
  sw(box, on, fn, labels = ['on', 'off']) {
    const b = el('button', 'hdbtn switch' + (on ? ' on' : ''), box, on ? esc(labels[0]) : esc(labels[1]));
    b.onclick = () => fn(!on);
    return b;
  }

  // ---- paint ---------------------------------------------------------------------------------------------
  paint() {
    if (!this.open) return;
    this.paintFight();
    this.paintHw();
    this.paintPhones();
    this.paintSettings();
  }

  // ---- the real metal --------------------------------------------------------------------------------------
  /** Ask server.py what the hardware is doing. Only in live mode, and only while the drawer is open: in sim
   *  there is nothing to ask and no daemon to bother. */
  async pollHw() {
    if ((this.hwMode || 'sim') !== 'live' || this._hwPolling) return;
    this._hwPolling = true;
    try { const r = await fetch('/api/status'); this.hwStatus = await r.json(); }
    catch (e) { this.hwStatus = { armA: { offline: true, error: String(e) }, armB: { offline: true } }; }
    this._hwPolling = false;
  }
  /** One arm's line: offline, busy, or idle, plus whatever the daemon last said about it. */
  armRow(box, label, entry) {
    const off = !entry || entry.offline;
    const state = off ? 'not connected' : entry.busy ? 'busy' : 'idle';
    const c = this.row(box, label, off ? (entry && (entry.error || entry.reason) ? String(entry.error || entry.reason).slice(0, 60) : 'the daemon does not report this arm') : (entry.model || ''));
    el('div', 'hdval', c, esc(state));
    el('div', 'hdnote', c, esc(off ? '' : (entry.last || '')));
  }

  paintHw() {
    const live = (this.hwMode || 'sim') === 'live';
    this.secs.hw.hidden = !live;
    if (!live) return;
    const box = this.box.hw; box.innerHTML = '';
    const s = this.hwStatus, bridge = session.bridge;
    if (!s) { el('div', 'hdnote', box, 'Asking server.py what the arms are doing…'); return; }

    this.armRow(box, 'Red arm (A)', s.armA);
    this.armRow(box, 'Blue arm (B)', s.armB);

    const g = s.gantry || { offline: true };
    const gword = g.offline ? 'no gantry'
      : !g.connected ? 'not opened'
        : `${g.busy ? 'busy' : (g.state || 'Idle')}${g.homed ? '' : ' — NOT referenced'}`;
    const gc = this.row(box, 'Gantry', g.offline ? 'the daemon reports no gantry' : (g.homed ? 'referenced' : 'needs Prepare before it can move'));
    el('div', 'hdval', gc, esc(gword));
    if (!g.offline && g.connected && g.x != null) el('div', 'hdnote', gc, esc(`X=${Math.round(g.x)}  Y=${Math.round(g.y)}  ${g.last || ''}`));

    const missing = (s.ready && s.ready.missing) || [];
    if (missing.length) el('div', 'hdnote', box, `Arm ${missing.join(' and ')} is missing — a live fight will not start.`);

    const p = this.row(box, 'Prepare arms', 'reference the gantry, carriages apart, both arms to rest');
    this.btn(p, this._preparing ? 'Preparing…' : 'Prepare', async () => {
      this._preparing = true; this.paint();
      try { await (bridge?.prepare ? bridge.prepare() : fetch('/api/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }
      catch (e) { console.warn('prepare', e); }
      this._preparing = false; await this.pollHw(); this.paint();
    }, { cls: 'go', disabled: this._preparing || !!missing.length });
    if (bridge && bridge.note) el('div', 'hdnote', p, esc(bridge.note));

    // One press, not two. An abort is the thing you reach for when metal is about to hit metal, and a
    // confirm step in front of it would be the bug. It stops both arms where they stand and resets the
    // gantry -- which throws the reference away, so Prepare has to run again afterwards.
    const ab = this.row(box, 'ABORT', 'stop both arms now and reset the gantry');
    this.btn(ab, 'Abort everything', async () => {
      try { await (bridge?.abort ? bridge.abort() : fetch('/api/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }
      catch (e) { console.warn('abort', e); }
      await this.pollHw(); this.paint();
    }, { cls: 'warn', title: 'Immediate. The gantry must be re-homed with Prepare afterwards.' });
  }

  paintFight() {
    const box = this.box.fight; box.innerHTML = '';
    const m = session.match;
    const live = !!(m && !m.over);
    this.secs.fight.classList.toggle('idle', !live);
    if (!live) el('div', 'hdnote', box, session.where === 'title' ? 'No fight on the stage. Start one from the title screen.' : 'Between fights — the fight controls wake up when the next bout starts.');

    const c1 = this.row(box, control.paused ? 'Paused' : 'Running', 'freeze the fight between beats');
    this.btn(c1, control.paused ? 'Resume' : 'Pause', () => control.toggle(), { cls: control.paused ? 'go' : 'warn', disabled: !live });

    const c2 = this.row(box, 'Skip animation', 'end this beat, opener or finale now');
    this.btn(c2, 'Skip', () => control.skip(), { disabled: !live });

    const c3 = this.row(box, 'Restart fight', 'same knights, decks and settings, back to turn 1');
    this.confirmBtn(c3, 'restart', 'Restart', () => m?.finishNow('restart'), { disabled: !live });

    const c4 = this.row(box, 'End fight', 'declare it and go to the result screen');
    this.btn(c4, 'Red wins', () => m?.finishNow('a'), { cls: 'red', disabled: !live });
    this.btn(c4, 'Blue wins', () => m?.finishNow('b'), { cls: 'blue', disabled: !live });
    this.btn(c4, 'Draw', () => m?.finishNow('draw'), { disabled: !live });

    const c5 = this.row(box, 'Back to title', 'ends the fight and closes the room');
    this.confirmBtn(c5, 'title', 'To the title', () => {
      this.close();
      if (m && !m.over) m.finishNow('quit'); else session.onTitle?.();
    }, { cls: 'warn' });
  }

  /** Two-step for the destructive ones: the second press inside four seconds does it. The armed state is
   *  kept on the panel, not on the button, so the once-a-second repaint does not disarm it under the host. */
  isArmed(key) { const t = this.armed[key]; return !!t && t > Date.now(); }
  arm(key) { this.armed[key] = Date.now() + 4000; setTimeout(() => this.paint(), 4100); }
  /** Wire a button as a confirm step. Returns the label it should show right now. */
  confirmBtn(box, key, word, fn, opts = {}) {
    const armed = this.isArmed(key);
    return this.btn(box, armed ? 'Sure?' : word, () => {
      if (this.isArmed(key)) { this.armed[key] = 0; fn(); this.paint(); }
      else { this.arm(key); this.paint(); }
    }, { ...opts, cls: (opts.cls || '') + (armed ? ' armed' : '') });
  }

  paintPhones() {
    const room = session.room, host = session.host;
    this.secs.phones.hidden = !room;
    if (!room) return;
    const box = this.box.phones; box.innerHTML = '';
    const inLobby = !session.match || session.match.over;

    const c0 = this.row(box, 'Room', 'both phones need this screen’s address');
    el('div', 'hdcode', c0, esc(room.code));

    for (const side of ['a', 'b']) {
      const p = host?.players?.[side] || {};
      const age = room.age(side);
      const d = el('div', 'hdseat ' + side, box);
      el('div', 'hdseathead', d,
        `<b>${esc(p.name || SIDE_NAME[side])}</b>
         <span class="hddot ${ageClass(age)}"></span><i>${esc(p.joined ? ageWord(age) : p.reissued ? 'waiting for a new phone' : 'not joined')}</i>`);
      el('div', 'hdlink', d, esc(room.urls?.[side] || ''));
      const acts = el('div', 'hdseatacts', d);
      const waiting = !!host?.pending?.[side];
      this.btn(acts, 'Force lock now', () => host?.forceLock(side, 'host'), { disabled: !waiting, title: 'Play this side’s current slots; unfilled beats rest' });
      this.confirmBtn(acts, 'kick:' + side, 'Kick and reissue', async () => {
        try { await host?.kick(side); } catch (e) { console.warn('reissue failed', e); }
        this.paint();
      }, { cls: 'warn', title: 'Mint a new ticket for this seat; the old phone is told it was reissued' });
      if (host?.missed?.[side]) el('div', 'hdnote', d, `${host.missed[side]} plan timer${host.missed[side] > 1 ? 's' : ''} missed in a row`);
    }

    const c1 = this.row(box, 'Swap seats', inLobby ? 'the knights trade colours' : 'lobby only');
    this.btn(c1, 'Swap', () => host?.swapSeats(), { disabled: !inLobby || !host });

    const c2 = this.row(box, 'Rematch now', 'do not wait for both Ready presses');
    this.btn(c2, 'Fight again', () => { session.rematch?.(); }, { disabled: !session.rematch });

    const c3 = this.row(box, 'Auto-forfeit', 'after this many missed plan timers');
    this.seg(c3, settings.FORFEIT_AFTER, settings.get('autoForfeit'), v => settings.set('autoForfeit', v), v => (v ? String(v) : 'off'));
  }

  paintSettings() {
    const box = this.box.settings; box.innerHTML = '';
    const S = settings.all();

    const hpA = this.row(box, 'Red starting HP', `${settings.HP_RANGE[0]}–${settings.HP_RANGE[1]}`);
    this.stepper(hpA, S.hpA, settings.HP_RANGE, v => settings.set('hpA', v));
    const hpB = this.row(box, 'Blue starting HP', 'the campaign uses the opponent’s own number until you touch this');
    this.stepper(hpB, S.hpB, settings.HP_RANGE, v => settings.set('hpB', v));

    const cA = this.row(box, 'Red counters', 'held at the start of a fight');
    this.stepper(cA, S.countersA, settings.COUNTER_RANGE, v => settings.set('countersA', v));
    const cB = this.row(box, 'Blue counters', '');
    this.stepper(cB, S.countersB, settings.COUNTER_RANGE, v => settings.set('countersB', v));

    const vm = this.row(box, 'Voltage max', 'the rail is two notches, always');
    el('div', 'hdval fixed', vm, String(settings.VOLT_MAX));

    const bm = this.row(box, 'Beat length', 'sim only — live arms use the move library’s 1.4 s');
    const sl = el('input', 'hdslider', bm); sl.type = 'range';
    sl.min = String(settings.BEAT_RANGE[0] * 1000); sl.max = String(settings.BEAT_RANGE[1] * 1000); sl.step = '100'; sl.value = String(S.beatMs);
    const out = el('div', 'hdval', bm, (S.beatMs / 1000).toFixed(1) + ' s');
    sl.oninput = () => { out.textContent = (sl.value / 1000).toFixed(1) + ' s'; };
    sl.onchange = () => settings.set('beatMs', +sl.value);

    const pt = this.row(box, 'Plan timer', 'auto-locks whoever has not locked in');
    this.seg(pt, settings.PLAN_TIMERS, S.planTimer, v => settings.set('planTimer', v), v => (v ? `${v} s` : 'off'));

    const op = this.row(box, 'Opening pose', 'what the arms do before the first beat');
    this.poseSelect(op, 'opener', this.poses.openers, S.opener);
    const fp = this.row(box, 'Finishing pose', 'what they do after the knockout');
    this.poseSelect(fp, 'finale', this.poses.finales, S.finale);

    const arms = this.row(box, 'Arms', 'live drives the real SO-101 / SO-100 through server.py');
    const mode = this.hwMode || 'sim';
    this.seg(arms, ['sim', 'live'], mode, v => { if (v !== mode) this.onHw?.(v); });

    const au = this.row(box, 'Sound', 'music, effects, Marla’s voice, the crowd');
    for (const [k, label] of [['music', 'music'], ['sfx', 'sounds'], ['voice', 'voice'], ['crowd', 'crowd']]) {
      const b = el('button', 'hdbtn seg' + (getPref(k) ? ' on' : ''), au, label);
      b.onclick = () => { initAudio(); this.onPref?.(k, !getPref(k)); this.paint(); };
    }

    const tl = this.row(box, 'Show tells', 'campaign: the opponent’s pre-lock twitch');
    this.sw(tl, S.tells, v => settings.set('tells', v));
    const ch = this.row(box, 'Marla chatter', 'off: skip her dialogue entirely');
    this.sw(ch, S.chatter, v => settings.set('chatter', v));

    const rs = this.row(box, 'Reset settings', 'back to the defaults');
    this.confirmBtn(rs, 'reset', 'Reset', () => settings.reset(), { cls: 'warn' });
  }

  poseSelect(ctl, key, list, cur) {
    const s = el('select', 'hdsel', ctl);
    s.innerHTML = `<option value="">none</option>` + (list || []).map(o =>
      `<option value="${esc(o.name)}"${o.name === cur ? ' selected' : ''}>${esc(o.title || o.name)}</option>`).join('');
    if (cur && !(list || []).some(o => o.name === cur)) s.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)} (not in the manifest)</option>`);
    s.onchange = () => settings.set(key, s.value || '');
    if (!list || !list.length) el('div', 'hdnote', ctl, 'No scenes synced (tools/sync_emotes.py).');
  }
}
