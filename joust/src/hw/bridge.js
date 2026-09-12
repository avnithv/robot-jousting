// Hardware seam. The match engine talks to a bridge; the bridge either just paces the animation (SimBridge)
// or drives the real SO-100 / SO-101 arms and their GRBL gantry through server.py -> arm/arm_daemon.py
// (ArmBridge).
//
// Timing: the real move library uses BEAT = 1.4 s (docs/reactions_and_pairs.md). The front end animates
// each beat over `beatMs`; ArmBridge keeps the same value so the screen and the arms stay in step.
//
// Waiting for the metal. In sim everything is a timer, and a timer is the truth. On real arms it is not:
// the daemon holds a busy lock for the whole duration of a /play, an ease-in and an ease-out bracket every
// motion, a compiled chain runs as ONE motion whose real length nobody knows in advance, and a gantry move
// is a blocking G-code dwell. So in live mode the bridge never returns on a fixed timer alone:
//   * prepare:  POST /api/prepare and watch the job until it says `ready` -- a GRBL reference sweep crawls
//               both axes onto their switches at 150 mm/min, so this is minutes, not seconds.
//   * charge / retreat: POST /api/charge | /api/retreat and watch the job. The screen's own charge and
//               retreat animations run alongside; match.js waits for whichever finishes last.
//   * whole-chain exchange: the beats are timed off the COMPILER'S OWN beat boundaries, which the exchange
//               job reports in `beats`. sim/chain.py stretches a beat whenever the connector into the next
//               move will not fit in 1.4 s (a real turn comes out as e.g. 1.79 / 1.91 / 1.46 s), so counting
//               1.4 s three times would drift the screen a third of a beat behind the metal by beat 3.
//               With no beat plan it falls back to t0 + n * BEAT. After the LAST beat it polls /api/status
//               until neither arm reports busy (12 s cap, then the show goes on regardless).
//   * per-move fallback: each beat fires both moves, waits at least beatMs, then polls to idle (6 s cap).
//   * emote / flourish: an opening salute or a victory dance takes as long as it takes; the match does not
//     move on until the arms are idle again (60 s cap -- SAMURAI_FINISH alone is 10.4 s of trajectory plus
//     its ease-in, its hold and its return).
// waitIdle() also tolerates the lag between posting a job and the arms actually starting: it waits out a
// short grace period for "busy" to appear before it will believe an idle reading.
//
// ArmBridge contract with server.py (everything that drives metal is a job: the POST returns a job id and
// the bridge watches GET /api/job?id=... for its phase and steps):
//   GET  /api/status                        -> { armA, armB, gantry: {...}, ready: { ok, missing, gantry } }
//   POST /api/prepare                       -> home the gantry if needed, carriages apart, both arms to rest
//   POST /api/charge   /  /api/retreat      -> carriages to the together stop / back out to the apart stop
//   POST /api/exchange {ours:[], theirs:[]} -> compiles CHAIN_A / CHAIN_B (sim/chain.py) and plays both;
//                                              the job carries `beats`, the compiler's real beat boundaries
//   POST /api/play {side:'a'|'b', move, scale} -> single move fallback (daemon /play, blocking on the arm side)
//   POST /api/emote {scene, swap}           -> two-arm emote scene, carriage channel included
//   POST /api/home                          -> both arms ease back to REST
//   POST /api/abort                         -> IMMEDIATE: every arm stops, the gantry is reset (and unreferenced)

import { control as hostControl } from '../game/hostctl.js';
import * as settings from '../game/settings.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

// A live beat is NOT the move library's nominal 1.4 s. That 1.4 s is only the trajectory's share of a
// /play: the daemon also eases to rest, eases into the first key, HOLDS the last pose for 1.5 s and eases
// back to rest at 60 deg/s. ATTACK_HIGH is 1.26 s of trajectory inside about 4.5 s of busy; FEINT_HIGH is
// 5.5 s. Pacing the screen at 1.4 s would put the picture three beats ahead of the metal by the end of a
// turn. So server.py computes the real schedule off motions_tuned.json (or off the compiler's own beat
// boundaries when the chains were compiled) and the exchange job carries it in `beats` / `lead` / `tail`;
// everything below just consumes it. 1.4 s survives only as the last-resort fallback.
const BEAT_MARGIN_MS = 250;     // the screen lands each beat this far BEHIND the metal, never ahead
const NOMINAL_BEAT_MS = 1400;

/** Does any arm in a /api/status payload still report busy?
 *
 *  server.py flattens the single two-arm daemon for us: `armA` and `armB` are that daemon's own
 *  `arms.A` / `arms.B` entries ({busy, last, torque, pose, model}), or `{offline: true}` when the daemon is
 *  unreachable or does not report that arm. The older nested shape (a daemon status carrying its own
 *  `arms` map) is still understood, so a second standalone daemon on another port keeps working. */
export function armsBusy(status) {
  if (!status) return false;
  for (const key of ['armA', 'armB']) {
    const d = status[key];
    if (!d || d.offline) continue;
    if (d.busy) return true;                                                   // the flattened arm entry
    for (const arm of Object.values(d.arms || {})) if (arm && arm.busy) return true;   // a whole daemon status
  }
  return false;
}
/** True when at least one arm is actually answering. */
export function armsPresent(status) { return !!status && ['armA', 'armB'].some(k => status[k] && !status[k].offline); }
/** Which arms the daemon does NOT report. A live fight needs both. */
export function armsMissing(status) {
  if (!status) return ['A', 'B'];
  if (status.ready && Array.isArray(status.ready.missing)) return [...status.ready.missing];
  return ['A', 'B'].filter(k => !status['arm' + k] || status['arm' + k].offline);
}
/** A sentence for the gantry state, for the host drawer. */
export function gantryWord(g) {
  if (!g || g.offline) return 'no gantry';
  if (!g.connected) return 'not connected';
  if (!g.homed) return 'connected, NOT referenced';
  const at = (g.x != null && g.y != null) ? ` X=${Math.round(g.x)} Y=${Math.round(g.y)}` : '';
  return `${g.busy ? 'busy' : (g.state || 'Idle')}${at}`;
}

export class SimBridge {
  // In sim the timer IS the truth, so every one of its waits runs on the host clock (src/game/hostctl.js):
  // Pause freezes the beat where it stands and Skip animation resolves the pending wait immediately. The
  // beat length itself is a host setting (Host Controls -> Settings -> Beat length), 1.0 to 2.5 s.
  constructor({ beatMs = null, control = hostControl } = {}) {
    this.control = control;
    this.beatMs = beatMs || settings.beatMs();
    this.mode = 'sim'; this.live = false;
    this.lastStatus = null; this.note = ''; this.prepared = false;
  }
  /** The sim's own sleep: pausable, and cut short by Skip animation. */
  nap(ms) { return this.control.sleep(ms); }
  async status() { return { armA: { offline: true }, armB: { offline: true } }; }
  /** Go / no-go for starting a fight. The sim is always ready. */
  preflight() { return { ok: true, missing: [], live: false, message: '' }; }
  async prepare() {}
  /** The charge and the return: on hardware these drive the two carriages. Nothing to do in sim. */
  async charge() {}
  async retreat() {}
  async abort() {}
  /** Called once per turn with both chains (arrays of hw move names, 3 each) BEFORE the exchange animates. */
  async startExchange(/* movesA, movesB */) {}
  /** Called at the start of each beat; resolves when the beat's time is up. */
  async beat(/* index, moveA, moveB */) { await this.nap(this.beatMs); }
  /** How long beat `i` of this turn lasts, in ms. In sim every beat is the host's beat-length setting. */
  beatMsFor(/* i */) { return this.beatMs; }
  /** Where in beat `i` the blow lands, as a fraction. null = use the screen's own default (stage.IMPACT). */
  impactAtFor(/* i */) { return null; }
  async returnHome() {}
  /** Arms the force watch dropped (they went limp and need a human reset). Sim: none. */
  async limpArms() { return []; }
  async recover() {}
  /** The simple duel's pass for one beat: carriages apart -> charge in with both moves playing -> arms
   *  disentangle and rest -> carriages apart. Returns { started, done }: `started` resolves when the pass is
   *  about to leave the apart stop (on hardware: the pair is compiled), `done` when the arms and carriages
   *  are back where they began. Sim: nothing to drive, so both are timers. */
  beatCycle(index, movesA, movesB) { const n = Math.max(1, (movesA || []).length); void index; void movesB; return { started: Promise.resolve(null), done: this.nap(this.beatMs * n + 600) }; }
  /** How many beats one pass of the simple duel plays before the carriages back out (arm/turn_profile.json). Sim: all three. */
  passBeats() { return 3; }
  /** The winner's flourish after the knockout. Sim: a short pause so the beat lands. */
  async flourish(/* side, name */) { await this.nap(600); }
  /** Two-arm emote scene (openers, hits, gloats, finales, idle -- see robot-jousting/sim/emotes/).
   *  `scene` is the scene name, e.g. 'EN_GARDE_OPENER'. `swap` puts arm A's part on arm B and vice versa,
   *  so the winner's choreography can go to whichever arm actually won. Sim: nothing to drive, so a nominal
   *  pause -- the caller may await this, and the screen's own scene runs alongside it. */
  async emote(scene, { swap = false } = {}) { void scene; void swap; await this.nap(2000); }
}

export class ArmBridge extends SimBridge {
  // Live mode ignores the host's beat-length setting (the move library's BEAT is 1.4 s and the metal does
  // not negotiate) and it never sleeps on the host clock: Skip animation stops the SCREEN, the arms finish
  // the motion they are in. Pause still applies between beats, where match.js gates.
  constructor(opts = {}) {
    super({ ...opts, beatMs: NOMINAL_BEAT_MS });
    this.mode = 'live'; this.live = false; this.base = opts.base || '';
    this.pending = null; this.t0 = 0; this.chainLen = 0; this.pollMs = opts.pollMs || 150;
    this.beats = null;                    // this turn's real beat boundaries, in seconds, from the server
    this.lead = 0; this.tail = 0; this.beatSource = '';
    this.prepareMs = opts.prepareMs || 360000;   // a GRBL reference sweep is two axes at 150 mm/min
    this.gantryMs = opts.gantryMs || 60000;
    this.compileMs = opts.compileMs || 120000;   // sim/chain.py builds a pair in about 9 s on this machine
    this._subs = new Set();
  }
  /** The host drawer subscribes so it can show progress without polling the bridge. */
  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  emit() { for (const fn of this._subs) { try { fn(this); } catch (e) { console.warn(e); } } }

  async api(path, body) {
    const r = await fetch(this.base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }
  async status() {
    // Live as soon as EITHER arm answers: one daemon serves both, and a single missing arm must not put the
    // whole show back into sim -- but `preflight()` still refuses to START a fight until both are there.
    try { const s = await this.api('/api/status'); this.live = armsPresent(s); this.lastStatus = s; this.emit(); return s; }
    catch (e) {
      this.live = false;
      this.lastStatus = { armA: { offline: true, error: String(e) }, armB: { offline: true } };
      this.emit(); return this.lastStatus;
    }
  }
  /** The gantry slice of the last status we saw. */
  gantry() { return (this.lastStatus && this.lastStatus.gantry) || { offline: true }; }
  /** Go / no-go for a LIVE fight, read off the last /api/status. A missing arm is a refusal: half a duel on
   *  real metal is one arm swinging at nothing. An unreferenced gantry is not -- that is what prepare is for. */
  preflight(status = null) {
    const s = status || this.lastStatus;
    const missing = armsMissing(s);
    const live = armsPresent(s);
    if (!live) return { ok: false, missing, live, message: 'The arm daemon is not answering. Nothing is plugged in, or it is not running.' };
    if (missing.length) return { ok: false, missing, live, message: `Arm ${missing.join(' and ')} is not connected. A live fight needs both.` };
    return { ok: true, missing: [], live, gantry: this.gantry(), message: '' };
  }

  /** Poll /api/status until no arm is busy. `grace` is how long to keep believing a job is still spinning up
   *  before an idle reading counts. Returns true if the arms went idle, false on the timeout (in which case
   *  the caller carries on: a stuck daemon must never freeze the show in front of an audience). */
  async waitIdle(timeout = 8000, { grace = 700 } = {}) {
    if (!this.live) return true;
    const t0 = performance.now(); let sawBusy = false;
    while (performance.now() - t0 < timeout) {
      let busy = false;
      try { busy = armsBusy(await this.api('/api/status')); } catch (e) { return false; }
      if (busy) sawBusy = true;
      else if (sawBusy || performance.now() - t0 > grace) return true;
      await wait(this.pollMs);
    }
    console.warn('arms still busy after', timeout, 'ms: continuing anyway');
    return false;
  }
  /** Poll until the gantry is Idle again. A scene that carries a carriage channel is not over when the arms
   *  stop: the streamed G1 blocks are still draining out of GRBL's planner. While the gantry holds its own
   *  lock the daemon answers the SHORT status shape ({connected, homed, busy:true}) with no state, so busy
   *  and unreadable look alike -- both mean keep waiting. Returns true if it settled. */
  async waitGantryIdle(timeout = 30000) {
    if (!this.live) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      let g = null;
      try { g = (await this.api('/api/status')).gantry; } catch (e) { return false; }
      if (!g || g.offline || !g.connected) return true;             // nothing to wait for
      if (!g.busy && (g.state == null || g.state === 'Idle')) return true;
      await wait(this.pollMs);
    }
    console.warn('gantry still moving after', timeout, 'ms: continuing anyway');
    return false;
  }
  /** Wait until the exchange job says beat `index` has actually finished on both arms. Only the per-beat
   *  path can answer this (a compiled chain is one motion with no per-beat boundary the daemon can report),
   *  and it is exact there: the server counts a beat off the moment its blocking /play pair returns. */
  async waitBeatDone(index, timeout = 30000) {
    if (!this.live || !this.pending) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      let job = null;
      try { job = await this.api('/api/job?id=' + encodeURIComponent(this.pending)); } catch (e) { return false; }
      if (!job) return false;
      if (Number(job.done_beats || 0) > index) return true;
      if (job.status && job.status !== 'running') return true;   // finished or failed: stop waiting on it
      await wait(this.pollMs);
    }
    console.warn('beat', index + 1, 'never reported done: continuing anyway');
    return false;
  }
  /** Watch one server job until it finishes, or until `until(job)` says we have seen enough (the exchange
   *  only needs to know that the chains are compiled and the arms have started). Never throws. */
  async waitJob(id, { timeout = 60000, until = null, onStep = null } = {}) {
    const t0 = performance.now(); let seen = 0; let job = null;
    while (performance.now() - t0 < timeout) {
      try { job = await this.api('/api/job?id=' + encodeURIComponent(id)); }
      catch (e) { await wait(this.pollMs); continue; }
      const steps = Array.isArray(job && job.steps) ? job.steps : [];
      if (steps.length > seen) {
        for (const s of steps.slice(seen)) { this.note = s.note || s.phase; try { onStep?.(s); } catch (e) {} }
        seen = steps.length; this.emit();
      }
      if (job && job.status && job.status !== 'running') return job;
      if (until && job && until(job)) return job;
      await wait(this.pollMs);
    }
    console.warn('job', id, 'still running after', timeout, 'ms: continuing anyway');
    return job || { id, status: 'timeout' };
  }
  /** POST something that returns a job, then watch it. */
  async job(path, body = {}, opts = {}) {
    if (!this.live) return { status: 'sim' };
    let r = null;
    try { r = await this.api(path, body); } catch (e) { console.warn(path, 'failed', e); return { status: 'failed', result: String(e) }; }
    if (!r || !r.job) { console.warn(path, 'was not queued', r); return { status: 'failed', result: r && r.error }; }
    return this.waitJob(r.job, opts);
  }

  /** Before the first turn: reference the gantry if it is not referenced, drive the carriages apart, both
   *  arms to rest. Minutes, not seconds, so the host drawer shows every step as it lands. */
  async prepare() {
    await this.status();
    if (!this.live) return;
    this.note = 'preparing the hardware...'; this.emit();
    await this.loadProfile();
    const job = await this.job('/api/prepare', {}, { timeout: this.prepareMs });
    this.prepared = job.status === 'done';
    if (!this.prepared) { this.note = 'prepare did not finish: ' + (job.result || job.status); console.warn(this.note); }
    await this.status();
    return job;
  }
  /** The charge: both carriages ride in to the 19.5 in stop. Started with the screen's charge animation.
   *  Never while an arm is still moving -- `together` is the one direction that can put metal into metal,
   *  and an opening scene that is still finishing would be extended right where the rails close. */
  async charge() {
    await this.waitIdle(20000, { grace: 200 });
    return this.job('/api/charge', {}, { timeout: this.gantryMs });
  }
  /** The return: both carriages back out to the apart stop, clear of each other.
   *  Also waits for the arms first. A knockout breaks the beat loop early -- the winning blow lands on beat
   *  2 and the loop stops -- so the arms can still be part-way through the chain when this is called.
   *  Apart is the safe direction, but pulling the rail out from under a swing still changes the geometry the
   *  move was tuned in. Observed doing exactly that in a live run before this wait was added. */
  async retreat() {
    await this.waitIdle(20000, { grace: 200 });
    return this.job('/api/retreat', {}, { timeout: this.gantryMs });
  }
  /** The big red button. Immediate, not a job: it must answer while everything else is blocked. */
  async abort() {
    this.pending = null; this.beats = null; this.prepared = false;
    try { const r = await this.api('/api/abort', {}); this.note = r.note || 'aborted'; this.emit(); return r; }
    catch (e) { this.note = 'abort failed: ' + e; this.emit(); return { error: String(e) }; }
  }

  /** The stretch of the turn's clock the SCREEN actually has for beat `i`: from where beat i-1 released to
   *  where beat i releases.
   *
   *  Not `beat.start` to `beat.end`. A compiled plan merges the two arms' beats (min start, max end), so a
   *  beat's own `start` can sit BEFORE the previous beat's `end` -- a real turn came out with beat 3 running
   *  3.162 to 5.412 while beat 2 ended at 3.812. Sizing the animation at end-start would then hand beat 3 a
   *  2.25 s timeline to play inside the 1.60 s the screen really has, and the next beat would cut it off. */
  beatWindow(i) {
    const b = this.beats && this.beats[i];
    if (!b) return null;
    const prev = i > 0 ? this.beats[i - 1] : null;
    const from = prev ? Math.min(prev.end, b.end) : b.start;
    return { from, to: b.end, pinned: b.pinned_at };
  }
  /** How long beat `i` really lasts, in ms: the server's schedule when we have it, the nominal beat if not. */
  beatMsFor(i) {
    const w = this.beatWindow(i);
    if (!w) return this.beatMs;
    return Math.max(200, (w.to - w.from) * 1000);
  }
  /** Where in beat `i` the blow lands, as a fraction of that window. The compiler pins an attack's impact and
   *  a block's guard; on the per-beat path it is the end of the trajectory, before the daemon's hold. Sizing
   *  the beat to 4.5 s but leaving the screen's impact at 0.7 of it would land the picture 1.5 s late. */
  impactAtFor(i) {
    const w = this.beatWindow(i);
    if (!w || w.pinned == null || !(w.to > w.from)) return null;
    return Math.min(0.95, Math.max(0.08, (w.pinned - w.from) / (w.to - w.from)));
  }
  /** The whole turn's motion, in ms: what the screen is committing to before the first beat. */
  turnMs() { return this.beats && this.beats.length ? this.beats[this.beats.length - 1].end * 1000 : 0; }

  async startExchange(movesA, movesB) {
    this.pending = null; this.beats = null; this.lead = 0; this.tail = 0; this.beatSource = '';
    this.chainLen = Math.max(movesA?.length || 0, movesB?.length || 0); this.t0 = performance.now();
    if (!this.live) return;
    // One request per turn: the server compiles both chains together (so their beats line up and the pair is
    // collision-checked) and streams them to both arms in sync. The compile is the slow part, so the screen's
    // beat clock does not start until the job says it has moved on to `playing`.
    let r = null;
    try { r = await this.api('/api/exchange', { ours: movesA, theirs: movesB }); }
    catch (e) { console.warn('exchange failed, falling back to per-beat play', e); return; }
    if (!r || !r.job) { console.warn('exchange was not queued', r); return; }
    const job = await this.waitJob(r.job, { timeout: this.compileMs, until: j => j.phase === 'playing' });
    if (job.status === 'failed') { console.warn('exchange failed:', job.result); return; }
    this.pending = r.job;
    this.beats = Array.isArray(job.beats) && job.beats.length ? job.beats : null;
    this.lead = Number(job.lead) || 0; this.tail = Number(job.tail) || 0;
    this.beatSource = job.source || (this.beats ? 'plan' : 'nominal');
    // The daemon eases from rest into the first key BEFORE the trajectory's own clock starts, so the screen's
    // clock starts there too -- `lead` is that ease, measured off the real poses by server.py, not guessed.
    this.t0 = performance.now() + this.lead * 1000;
    if (this.beats) {
      console.info(`live turn: ${this.beats.length} beats, ${(this.turnMs() / 1000).toFixed(2)} s of motion`
        + ` (${this.beatSource}), lead ${this.lead.toFixed(2)} s:`,
        this.beats.map((b, i) => `${i + 1}: ${(this.beatMsFor(i) / 1000).toFixed(2)}s`).join('  '));
    } else {
      console.warn('live turn: no beat schedule from the server, falling back to the nominal 1.4 s beat');
    }
  }
  async beat(index, moveA, moveB) {
    if (!this.live) { await this.nap(this.beatMs); return; }   // live mode with no daemon answering: sim rules
    if (this.pending) {
      // ONE clock for the whole turn, so beat 3 still lines up after two beats of jitter instead of drifting
      // the way three independent sleeps would -- and every boundary is absolute, so the safety margin does
      // not accumulate. The schedule is the compiler's own beat boundaries when the chains were compiled
      // (it stretches a beat whose connector will not fit in 1.4 s) and the measured per-move totals
      // otherwise. Either way the screen lands BEAT_MARGIN_MS behind the metal, never in front of it.
      const plan = this.beats && this.beats[index];
      const due = this.t0 + (plan ? plan.end * 1000 : (index + 1) * this.beatMs) + BEAT_MARGIN_MS;
      await wait(Math.max(0, due - performance.now()));
      // A schedule is a MODEL, and metal is always a little slower than the model (the daemon's ease loop
      // accumulates its sleeps, servos lag, friction). Measured against the mock, the schedule alone
      // released beat 1 about 400 ms EARLY. So wherever the server can tell us a beat is really finished,
      // that is the authority and the schedule only sizes the animation.
      const last = index >= this.chainLen - 1;
      if (this.beatSource === 'per-beat') {
        // Each beat is its own blocking /play pair, and the job counts them off as they land. Do NOT use
        // waitIdle here: the three beats are fired back to back, so a global busy flag either misses the
        // gap between them or swallows the whole turn in the first wait.
        await this.waitBeatDone(index, 30000);
      }
      if (last) {
        // The last beat still has the daemon's hold and its return to rest to come, on either path.
        await this.waitIdle(Math.max(12000, this.tail * 1000 + 8000));
      }
      return;
    }
    // fallback path: fire single moves, then wait for the daemon's ease-in/motion/ease-out to actually end
    const t = performance.now();
    this.api('/api/play', { side: 'a', move: moveA }).catch(() => {});
    this.api('/api/play', { side: 'b', move: moveB }).catch(() => {});
    await wait(Math.max(0, this.beatMs - (performance.now() - t)));
    await this.waitIdle(6000);
  }
  /** One pass of the simple duel on the metal: POST /api/beat_cycle (server.py compiles this beat's pair with
   *  its calibrated stop, parks the carriages apart if they are not, then runs the daemon's turn routine with
   *  the arms starting as the charge begins and the carriages backing out after). `started` resolves at the
   *  job's `charging` step, with the compiled pair's beat schedule loaded so beatMsFor(0) / impactAtFor(0)
   *  size the screen's beat; `done` when the job has finished and both arms and the gantry are idle. */
  /** Which arms report `limp` in /api/status: the force watch dropped their torque mid-strike. The fight must not go
   *  on until a person has reset them and pressed Continue (then recover()). */
  async limpArms() {
    if (!this.live) return [];
    const s = await this.status(); const out = [];
    for (const k of ['A', 'B']) { const d = s['arm' + k]; if (d && !d.offline && d.limp) out.push({ arm: k, ...d.limp }); }
    return out;
  }
  /** Torque back on, both arms to rest, carriages apart. A job; waits for it. */
  async recover() {
    if (!this.live) return;
    this.note = 'recovering the arms...'; this.emit();
    const job = await this.job('/api/recover', {}, { timeout: 180000 });
    await this.status(); return job;
  }
  /** The turn profile (arm/turn_profile.json via GET /api/profile): scale, beats per pass, and the rest of the
   *  pass shape. Fetched at prepare() and before each pass so an edit in the studio applies to the next pass. */
  async loadProfile() { try { this.profile = await this.api('/api/profile'); } catch (e) { this.profile = this.profile || {}; } return this.profile; }
  passBeats() { const n = Number(this.profile && this.profile.beats_per_pass); return n >= 1 ? Math.min(3, Math.round(n)) : 3; }
  beatCycle(index, movesA, movesB) {
    this.pending = null; this.beats = null; this.lead = 0; this.tail = 0; this.beatSource = ''; this.chainLen = (movesA || []).length || 1;
    if (!this.live) return { started: Promise.resolve(null), done: this.nap(this.beatMs * this.chainLen + 600) };
    let resolveStart; const started = new Promise(res => { resolveStart = res; });
    const done = (async () => {
      let r = null;
      await this.loadProfile();
      try { r = await this.api('/api/beat_cycle', { ours: movesA, theirs: movesB }); }   // scale and the pass shape come from the profile
      catch (e) { console.warn('beat cycle failed', e); resolveStart(null); return null; }
      if (!r || !r.job) { console.warn('beat cycle was not queued', r); resolveStart(null); return r; }
      const job = await this.waitJob(r.job, { timeout: this.compileMs, until: j => j.phase === 'charging' });
      this.beats = Array.isArray(job.beats) && job.beats.length ? job.beats : null;
      this.beatSource = job.source || (this.beats ? 'plan' : 'nominal');
      if (job.collision_warning) console.warn('beat', index + 1, job.collision_warning);
      resolveStart(job);
      if (job.status && job.status !== 'running') { if (job.status === 'failed') console.warn('beat cycle failed:', job.result); return job; }
      const end = await this.waitJob(r.job, { timeout: 240000 });
      if (end.status === 'failed') console.warn('beat cycle failed:', end.result);
      await this.waitIdle(15000, { grace: 300 });
      await this.waitGantryIdle(30000);
      return end;
    })();
    return { started, done };
  }
  /** Let whatever is running finish before asking for rest: the daemon refuses /rest on a busy arm. */
  async returnHome() {
    if (!this.live) return;
    await this.waitIdle(8000);
    await this.api('/api/home', {}).catch(() => {});
    this.pending = null; this.beats = null;
  }
  /** The winner's flourish: nothing to send (the finale scene carries the choreography), but do not let the
   *  match move on while the last beat is still playing out on the metal. */
  async flourish(side, name) { void side; void name; await this.waitIdle(8000, { grace: 300 }); }
  /** Fire a two-arm emote scene at the daemon and WAIT for it. A real salute or victory dance is seconds of
   *  motion -- and on the scenes that carry a carriage channel it is the carriages moving too -- so the game
   *  holds until the arms are idle again and the pose actually reads. Never throws: a missing daemon must
   *  not stop the match animating. */
  async emote(scene, { swap = false } = {}) {
    if (!this.live || !scene) return;
    try { await this.api('/api/emote', { scene, swap }); } catch (e) { console.warn('emote failed', e); return; }
    // A scene takes as long as it takes -- EN_GARDE_OPENER is 5.9 s of trajectory inside ~9.3 s of busy,
    // SAMURAI_FINISH 10.4 s inside ~13 s -- and the game must not reach Marla or the result screen until it
    // is over. Never a timer: the arms' busy flags first, then the gantry, because a scene that carries a
    // carriage channel is still moving after the arms have stopped.
    await this.waitIdle(90000, { grace: 1500 });
    await this.waitGantryIdle(30000);
  }
}

export async function createBridge(mode) {
  if (mode === 'live') { const b = new ArmBridge(); await b.status(); return b; }
  return new SimBridge();
}
