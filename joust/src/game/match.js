// One fight: decks, hands, the turn loop (plan, charge, exchange beat by beat, return), and the
// orchestration of stage / table / dialogue / bridge / audio around the pure rules.
import { card, REST, STAGGER, STARTER_DECK, COUNTER_ID, HAND_SIZE, ENERGY_PER_TURN, BEATS_PER_TURN } from './cards.js';
import { resolveBeat, emptyStatus } from './rules.js';
import { chooseChain, tellFor } from './ai.js';
import { MARLA, pick } from './script.js';
import { IMPACT, SCENES } from '../ui/stage.js';
import { sfx, music } from '../audio/audio.js';
import { control as hostControl, ABORT } from './hostctl.js';
import * as settings from './settings.js';

/** Thrown inside the turn loop when the host ends, restarts or abandons the fight from the drawer. */
export class FightEnded extends Error { constructor(how) { super('fight ended: ' + how); this.how = how; } }
const REVEAL_GAP = 220;    // the animation ends -> both cards of the beat turn over together
const OUTCOME_GAP = 420;   // the outcome word sits for a moment before the next beat starts
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Which opening scene (src/ui/stage.js SCENES, named as in robot-jousting/docs/emotes_brainstorm.md) fits
// which opponent, and who plays the A role: [scene, swap]. swap = true means the OPPONENT is A.
// Bluebell is nervous or impatient, Percival stands on ceremony, the Champion makes an entrance.
const OPENERS = {
  squire: [['COCKY_VS_NERVOUS', false], ['COCKY_VS_NERVOUS', false], ['IMPATIENT', true], ['IMPATIENT', true], ['GLOVE_TOUCH', false], ['CIRCLING', false]],
  percival: [['SALUTE_FORMAL', false], ['SALUTE_FORMAL', false], ['OLD_RIVALS', false], ['OLD_RIVALS', false], ['GLOVE_TOUCH', true], ['CIRCLING', true], ['STAREDOWN', true]],
  champion: [['CHAMPION_ENTRANCE', true], ['CHAMPION_ENTRANCE', true], ['STAREDOWN', false], ['STAREDOWN', false], ['OLD_RIVALS', true]],
  default: [['SALUTE_FORMAL', false], ['STAREDOWN', false], ['CIRCLING', false]],
};
// Which finale, by the character who is about to mope. The winner's dance is the scene; the loser's mope
// is picked separately by name (stage.MOPES), so the Champion always powers down and Bluebell always weeps.
const FINALES = {
  won: {   // the player won: the opponent mopes
    squire: ['SORE_LOSER', 'SORE_LOSER', 'VICTORY_VS_DEFEAT'],
    percival: ['SLOW_CLAP', 'SLOW_CLAP', 'VICTORY_VS_DEFEAT', 'GRACIOUS_WIN'],
    champion: ['VICTORY_VS_DEFEAT', 'VICTORY_VS_DEFEAT', 'GRACIOUS_WIN'],
    default: ['VICTORY_VS_DEFEAT'],
  },
  lost: {   // the player lost: Lionheart mopes, and the winner's manners decide the scene
    squire: ['VICTORY_VS_DEFEAT', 'VICTORY_VS_DEFEAT', 'GRACIOUS_WIN'],
    percival: ['SLOW_CLAP', 'SLOW_CLAP', 'GRACIOUS_WIN'],
    champion: ['GRACIOUS_WIN', 'VICTORY_VS_DEFEAT'],
    default: ['VICTORY_VS_DEFEAT'],
  },
};

/** Draw pile, discard pile and a PERSISTENT hand: what you do not play stays in your hand, you draw back up
 *  to HAND_SIZE at the start of a turn, and anything over HAND_SIZE at the end of the turn is discarded at
 *  random. The counter id is a resource, not a deck card: it never counts toward the size and never lands in
 *  a discard pile. */
export class Deck {
  constructor(ids) { this.draw = shuffle([...ids]); this.discard = []; this.hand = []; }
  count() { return this.hand.filter(id => id !== COUNTER_ID).length; }
  /** Draw until the hand holds `n` deck cards (reshuffling the discard pile when the draw pile runs dry). */
  drawTo(n) { let guard = 0; while (this.count() < n && guard++ < 80) { if (!this.draw.length) { if (!this.discard.length) break; this.draw = shuffle(this.discard); this.discard = []; } this.hand.push(this.draw.pop()); } return this.hand; }
  spend(ids) { for (const id of ids) { if (!id) continue; const k = this.hand.indexOf(id); if (k >= 0) { this.hand.splice(k, 1); if (id !== COUNTER_ID) this.discard.push(id); } } }
  /** End of turn: trim a hand over `n` by discarding random cards. Returns what was dropped. */
  trimTo(n) {
    const out = []; let guard = 0;
    while (this.count() > n && guard++ < 80) {
      const pool = this.hand.map((id, i) => ({ id, i })).filter(o => o.id !== COUNTER_ID);
      const p = pool[Math.floor(Math.random() * pool.length)];
      this.hand.splice(p.i, 1); this.discard.push(p.id); out.push(p.id);
    }
    return out;
  }
  /** The counter is in the hand exactly while the side is holding one. A spent counter leaves the hand. */
  offerCounter(has) { const k = this.hand.indexOf(COUNTER_ID); if (has && k < 0) this.hand.push(COUNTER_ID); else if (!has && k >= 0) this.hand.splice(k, 1); }
  /** The three piles, for the host snapshot (src/net/snapshot.js). */
  snapshot() { return { draw: [...this.draw], discard: [...this.discard], hand: [...this.hand] }; }
  /** Rebuild a deck exactly as it was: no reshuffle, so a resumed planning phase deals nobody a new card. */
  static from(o) { const d = new Deck([]); d.draw = [...(o?.draw || [])]; d.discard = [...(o?.discard || [])]; d.hand = [...(o?.hand || [])]; return d; }
}

export class Match {
  constructor({ stage, battle, dialogue, bridge, player, opponent, playerDeck, counters = 0, tutorial = false, ext = {}, poses = {},
                mode = 'campaign', controllers = null, onPhase = null, control = hostControl, resume = null }) {
    Object.assign(this, { stage, battle, dialogue, bridge, player, opponent, tutorial });
    // The player-controller seam. A controller decides one side's three beats:
    //   { name, tell, planTurn(view) -> Promise<chain of up to BEATS_PER_TURN card ids or nulls> }
    // Campaign: side a is the card table (battle.planTurn) and side b is chooseChain, both inline in
    // playTurn. Phone duel (mode 'mp'): both sides are Remote controllers from src/net/mphost.js, this
    // screen shows no card table and no tell, and onPhase publishes the view to the two phones.
    this.mode = mode; this.controllers = controllers; this.onPhase = onPhase;
    this.outcome = '';   // the word for the beat being animated, shown when its cards turn over
    this.poses = { opener: poses.opener || null, finale: poses.finale || null };   // the player's picks for this fight; null = none
    this.ext = ext; this.music = ext.music || music; this.crowd = ext.crowd || null;
    this.who = { squire: 'squire', knight: 'percival', champion: 'champion' }[opponent.id] || opponent.id;
    this.deck = { a: new Deck(playerDeck), b: new Deck(opponent.deck) };
    this.hp = { a: player.hp, b: opponent.hp }; this.max = { a: player.hp, b: opponent.hp };
    this.st = { a: emptyStatus(), b: emptyStatus() };
    // every fight starts with a dead rail and whatever counters each side brought to it
    this.st.a.voltage = 0; this.st.b.voltage = 0;
    this.st.a.counter = counters; this.st.b.counter = opponent.counters || 0;
    this.turn = 0; this.lastChain = { a: [], b: [] }; this.lowHpSaid = { a: false, b: false };
    this.beatMs = bridge.beatMs;

    // ---- host controls ----------------------------------------------------------------------------------
    // Every wait in this file goes through the shared clock, so Pause freezes the fight where it stands and
    // Skip cuts the current animation short. `forced` is how the drawer ends a fight from outside the loop.
    this.control = control;
    this.forced = null;                     // null | 'a' | 'b' | 'draw' | 'restart' | 'quit'
    this.over = false;                      // the fight is finished (however it finished)
    this.ended = null;                      // 'win' | 'loss' | 'draw' | 'restart' | 'quit', read by the callers
    this._abort = new Promise(res => { this._abortRes = res; });
    this.planSecs = Math.max(0, Number(settings.get('planTimer')) || 0);   // 0 = no plan timer
    this.showTells = settings.get('tells') !== false;
    this.chatter = settings.get('chatter') !== false;
    this.planLeft = null;                   // seconds left in the planning phase, or null
    this.onTimer = null;                    // (left, total) -> the phone host republishes the countdown
    this.phaseNow = 'idle';                 // 'plan' | 'exchange' | 'finish', for the snapshot's resume point
    // A fight rebuilt from a host snapshot: the same hands, the same piles, the same turn number.
    this.resume = resume ? { ...resume } : null;
    if (this.resume) this.hydrate(this.resume);
  }

  // ---- pause / skip / end, all driven from the Host Controls drawer ---------------------------------------
  /** Sleep on the host clock: a pause banks the remaining time, a skip cuts it short. */
  wait(ms, opts) { return this.control.sleep(ms, opts); }
  /** Block here while the host has the fight paused. Called between beats and at every phase boundary. */
  hold() { return this.control.gate(); }
  /** Race a long await against the drawer's End / Restart / Back to title, so nothing can wedge the loop. */
  async g(p) {
    const r = await Promise.race([Promise.resolve(p), this._abort]);
    if (r === ABORT || this.forced) throw new FightEnded(this.forced || 'quit');
    return r;
  }
  /** End the fight from outside the loop. `how` is 'a' | 'b' | 'draw' | 'restart' | 'quit'. */
  finishNow(how) {
    if (this.over || this.forced) return;
    this.forced = how;
    this.control.setPaused(false);          // a paused fight must still be endable
    this._abortRes(ABORT);
    try { this.battle.setTimer(null); } catch (e) {}
    try { this.battle.lock?.(); } catch (e) {}        // free the card table if it is waiting on the player
    try { this.controllers && Object.values(this.controllers).forEach(c => c.cancel?.()); } catch (e) {}
  }

  /** Rebuild the mutable half of a fight from a snapshot (see src/net/snapshot.js). */
  hydrate(s) {
    if (s.hp) this.hp = { ...s.hp };
    if (s.max) this.max = { ...s.max };
    if (s.st) this.st = { a: { ...s.st.a }, b: { ...s.st.b } };
    if (s.decks) for (const side of ['a', 'b']) if (s.decks[side]) this.deck[side] = Deck.from(s.decks[side]);
    if (s.lastChain) this.lastChain = { a: [...(s.lastChain.a || [])], b: [...(s.lastChain.b || [])] };
    if (s.lowHpSaid) this.lowHpSaid = { ...s.lowHpSaid };
    this.turn = Number(s.turn) || 0;
  }
  /** Everything a reloaded big screen needs to carry this fight on. `phase` says where to pick it up:
   *  'plan' restarts the planning phase with these hands, 'exchange' replays the turn from its first beat. */
  snapshot() {
    return {
      phase: this.phaseNow, turn: this.turn,
      hp: { ...this.hp }, max: { ...this.max },
      st: { a: { ...this.st.a }, b: { ...this.st.b } },
      decks: { a: this.deck.a.snapshot(), b: this.deck.b.snapshot() },
      lastChain: { a: [...(this.lastChain.a || [])], b: [...(this.lastChain.b || [])] },
      lowHpSaid: { ...this.lowHpSaid },
      chains: this.phaseNow === 'exchange' ? { a: [...(this.lastChain.a || [])], b: [...(this.lastChain.b || [])] } : null,
    };
  }

  // ---- optional engines (see main.js): every call is guarded so a missing module never breaks a fight ----
  /** Counters this side still holds: main.js carries the player's number on to the next fight. */
  countersLeft(side = 'a') { return this.st[side].counter; }
  crowdOn() { return !!this.crowd && (this.ext.crowdOn ? this.ext.crowdOn() : true); }
  react(kind, intensity = 1) { if (this.crowdOn()) try { this.crowd.react(kind, intensity); } catch (e) {} }   // crowd off: the music is the ambience
  energy(v) { if (this.crowdOn()) try { this.crowd.setEnergy(v); } catch (e) {} }
  servo(name, opts) { const s = this.ext.servo; if (s?.playMove) try { s.playMove(name, opts); } catch (e) {} }
  oneShot(kind) { const s = this.ext.servo; if (s?.oneShot) try { s.oneShot(kind); } catch (e) {} }
  sting(kind) { try { this.music.sting?.(kind); } catch (e) {} }
  /** Adaptive music: 0 = both fresh, 1 = someone is nearly down. The player's own peril weighs more. */
  tension() { const a = 1 - this.hp.a / this.max.a, b = 1 - this.hp.b / this.max.b; return Math.min(1, Math.max(a, 0.7 * b, 0.55 * (a + b))); }
  pulse() { try { this.music.setIntensity?.(this.tension()); } catch (e) {} }
  /** An in-character line from one fighter: a bubble over its arm plus its voice. At most one per side per beat,
   *  so the cool moments (a feint that worked, a punished feint, a clean hit, a parry) get the line, not the filler. */
  barkSide(side, event, { ms = 2000, chance = 1, delay = 0, cls = '', tier = 1 } = {}) {
    if (Math.random() > chance) return; const b = this.ext.barks; if (!b?.bark) return;
    const who = side === 'a' ? 'lionheart' : this.who, key = this.beatKey || 'free';
    this.barkAt = this.barkAt || {}; if (key !== 'free' && this.barkAt[side] === key) return; this.barkAt[side] = key;
    const go = () => { try {
      const line = b.bark(who, event, { n: this.opponent.round, opp: this.opponent.name, tier }); if (!line) return; this.stage.bark(side, line, ms, cls);
      const v = this.ext.voice; if (v?.say) { this.barkHandles = this.barkHandles || {}; try { this.barkHandles[side]?.stop?.(); } catch (e) {} this.barkHandles[side] = v.say(line, { voice: v.voiceFor?.(who) || v.VOICES?.[who] || v.VOICES?.marla, mood: b.barkMood?.(who, event) || 'neutral', charMs: 26 }); }
    } catch (e) {} };
    if (delay) setTimeout(go, delay); else go();
  }
  bark(event, ms = 2000) { this.barkSide('b', event, { ms }); }
  /** Non-verbal: grunts, ouches, laughs, gasps from a fighter. */
  vocal(side, kind, delay = 0, chance = 1) {
    if (Math.random() > chance) return; const v = this.ext.voice; if (!v?.vocalize) return; const who = side === 'a' ? 'lionheart' : this.who;
    const go = () => { try { v.vocalize(kind, v.voiceFor?.(who) || v.VOICES?.[who]); } catch (e) {} }; if (delay) setTimeout(go, delay); else go();
  }
  herald(event) { const b = this.ext.barks; if (!b?.HERALD) return; try { const vars = { n: this.opponent.round, opp: this.opponent.name }; const line = b.bark ? b.bark('herald', event, vars) : (() => { const l = b.HERALD[event]; const t = Array.isArray(l) ? l[Math.floor(Math.random() * l.length)] : l; return t ? t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : ''; })(); if (line) { this.stage.stamp(line, 'small'); const v = this.ext.voice; if (v?.say) v.say(line, { voice: v.VOICES?.herald, charMs: 24 }); } } catch (e) {} }
  /** The stage owns the choreography; the match owns the words. Scene keys marked say / vox / hrl come back
   *  through here, so a scene can be driven straight from the console and still speak in character. */
  sceneHooks() {
    return {
      onSay: (side, event, ms, cls) => this.barkSide(side, event, { ms: ms || 2200, cls: cls || '' }),
      onVox: (side, kind) => this.vocal(side, kind),
      onHerald: event => this.herald(event),
    };
  }
  /** Tell the host of a phone duel where the fight has got to. A no-op in the campaign.
   *  Kinds: 'plan' | 'exchange' | 'beat' ({i, plannedA, plannedB, playedA, playedB, outcome}) | 'result'. */
  phase(kind, extra = {}) { try { this.onPhase?.(kind, extra, this); } catch (e) { console.warn('onPhase', e); } }
  /** What one side may see while planning. The host publishes exactly this to that side's phone, so the
   *  hand it carries already includes the counter when that side is holding one (Deck.offerCounter). */
  planView(side) {
    return {
      side, hand: [...this.deck[side].hand], energy: ENERGY_PER_TURN, beats: BEATS_PER_TURN, turn: this.turn,
      hp: { ...this.hp }, max: { ...this.max }, status: { a: { ...this.st.a }, b: { ...this.st.b } },
    };
  }
  /** The opening pose, before the first turn: only if the player picked one on the versus screen. The real arms
   *  play it by name (robot-jousting/sim/emotes); the screen joins in only when it has a scene of the same name. */
  async opener() {
    const name = this.poses.opener; if (!name) return;
    const swap = (OPENERS[this.who] || OPENERS.default).find(([n]) => n === name)?.[1] || false;
    // The screen scene and the real arms play the same named scene at the same time, and the first turn
    // does not start until BOTH are done: on hardware ArmBridge.emote polls /api/status until idle.
    const arms = Promise.resolve(this.bridge.emote?.(name, { swap })).catch(() => {});
    const screen = SCENES[name]
      ? this.stage.playScene(name, { swap, ...this.sceneHooks() }).catch(e => { console.warn('opener failed', e); })
      : this.wait(1500);
    // Skip animation during the salute: the screen scene ends where it stands (endScene resolves its promise).
    const off = this.control.onSkip(() => { try { this.stage.endScene(true); } catch (e) {} });
    try { await this.g(Promise.all([arms, screen])); } finally { off(); }
  }
  /** The filler line while you think: a plain nag, or a status taunt once the fight has a shape. */
  planBark() {
    const lead = this.hp.b / this.max.b - this.hp.a / this.max.a;
    const e = this.turn > 1 && lead > 0.2 ? 'taunt_lead' : this.turn > 1 && lead < -0.2 ? 'taunt_behind' : 'plan';
    this.barkSide('b', e, { ms: 2400 });
  }
  /** Patience, escalating: a nudge after 12 s of planning, something ruder at 25 s (and 40 s). */
  planNag() {
    this.planNagStop();
    this.nagTimers = [
      setTimeout(() => this.barkSide('b', 'plan_long', { ms: 2600 }), 12000),
      setTimeout(() => { this.barkSide('b', 'plan_long', { ms: 3000, tier: 2 }); this.vocal('b', Math.random() < 0.5 ? 'sigh' : 'tut'); }, 25000),
      setTimeout(() => { this.barkSide('b', 'plan_long', { ms: 3000, tier: 2 }); this.vocal('b', 'hmph'); }, 40000),
    ];
  }
  planNagStop() { for (const t of this.nagTimers || []) clearTimeout(t); this.nagTimers = []; }

  /** The plan countdown (Host Controls -> Settings -> Plan timer). It ticks on the host clock, so a pause
   *  freezes it, and it is deliberately NOT skippable: Skip animation is about animation.
   *  `onZero` is called once, with the list of sides that never locked -- they get auto-locked with whatever
   *  slots they had, and empty beats simply rest. Returns a stop function. */
  startPlanTimer(onZero) {
    const total = this.planSecs;
    this.planLeft = total || null;
    const paint = left => {
      this.planLeft = left;
      try { this.battle.setTimer(left, total); } catch (e) {}
      try { this.onTimer?.(left, total); } catch (e) {}
    };
    if (!total) { paint(null); return () => {}; }
    let dead = false, left = total;
    paint(left);
    (async () => {
      while (!dead && left > 0) {
        await this.control.sleep(1000, { skippable: false });
        if (dead) return;
        left--; paint(left);
        if (left <= 0 && !dead) { dead = true; try { onZero(); } catch (e) { console.warn('plan timer', e); } }
      }
    })();
    return () => { dead = true; paint(null); };
  }

  async run() {
    const { stage, battle, dialogue } = this;
    const resumed = !!this.resume;
    stage.reset(); battle.setNames(this.player, this.opponent); battle.setBeat(null); battle.setTimer(null);
    for (const s of ['a', 'b']) { battle.setHp(s, this.hp[s], this.max[s]); battle.setStatus(s, this.st[s]); stage.setScore(s, this.hp[s]); }
    if (this.mode === 'mp') battle.setRound(`${this.player.name} vs ${this.opponent.name}`, 'A duel of two phones');
    else battle.setRound(`${this.opponent.name}`, `Round ${this.opponent.round} of the Tilt`);
    try {
      await this.g(this.bridge.prepare());
      this.music.setMood('town'); this.energy(0.35); this.pulse();
      // A fight rebuilt from a snapshot skips the ceremony: the crowd has already had the introductions, and
      // the phones are waiting on a planning phase, not on Marla.
      if (this.mode !== 'mp' && !resumed && this.chatter) {   // MARLA.fightIntro is keyed by campaign opponent id
        if (this.tutorial) await this.g(dialogue.say(MARLA.tutorial));
        await this.g(dialogue.say(MARLA.fightIntro[this.opponent.id]));
      }
      this.sting('round_start'); if (!resumed) this.herald('round_start');
      Object.assign(stage, this.sceneHooks());   // so scenes (and the console) can ask the match for lines
      if (!resumed) await this.g(this.opener());  // the two arms meet: salute, staredown, entrance...
      while (this.hp.a > 0 && this.hp.b > 0 && !this.forced) { await this.hold(); await this.playTurn(); }
    } catch (e) {
      if (!(e instanceof FightEnded)) { this.over = true; throw e; }
    }
    // How it ended: the rules, or the host's drawer.
    const forced = this.forced;
    this.planStop?.(); try { battle.setTimer(null); } catch (e) {}
    if (forced === 'restart' || forced === 'quit') {
      this.over = true; this.ended = forced; this.control.clear();
      try { battle.hideDuel(); battle.setBeat(null); } catch (e) {}
      return false;
    }
    if (forced === 'draw') {
      this.over = true; this.ended = 'draw';
      await this.drawFinish();
      return false;
    }
    const won = forced ? forced === 'a' : this.hp.b <= 0;
    if (forced) { this.hp[won ? 'b' : 'a'] = 0; for (const s of ['a', 'b']) { battle.setHp(s, this.hp[s], this.max[s]); stage.setScore(s, this.hp[s]); } }
    this.over = true; this.ended = won ? 'win' : 'loss';
    await this.finish(won);
    return won;
  }

  /** A draw called from the drawer: nobody dances, the herald says so, and the result screen takes over. */
  async drawFinish() {
    const { stage, dialogue } = this;
    for (const s of ['a', 'b']) { stage.idle(s, false); stage.setPose(s, 'ready'); }
    stage.stamp('A draw', 'small'); this.music.setMood('town'); this.sting('lock_in');
    await this.wait(900);
    for (const s of ['a', 'b']) { stage.setPose(s, 'rest'); stage.idle(s, true); }
    if (this.mode !== 'mp' && this.chatter) await dialogue.quip('The herald calls it level. Nobody likes that.', 2200);
    this.control.clear();
  }

  async playTurn() {
    const { stage, battle, dialogue, bridge } = this;
    // A fight rebuilt from a host snapshot picks up here, once: the hands, piles and turn number are already
    // the saved ones, so nobody is re-dealt and nothing is spent twice.
    const R = this.resume; this.resume = null;
    this.barkAt = {}; this.beatKey = null;
    if (R) this.turn = Number(R.turn) || 1;
    else {
      this.turn++;
      // draw: hands persist between turns, so this tops each one back up to 5 (plus any flourish extras)
      for (const s of ['a', 'b']) {
        this.deck[s].drawTo(HAND_SIZE + this.st[s].flourish); this.st[s].flourish = 0;
        this.deck[s].offerCounter(this.st[s].counter > 0);   // the counter rides along while you hold one
      }
    }
    for (const s of ['a', 'b']) battle.setStatus(s, this.st[s]);
    let chainA, chainB;
    const replay = !!(R && R.phase === 'exchange' && R.chains);
    if (replay) {
      // The reload happened mid-exchange. Both chains were locked and already spent, so the turn simply
      // replays from its first beat: hp and statuses in the snapshot are the ones from before beat 1.
      chainA = [...(R.chains.a || [])]; chainB = [...(R.chains.b || [])];
      battle.setRound(this.mode === 'mp' ? `${this.player.name} vs ${this.opponent.name}` : `${this.opponent.name}`,
        `Turn ${this.turn} \u2014 resumed`);
    } else if (this.controllers) {
      // Phone duel: neither knight is at this screen. Publish both hands, put a waiting line on the HUD,
      // and sit here until both phones post a lock. No tell, no nagging, no card table.
      this.phaseNow = 'plan'; this.phase('plan');
      dialogue.hide(); this.music.setMood('town'); this.energy(0.3);
      const open = new Set(['a', 'b']);
      const nameOf = side => this.controllers[side].name || (side === 'a' ? this.player.name : this.opponent.name);
      const banner = () => battle.setRound(`${this.player.name} vs ${this.opponent.name}`,
        open.size ? `Turn ${this.turn} \u2014 waiting for ${[...open].map(nameOf).join(' and ')}` : `Turn ${this.turn} \u2014 both locked in`);
      const waitFor = side => this.controllers[side].planTurn(this.planView(side))
        .then(chain => { open.delete(side); try { stage.stamp(`${nameOf(side)} is set`, 'small'); } catch (e) {} banner(); return chain; });
      banner();
      // Nobody at the phones? The countdown locks them in where they stand, so one player walking away
      // cannot freeze the arena. The controller knows how to lock its own side with its current slots.
      this.planStop = this.startPlanTimer(() => {
        for (const side of [...open]) { try { this.controllers[side].timeout?.(); } catch (e) { console.warn('force lock', e); } }
      });
      [chainA, chainB] = await this.g(Promise.all([waitFor('a'), waitFor('b')]));
      this.planStop?.(); this.planStop = null;
      this.sting('lock_in');
    } else {
      // opponent plans first (hidden) so the tell can show while the player thinks
      const ctxB = { myHp: this.hp.b, myMaxHp: this.max.b, oppHp: this.hp.a, oppMaxHp: this.max.a, myStatus: this.st.b, oppStatus: this.st.a, oppLastChain: this.lastChain.a, handSize: this.deck.b.hand.length, turn: this.turn };
      chainB = chooseChain({ hand: this.deck.b.hand, energy: ENERGY_PER_TURN, ctx: ctxB, profile: this.opponent.profile });
      const tell = tellFor(chainB, this.opponent.profile);
      this.phaseNow = 'plan'; this.phase('plan');
      if (this.showTells) stage.tell('b', tell.category);
      this.music.setMood('town'); this.energy(0.3);
      if (this.chatter) { if (Math.random() < 0.45) setTimeout(() => this.planBark(), 2500); this.planNag(); }
      if (this.chatter) dialogue.quip(this.showTells
        ? (this.turn === 1 ? pick(MARLA.tell[tell.category]) : Math.random() < 0.6 ? pick(MARLA.tell[tell.category]) : pick(MARLA.plan))
        : pick(MARLA.plan), 6000);
      // The same countdown the phones get: at zero the table locks in whatever is in the three beats.
      this.planStop = this.startPlanTimer(() => { try { battle.lock(); } catch (e) { console.warn('auto lock', e); } });
      chainA = await this.g(battle.planTurn({ hand: this.deck.a.hand, energy: ENERGY_PER_TURN, turn: this.turn, color: 'red', status: this.st.a }));   // status.voltage dims a Rush you cannot power
      this.planStop?.(); this.planStop = null;
      this.planNagStop(); stage.untell('b'); dialogue.hide(); this.sting('lock_in');
    }
    if (!replay) { this.deck.a.spend(chainA); this.deck.b.spend(chainB); }
    this.lastChain = { a: chainA, b: chainB };
    await this.hold();

    // charge
    battle.showDuel(chainA, chainB); this.music.setMood('duel'); this.sting('charge'); this.energy(0.75); this.react('murmur_up');
    sfx.drumroll(1.0); this.react('drumroll_clap'); this.herald('charge');
    // The charge is a real ride on hardware: both carriages leave the apart stop for the 19.5 in stop while
    // the screen's knights run in. Start them together and wait for whichever takes longer -- the drumroll
    // covers the difference, and the exchange must not begin with the blades still out of reach.
    const carriagesIn = Promise.resolve(bridge.charge?.()).catch(e => { console.warn('charge failed', e); });
    await this.g(stage.charge(1100)); await this.g(carriagesIn);
    stage.cheer(900); this.energy(0.9);
    const hwA = chainA.map(id => (id ? card(id).hw : 'REST')), hwB = chainB.map(id => (id ? card(id).hw : 'REST'));
    await this.g(bridge.startExchange(hwA, hwB));
    this.phaseNow = 'exchange';
    // The phones are told the real schedule too, so nobody's screen claims a beat is over early.
    this.phase('exchange', { live: !!bridge.live, beats: bridge.beats || null, turnMs: bridge.turnMs ? bridge.turnMs() : 0 });

    // exchange, beat by beat
    let dead = false;
    for (let i = 0; i < BEATS_PER_TURN && !dead; i++) {
      await this.hold();                 // Pause holds the fight here, between beats, as advertised
      if (this.forced) throw new FightEnded(this.forced);
      battle.setBeat(i); this.beatKey = `${this.turn}:${i}`; this.outcome = '';
      const cA = chainA[i] ? card(chainA[i]) : null, cB = chainB[i] ? card(chainB[i]) : null;
      const r = resolveBeat(cA, cB, this.st.a, this.st.b);
      const beatDone = bridge.beat(i, r.played.a.hw, r.played.b.hw);
      // How long THIS beat really is. In sim it is the host's beat-length setting; on live arms it is the
      // daemon's own schedule for these two moves (an attack beat is ~4.5 s, a feint ~5.5 s), and the blow
      // lands where the compiler pinned it rather than at a flat 0.7 of the beat.
      const beatMs = bridge.beatMsFor ? bridge.beatMsFor(i) : this.beatMs;
      const impactAt = bridge.impactAtFor ? bridge.impactAtFor(i) : null;
      this.beatNow = beatMs;
      this.animMs = beatMs * ((impactAt != null ? impactAt : IMPACT) / IMPACT);   // what the screen animates over
      // motion foley from the real trajectories, impact pinned to the screen's impact instant
      const kinds = { a: undefined, b: undefined };
      for (const e of r.events) { if (e.type === 'hit') kinds[e.from] = 'hit'; else if (e.type === 'blocked') { kinds[e.attacker] = 'block'; kinds[e.blocker] = 'block'; } else if (e.type === 'clash' || e.type === 'rush_clash') { kinds.a = 'clash'; kinds.b = 'clash'; } else if (e.type === 'countered') { kinds[e.attacker] = 'hit'; kinds[e.defender] = 'block'; } }
      for (const s of ['a', 'b']) this.servo(r.played[s].hw, { beatMs: this.animMs, arm: s, impactAt: IMPACT, guardAt: 0.4, impact: kinds[s] });
      // The impact instant is where the damage lives, so a skipped beat still has to run it -- exactly once,
      // whether the animation reached it or the host cut the beat short first.
      let impactDone = false;
      const doImpact = () => { if (impactDone) return; impactDone = true; this.impact(i, r); };
      stage.playBeat({ a: r.played.a.hw, b: r.played.b.hw }, beatMs, { impact: doImpact, impactAt });
      for (const s of ['a', 'b']) { const ty = r.played[s].type; if (ty === 'attack') this.vocal(s, 'grunt', this.animMs * IMPACT - 150, 0.4); else if (ty === 'feint') this.vocal(s, 'hmm', this.animMs * IMPACT, 0.25); }
      // Skip animation: drop the rest of the swing, land the impact now. On live arms beatDone is still the
      // metal's own clock -- the screen stops pretending, the arms finish the move they are in.
      const offSkip = this.control.onSkip(() => { stage.clearTimers('a'); stage.clearTimers('b'); doImpact(); });
      await this.g(beatDone);   // the arms have finished this beat: on hardware, actually finished, not a timer
      offSkip(); doImpact();
      // Only now do the cards turn over -- this beat's pair, both at the same instant, in order -- and only
      // then the word for what just happened. The impact effects stayed back at the impact instant.
      battle.revealBeat(i, r.played.a, r.played.b, cA, cB);
      await this.wait(REVEAL_GAP);
      battle.setOutcome(i, this.outcome || '');
      this.phase('beat', { i, plannedA: cA ? cA.id : null, plannedB: cB ? cB.id : null,
                           playedA: r.played.a.id, playedB: r.played.b.id, outcome: this.outcome || '',
                           ms: beatMs });   // published only AFTER beatDone: never early
      this.st = r.status; for (const s of ['a', 'b']) battle.setStatus(s, this.st[s]);
      if (this.hp.a <= 0 || this.hp.b <= 0) { dead = true; await this.wait(600); }
      else await this.wait(OUTCOME_GAP);
      if (this.forced) throw new FightEnded(this.forced);
    }
    battle.setBeat(null);
    // return
    await this.wait(300); battle.hideDuel(); this.energy(0.4);
    // The return: the carriages back out to the apart stop while the screen's knights retreat. The arms are
    // only sent home once they are clear of each other -- an arm easing to rest between two closed-up
    // carriages is exactly the swing that hits the other machine.
    const carriagesOut = Promise.resolve(bridge.retreat?.()).catch(e => { console.warn('retreat failed', e); });
    await this.g(stage.retreat(900)); await this.g(carriagesOut); await this.g(bridge.returnHome());
    // what you did not play stays in your hand, but you can only carry HAND_SIZE of it: the rest is dropped
    // at random. The counter never counts and is never dropped.
    for (const s of ['a', 'b']) {
      this.deck[s].offerCounter(this.st[s].counter > 0);
      const dropped = this.deck[s].trimTo(HAND_SIZE);
      if (s === 'a' && dropped.length) { try { battle.discarded?.(dropped); } catch (e) {} }
    }
    for (const s of ['a', 'b']) { if (this.st[s].exposed) this.st[s].exposed = 0; }   // exposed does not survive the return
    for (const s of ['a', 'b']) battle.setStatus(s, this.st[s]);
  }

  /** The impact instant of a beat: reactions, damage numbers, hp, stamps, quips. */
  impact(i, r) {
    // `ms` paces the reactions and the stamps, so it is the length the screen is ANIMATING over, not the
    // whole live beat -- on hardware most of a beat is the daemon holding the last pose and easing home,
    // and a reaction stretched across that would still be twitching when the next beat starts.
    const { stage, battle, dialogue } = this; const ms = this.animMs || this.beatMs; const you = s => (s === 'a' ? 'player' : 'opp');
    let quip = null, outcome = '', railStamped = false;
    if (this.crowdOn()) try { this.crowd.duck(140); } catch (e) {}
    for (const e of r.events) {
      if (e.type === 'hit') {
        const rush = e.tags.includes('rush'), full = e.tags.includes('full_tilt'), outrun = r.kind === 'rush_hit';
        const low = e.line === 'low';
        // a swing that lost the race is thrown back the way a blocked attacker is
        stage.react(e.to, outrun ? 'blocked_attacker' : low ? 'hit_low' : 'hit', ms);
        if (outrun) stage.at(e.to, ms * 0.22, () => stage.react(e.to, 'hit', ms));
        if (r.kind !== 'both_hit' && !rush) stage.react(e.from, 'rebound', ms);   // a rush keeps its own recovery
        sfx.hit(e.dmg >= 7 || full ? 1.4 : 1); stage.shake(e.dmg >= 7 || full); if (e.dmg >= 7 && !rush) stage.flash('#ffd8a0');
        if (rush) {
          railStamped = true;
          stage.stamp(full ? 'Full tilt!' : 'Rush!', full ? 'hit' : 'hit small'); stage.flash(full ? '#ff9130' : '#ffd8a0');
          stage.fx('fx_spark', ...stage.armPoint(e.to, 60, -210), { scale: full ? 1.8 : 1.3, ms: 700, flip: e.to === 'b' });
          if (full) { stage.fx('fx_stars_ring', ...stage.armPoint(e.to, 30, -260), { scale: 1.5, ms: 800 }); stage.shake(true); }
          this.react(e.to === 'b' ? 'cheer' : 'gasp', full ? 1.4 : 1);
          this.barkSide(e.from, full ? 'full_tilt' : 'rush');
          outcome = full ? 'full tilt' : outrun ? 'rushed first' : 'rush';
          quip = pick(MARLA.outcome[`${full ? 'full_tilt' : 'rush'}_${you(e.to)}`]);
        }
        this.hp[e.to] = Math.max(0, this.hp[e.to] - e.dmg); battle.setHp(e.to, this.hp[e.to], this.max[e.to]); stage.setScore(e.to, this.hp[e.to]); this.pulse();
        if (rush) { /* the rail already named this beat and picked Marla's line */ }
        else if (e.tags.includes('clean')) { outcome = 'clean hit'; quip = pick(MARLA.outcome[`clean_hit_${you(e.to)}`]); }
        else if (e.tags.includes('caught_feint')) { outcome = 'feint punished'; quip = pick(MARLA.outcome[`feint_punished_${you(e.to)}`]); }
        else if (e.tags.includes('unblockable')) { outcome = 'thrust'; quip = pick(MARLA.outcome.unblockable); }
        else if (e.tags.includes('wrong_guard')) { outcome = 'wrong guard'; quip = pick(MARLA.outcome[`hit_${you(e.to)}`]); }
        else { outcome = r.kind === 'both_hit' ? 'both hit' : 'hit'; quip = pick(r.kind === 'both_hit' ? MARLA.outcome.both_hit : MARLA.outcome[`hit_${you(e.to)}`]); }
        if (e.to === 'b') { stage.cheer(1200); this.react('cheer', e.dmg >= 7 ? 1.3 : 0.9); } else this.react('ooh', e.dmg >= 7 ? 1.2 : 0.8);
        // the player was nearly down and landed one anyway: that gets the line, over any other bark this beat
        if (e.to === 'b' && this.hp.a > 0 && this.hp.a / this.max.a <= 0.34) { this.barkSide('a', 'comeback', { ms: 2400 }); this.barkSide('b', 'comeback', { chance: 0.5, delay: 1500, ms: 2200 }); }
        if (e.tags.includes('clean')) this.barkSide(e.from, 'clean_hit'); else if (e.tags.includes('caught_feint')) this.barkSide(e.from, 'punished_feint'); else this.barkSide(e.from, 'hit_landed', { chance: 0.45 });
        this.vocal(e.to, e.dmg >= 7 ? 'ouch' : Math.random() < 0.6 ? 'ouch' : 'grunt', 60); this.barkSide(e.to, 'took_hit', { chance: 0.5, delay: 650 });
        for (const t of e.tags) if (['riposte', 'windup', 'parry'].includes(t)) { const [fx, fy] = stage.armPoint(e.from, 0, -300); stage.float(fx, fy, t === 'parry' ? 'parry ×2' : t === 'windup' ? 'wind up +3' : 'riposte +2', 'good'); }
      }
      else if (e.type === 'clash') { stage.react('a', 'clash', ms); stage.react('b', 'clash', ms); sfx.clash(); stage.shake(true); stage.flash('#fff2c0'); stage.fx('fx_spark', 800, 480, { scale: 1.6, ms: 800 }); stage.stamp('Clash!', 'clash'); stage.cheer(1200); this.react('cheer', 1.1); this.barkSide(Math.random() < 0.5 ? 'a' : 'b', 'clash', { delay: 250 }); this.vocal('a', 'grunt'); this.vocal('b', 'grunt', 40); outcome = 'clash'; quip = pick(MARLA.outcome.clash); }
      else if (e.type === 'blocked') { stage.react(e.attacker, 'blocked_attacker', ms); stage.react(e.blocker, 'blocked_defender', ms); sfx.block(); stage.shake(); if (e.blocker === 'a') this.react('cheer', e.parry ? 0.9 : 0.6); else this.react('boo', 0.5); this.barkSide(e.blocker, e.parry ? 'parry' : 'blocked', { chance: e.parry ? 1 : 0.7 }); this.vocal(e.blocker, 'grunt', 30); this.barkSide(e.attacker, 'got_blocked', { chance: 0.5, delay: 700 }); outcome = e.parry ? 'parried' : 'blocked'; quip = pick(MARLA.outcome[e.blocker === 'a' ? 'blocked_by_player' : 'blocked_by_opp']); const [x, y] = stage.armPoint(e.blocker, 0, -300); stage.float(x, y, e.parry ? 'parry ×2' : 'riposte +2', 'good'); }
      else if (e.type === 'exposed') { stage.react(e.side, 'exposed', ms); sfx.exposed(); const [x, y] = stage.armPoint(e.side, 0, -300); stage.float(x, y, 'exposed', 'bad'); outcome = 'exposed'; quip = pick(MARLA.outcome[e.side === 'a' ? 'exposed_player' : 'exposed_opp']); if (e.side === 'b') { stage.cheer(800); this.react('laugh', 0.8); } else this.react('gasp', 0.8); this.barkSide(e.by, 'feint_worked'); this.vocal(e.by, 'laugh', 200); this.vocal(e.side, 'gasp', 80); this.barkSide(e.side, 'exposed', { chance: 0.6, delay: 900 }); }
      else if (e.type === 'staggered') { stage.at(e.side, ms * 0.3, () => { stage.react(e.side, 'stagger', ms); sfx.stagger(); }); const [x, y] = stage.armPoint(e.side, 0, -330); setTimeout(() => stage.float(x, y, 'staggered', 'bad'), ms * 0.3); quip = pick(MARLA.outcome[e.side === 'a' ? 'stagger_player' : 'stagger_opp']); if (e.side === 'b') this.react('cheer', 0.8); else this.react('ooh', 0.8); this.vocal(e.side, 'ouch', ms * 0.3); this.barkSide(e.side, 'staggered', { chance: 0.6, delay: ms * 0.4 }); }
      else if (e.type === 'double_feint') { stage.react('a', 'confused', ms); stage.react('b', 'confused', ms); sfx.confused(); this.react('laugh', 1); this.barkSide(Math.random() < 0.5 ? 'a' : 'b', 'double_feint', { delay: 300 }); this.vocal('a', 'hmm'); this.vocal('b', 'hmm', 120); outcome = 'two feints'; quip = pick(MARLA.outcome.double_feint); }
      else if (e.type === 'double_guard') { stage.react('a', 'wary', ms); stage.react('b', 'wary', ms); this.react('boo', 0.4); outcome = 'stare-down'; quip = pick(MARLA.outcome.double_guard); }
      else if (e.type === 'feint_wasted') { stage.react(e.side, 'confused', ms); sfx.confused(); this.react('laugh', 0.7); outcome = 'feint at nothing'; quip = pick(MARLA.outcome.feint_wasted); }
      else if (e.type === 'windup') { const [x, y] = stage.armPoint(e.side, 0, -330); stage.float(x, y, 'wind up +3', 'good'); this.react('murmur_up', 0.7); this.barkSide(e.side, 'windup', { chance: 0.8 }); this.vocal(e.side, 'grunt', 100); quip = quip || pick(MARLA.outcome.windup); outcome = outcome || 'wind up'; }
      else if (e.type === 'flourish') { const [x, y] = stage.armPoint(e.side, 0, -330); stage.float(x, y, '+2 cards', 'good'); this.react('cheer', 0.5); quip = quip || pick(MARLA.outcome.flourish); outcome = outcome || 'flourish'; }
      else if (e.type === 'guard_fizzled') { const [x, y] = stage.armPoint(e.side, 0, -300); stage.float(x, y, 'guard fizzles', 'mute'); }
      // ---- the rail ----
      else if (e.type === 'loaded') {
        const [x, y] = stage.armPoint(e.side, 0, -330); stage.float(x, y, e.capped ? 'voltage full' : '+1 voltage', e.capped ? 'mute' : 'good');
        sfx.buff();
        if (e.charged) { stage.stamp('Charged!', 'small'); this.barkSide(e.side, 'charged', { chance: 0.7 }); }
        outcome = outcome || (e.charged ? 'charged' : 'loading');
        quip = quip || pick(MARLA.outcome[e.charged ? 'charged' : 'loaded']);
      }
      else if (e.type === 'no_voltage') {
        const [x, y] = stage.armPoint(e.side, 0, -300); stage.float(x, y, 'no voltage', 'bad'); sfx.deny();
        stage.react(e.side, 'confused', ms);
        outcome = 'no voltage'; quip = pick(MARLA.outcome.no_voltage);
        this.barkSide(e.side, 'no_voltage', { chance: 0.7 }); this.vocal(e.side, 'hmm', 60, 0.6);
      }
      else if (e.type === 'rush_clash') {
        stage.react('a', 'clash', ms); stage.react('b', 'clash', ms); sfx.clash(); stage.shake(true); stage.flash('#ffd8a0');
        stage.fx('fx_spark', 800, 460, { scale: 1.8, ms: 800 }); stage.stamp('Both rush!', 'clash'); stage.cheer(1200); this.react('cheer', 1.2);
        this.barkSide(Math.random() < 0.5 ? 'a' : 'b', 'clash', { delay: 250 }); this.vocal('a', 'grunt'); this.vocal('b', 'grunt', 40);
        outcome = 'both rushed'; quip = pick(MARLA.outcome.rush_clash);
      }
      else if (e.type === 'countered') {
        const { attacker, defender, dmg } = e;
        stage.react(defender, 'blocked_defender', ms);                         // the counter catches it
        stage.react(attacker, 'blocked_attacker', ms);                         // ...and throws it straight back
        stage.at(attacker, ms * 0.22, () => stage.react(attacker, 'hit', ms));
        sfx.block(); setTimeout(() => sfx.hit(1.2), 160); stage.shake(true); stage.stamp('Countered!', 'hit');
        stage.fx('fx_spark_yellow', ...stage.armPoint(defender, 130, -220), { scale: 1.2, ms: 700, flip: defender === 'b' });
        const [x, y] = stage.armPoint(attacker, 20, -260); stage.float(x, y, `-${dmg}`, dmg >= 6 ? 'big' : 'dmg');
        const [cx, cy] = stage.armPoint(defender, 0, -320); stage.float(cx, cy, 'counter spent', 'mute');
        this.hp[attacker] = Math.max(0, this.hp[attacker] - dmg); battle.setHp(attacker, this.hp[attacker], this.max[attacker]); stage.setScore(attacker, this.hp[attacker]); this.pulse();
        if (attacker === 'b') { stage.cheer(1200); this.react('cheer', 1.2); } else this.react('ooh', 1);
        this.barkSide(defender, 'countered'); this.vocal(attacker, 'ouch', 120); this.barkSide(attacker, 'took_hit', { chance: 0.5, delay: 800 });
        outcome = 'countered'; quip = pick(MARLA.outcome[`countered_${you(attacker)}`]);
      }
      else if (e.type === 'counter_idle') { stage.react(e.side, 'wary', ms); outcome = outcome || 'counter held'; quip = quip || pick(MARLA.outcome.counter_idle); }
      else if (e.type === 'counter_standoff') { stage.react('a', 'wary', ms); stage.react('b', 'wary', ms); this.react('boo', 0.4); outcome = 'two counters'; quip = pick(MARLA.outcome.counter_standoff); }
      else if (e.type === 'nothing' || e.type === 'guard_idle') { outcome = outcome || 'nothing'; if (r.played.a.type === 'rest') this.barkSide('b', 'taunt_idle', { chance: 0.55, delay: 400 }); }
    }
    if (r.kind === 'nothing' && !quip) quip = pick(MARLA.outcome.nothing);
    this.outcome = outcome;   // playTurn shows it after the animation, when the cards turn over
    if (railStamped) { /* Rush! / Full tilt! already stamped */ }
    else if (['clean_hit', 'feint_punished'].includes(r.kind) || r.events.some(e => e.type === 'hit' && e.dmg >= 7)) stage.stamp(r.kind === 'feint_punished' ? 'Punished!' : r.events.find(e => e.type === 'hit')?.dmg >= 7 ? 'Crushing!' : 'Clean hit!', 'hit');
    else if (r.kind === 'blocked') { const b = r.events.find(e => e.type === 'blocked'); stage.stamp(b.parry ? 'Parried!' : b.rush ? 'Rush stopped!' : 'Blocked', 'block small'); }
    else if (r.kind === 'feint_exposed') stage.stamp('Exposed!', 'bad small');
    // voltage and counters changed this beat: the HUD must show it now, not after the beat resolves
    for (const s of ['a', 'b']) battle.setStatus(s, r.status[s]);
    for (const s of ['a', 'b']) if (this.hp[s] > 0 && this.hp[s] / this.max[s] <= 0.3 && !this.lowHpSaid[s]) { this.lowHpSaid[s] = true; quip = pick(MARLA.lowHp[s === 'a' ? 'player' : 'opp']); this.barkSide(s, 'low_hp', { delay: 900 }); if (s === 'b') this.react('chant', 1.2); else this.react('gasp', 1); }
    if (quip) dialogue.quip(quip, Math.max(1600, ms * 0.95));
  }

  /** The end of the fight: the knockout beat, then the finale scene (a real victory dance over a real,
   *  character-specific mope), then Marla's word and the result screen. */
  async finish(won) {
    const { stage, dialogue } = this;
    const loser = won ? 'b' : 'a', winner = won ? 'a' : 'b';
    const mope = won ? this.who : 'lionheart';                                   // who is doing the sulking
    const scene = this.poses.finale;                                             // the player's pick, or none
    this.beatKey = null;
    Object.assign(stage, this.sceneHooks());
    stage.idle(winner, false); stage.idle(loser, false);
    stage.setPose(loser, 'stagger'); stage.flag(loser, 'wobble', true); stage.move(loser, { dy: 10, rot: -10 }, 900);
    stage.setPose(winner, 'raise'); stage.move(winner, { dy: -6 }, 400);
    this.herald('ko');
    if (won) { sfx.fanfare(); stage.confetti(); stage.cheer(3500); this.react('ko', 1.5); this.music.setMood('victory'); this.sting('ko'); setTimeout(() => this.react('chant', 1.6), 1800); this.energy(1); }
    else { sfx.defeat(); this.react('gasp', 1.2); setTimeout(() => this.react('aww', 1.2), 700); this.music.setMood('defeat'); this.energy(0.15); }
    await this.bridge.flourish(winner, 'VICTORY');
    if (scene) {
      const arms = Promise.resolve(this.bridge.emote?.(scene, { swap: winner === 'b' })).catch(() => {});
      await this.wait(600);
      const screen = SCENES[scene]   // the screen joins in only when it has a scene of that name
        ? stage.playScene(scene, { swap: winner === 'b', mope, keep: true, ...this.sceneHooks() })
            .catch(e => { console.warn('finale failed', e); return this.wait(1200); })
        : this.wait(2400);
      // Skip animation during the victory dance: cut the tableau, keep the result screen coming.
      const off = this.control.onSkip(() => { try { stage.endScene(false); } catch (e) {} });
      try { await Promise.all([arms, screen]); } finally { off(); }   // the result waits for the real pose to end
    } else await this.wait(1400);
    this.herald(won ? 'victory' : 'defeat');
    if (won) this.react('cheer', 1.2); else this.react('aww', 0.9);
    await this.wait(500);
    if (this.mode !== 'mp' && this.chatter) await dialogue.say(won ? MARLA.win[this.opponent.id] : MARLA.lose);
    this.control.clear();
  }
}
