// Host control: the clock the show runs on, and the handle the Host Controls drawer holds.
//
// Two objects live here.
//
// HostControl is a PAUSABLE, SKIPPABLE CLOCK. Everything in a fight that waits -- match.js's gaps between
// beats, the sim bridge's beat timer, the plan countdown, the pause between the knockout and the finale --
// sleeps on this object instead of setTimeout. Pausing holds every live sleep where it stands (the
// remaining time is banked, not lost) and makes the next `gate()` block, so no new beat, animation, pose or
// timer advances until the host presses Resume. Skipping cuts every *skippable* sleep short at once and
// tells anything registered with onSkip (the screen's scene, the sim bridge) to wrap up now. The live arm
// bridge deliberately does NOT sleep here: real metal takes as long as it takes, so a skip stops the screen
// and leaves ArmBridge waiting on /api/status.
//
// HostSession is just "what is on the big screen right now" -- the match, the phone-duel host, the room --
// plus the actions the drawer calls. Everything that can change the show goes through it, so the drawer
// itself stays a dumb renderer and main.js keeps the run loop.

export const ABORT = Symbol('abort');

export class HostControl {
  constructor() {
    this.paused = false;
    this._waits = new Set();      // live sleeps
    this._skips = new Set();      // things that want to be told about a skip
    this._subs = new Set();       // UI subscribers
    this.skips = 0;               // how many times Skip has been pressed (a cheap "did it fire" counter)
  }
  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit() { for (const fn of this._subs) { try { fn(this); } catch (e) { console.warn(e); } } }

  setPaused(v) {
    v = !!v; if (v === this.paused) return;
    this.paused = v;
    for (const w of [...this._waits]) { try { v ? w.hold() : w.go(); } catch (e) {} }
    this.emit();
  }
  pause() { this.setPaused(true); }
  resume() { this.setPaused(false); }
  toggle() { this.setPaused(!this.paused); }

  /** A sleep that a pause freezes and a skip (by default) cuts short. Drop-in for `wait(ms)`. */
  sleep(ms, { skippable = true } = {}) {
    if (!(ms > 0)) return this.paused ? this.gate() : Promise.resolve();
    return new Promise(resolve => {
      const w = { remain: ms, t0: 0, timer: null, skippable };
      const done = () => { clearTimeout(w.timer); this._waits.delete(w); resolve(); };
      w.go = () => { w.t0 = performance.now(); w.timer = setTimeout(done, Math.max(0, w.remain)); };
      w.hold = () => { clearTimeout(w.timer); w.remain = Math.max(0, w.remain - (performance.now() - w.t0)); };
      w.cut = () => { if (w.skippable) done(); };
      this._waits.add(w);
      if (!this.paused) w.go();
    });
  }
  /** Resolves the moment we are not paused. The match sits on this between beats and between phases. */
  gate() {
    if (!this.paused) return Promise.resolve();
    return new Promise(resolve => {
      const off = this.on(() => { if (!this.paused) { off(); resolve(); } });
    });
  }
  /** Register something to cut short when the host presses Skip. Returns an unsubscribe. */
  onSkip(fn) { this._skips.add(fn); return () => this._skips.delete(fn); }
  /** Skip animation: end every skippable sleep now and let the listeners wrap their visuals up.
   *  A skip while paused still fires -- the next gate() simply holds until Resume. */
  skip() {
    this.skips++;
    for (const w of [...this._waits]) { try { w.cut(); } catch (e) {} }
    for (const fn of [...this._skips]) { try { fn(); } catch (e) { console.warn('skip handler', e); } }
    this.emit();
  }
  /** Everything a fight left behind (the fight is over, or was ended from the drawer). */
  clear() { for (const w of [...this._waits]) { try { w.cut(); } catch (e) {} } this._waits.clear(); this._skips.clear(); this.setPaused(false); }
}

/** The one clock the whole page shares. */
export const control = new HostControl();

// ------------------------------------------------------------------------------------------------------
/** What the drawer is looking at, and the buttons it may press. main.js keeps this up to date as the run
 *  loop moves; every field is optional, because the title screen has none of them. */
export class HostSession {
  constructor() {
    this.control = control;
    this.mode = 'title';        // 'title' | 'campaign' | 'mp'
    this.match = null;          // the running Match, if any
    this.bridge = null;         // the hardware seam for this run (SimBridge / ArmBridge): the drawer's Arms section
    this.host = null;           // MpHost, in a phone duel
    this.room = null;           // HostRoom, in a phone duel
    this.where = 'title';       // a word for the drawer: 'title' | 'lobby' | 'fight' | 'result' | 'between'
    this.rematch = null;        // set by the mp result screen: () => start the rematch now
    this.onTitle = null;        // set by main.js: cleans the room up and goes back to the title
    this._subs = new Set();
  }
  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit() { for (const fn of this._subs) { try { fn(this); } catch (e) { console.warn(e); } } }
  set(fields = {}) { Object.assign(this, fields); this.emit(); }
  /** True while a fight is actually on the stage and can be paused / skipped / ended. */
  get fighting() { return !!(this.match && !this.match.over); }
}

export const session = new HostSession();
