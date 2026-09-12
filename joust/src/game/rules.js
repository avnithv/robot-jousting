// Pure beat-resolution rules. No DOM, no timers: (cardA, cardB, statusA, statusB) -> outcome.
// Mirrors docs/brainstorm.md (round 2 + 3) and docs/reactions_and_pairs.md:
//   attack lands unless met by a guard on that line; two attacks on different lines both land;
//   same line = clash; feint into a guard leaves the guard Exposed; attack into a feint punishes it;
//   a hit on an open (resting) arm is a clean hit and Staggers it; a stopped attack rewards the blocker.
// Plus the rail (round 4): feints load VOLTAGE, a Rush spends 1 and races down the rail so it lands before
//   any swing, two rushes in a row is FULL TILT and goes through any guard, and a Counter throws whatever
//   hits it back at the attacker and is spent.
//
// Status object per side: { exposed, staggered, riposte, windup, parry, flourish, voltage, counter, fired }
//   exposed   : next guard card fizzles (arm is caught open). Cleared when it eats a guard or at turn end + 1.
//   staggered : next beat is lost (the arm reels instead of playing its card).
//   riposte   : +2 damage on the next attack (from stopping an attack with a guard).
//   windup    : +3 damage on the next attack (from Wind Up).
//   parry     : next attack deals double (from stopping an attack with a Parry).
//   flourish  : extra cards to draw next turn.
//   voltage   : 0..VOLTAGE_MAX, the charge on the rail. Starts at 0 each fight; a feint loads +1, a rush
//               spends 1. No voltage, no rush.
//   counter   : how many counters this side is holding (a run resource, see match.js / main.js).
//   fired     : internal, 1 if this side's rush fired in the PREVIOUS beat. A rush fired on top of that is
//               FULL TILT.

import { REST, STAGGER, FULL_TILT } from './cards.js';

export const CLEAN_HIT_BONUS = 1;   // hit on a resting / tricking arm
export const FEINT_PUNISH_BONUS = 2; // attack that catches a feint mid-motion
export const WRONG_GUARD_BONUS = 1;  // guard on the wrong line is off balance
export const RIPOSTE_BONUS = 2;
export const WINDUP_BONUS = 3;
export const VOLTAGE_MAX = 2;        // two loads is all the rail holds

export function emptyStatus() {
  return { exposed: 0, staggered: 0, riposte: 0, windup: 0, parry: 0, flourish: 0, voltage: 0, counter: 0, fired: 0 };
}

function covers(block, line) {
  if (!block.blocks) return false;
  return line === 'any' ? false : block.blocks.includes(line);
}

// Damage an attacker's card deals right now, consuming its one-shot buffs.
function attackDamage(card, st, bonus, notes) {
  let dmg = card.dmg + bonus;
  if (st.riposte) { dmg += RIPOSTE_BONUS; st.riposte = 0; notes.push('riposte'); }
  if (st.windup) { dmg += WINDUP_BONUS; st.windup = 0; notes.push('windup'); }
  if (st.parry) { dmg *= 2; st.parry = 0; notes.push('parry'); }
  return dmg;
}

/**
 * Resolve one beat.
 * @returns {{
 *   played: {a: card, b: card},          // what each arm actually did (after stagger / exposed substitutions)
 *   damage: {a: number, b: number},      // damage TAKEN by each side
 *   events: Array<object>,               // ordered, for the UI / choreography
 *   status: {a: status, b: status},      // updated statuses (new objects)
 *   kind: string                         // headline: 'clash' | 'hit' | 'both_hit' | 'blocked' | 'feint_exposed' |
 *                                        // 'rush_hit' | 'full_tilt' | 'rush_clash' | 'countered' | 'counter_idle' |
 *                                        // 'no_voltage' | ...
 * }}
 */
export function resolveBeat(cardA, cardB, statusA, statusB) {
  const st = { a: { ...statusA }, b: { ...statusB } };
  const played = { a: cardA || REST, b: cardB || REST };
  const events = [];
  const damage = { a: 0, b: 0 };
  const sides = ['a', 'b'];
  const other = s => (s === 'a' ? 'b' : 'a');

  // 1. Stagger: the arm loses this beat.
  for (const s of sides) {
    if (st[s].staggered) {
      st[s].staggered = 0;
      if (!played[s].brace) { played[s] = STAGGER; events.push({ type: 'stagger_lost_beat', side: s }); }
    }
  }
  // 2. Exposed: a guard fizzles.
  for (const s of sides) {
    if (st[s].exposed && played[s].type === 'block' && !played[s].brace) {
      st[s].exposed = 0; played[s] = REST; events.push({ type: 'guard_fizzled', side: s });
    }
  }
  // 3. Specials resolve regardless of the opponent.
  for (const s of sides) {
    const c = played[s];
    if (c.type === 'special') {
      if (c.effect === 'windup') { st[s].windup = 1; events.push({ type: 'windup', side: s }); }
      if (c.effect === 'flourish') { st[s].flourish += 2; events.push({ type: 'flourish', side: s }); }
    }
  }

  // 4. The rail: feints load voltage, rushes spend it. A rush with nothing on the rail fizzles (it is played
  //    as REST for the rest of this beat); one fired on top of last beat's rush goes FULL TILT.
  const fired = { a: 0, b: 0 };
  let fizzled = false;
  for (const s of sides) {
    const c = played[s];
    if (c.type === 'feint') {
      const before = st[s].voltage;
      st[s].voltage = Math.min(VOLTAGE_MAX, before + 1);
      events.push({ type: 'loaded', side: s, voltage: st[s].voltage, capped: before >= VOLTAGE_MAX, charged: before < VOLTAGE_MAX && st[s].voltage >= VOLTAGE_MAX });
    } else if (c.type === 'rush') {
      if (st[s].voltage <= 0) { played[s] = REST; fizzled = true; events.push({ type: 'no_voltage', side: s }); }
      else { st[s].voltage -= 1; if (st[s].fired) played[s] = FULL_TILT; fired[s] = 1; }
    }
  }
  for (const s of sides) st[s].fired = fired[s];   // a beat without a rush clears the chain

  const A = played.a, B = played.b;
  const tA = A.type, tB = B.type;
  let kind = 'nothing';

  const hit = (from, to, card, bonus, tags) => {
    const notes = [];
    const dmg = attackDamage(card, st[from], bonus, notes);
    damage[to] += dmg;
    events.push({ type: 'hit', from, to, dmg, line: card.line, tags: [...tags, ...notes] });
    return dmg;
  };
  // The counter throws the card straight back: raw card damage, no riposte / wind up / parry (those are
  // consumed and wasted against it), and the counter is spent.
  const countered = (attacker, defender, c) => {
    const dmg = c.dmg;
    for (const k of ['riposte', 'windup', 'parry']) st[attacker][k] = 0;
    damage[attacker] += dmg;
    st[defender].counter = Math.max(0, st[defender].counter - 1);
    const tags = ['countered', ...(c.type === 'rush' ? (c.fullTilt ? ['rush', 'full_tilt'] : ['rush']) : [])];
    events.push({ type: 'countered', attacker, defender, dmg, tags, line: c.line || 'any' });
    return dmg;
  };
  const swings = t => t === 'attack' || t === 'rush';   // what a counter can throw back

  if (tA === 'counter' || tB === 'counter') {
    const m = tA === 'counter' ? 'a' : 'b', o = other(m), oc = played[o];
    if (tA === 'counter' && tB === 'counter') { kind = 'double_guard'; events.push({ type: 'counter_standoff' }); }
    else if (swings(oc.type)) { kind = 'countered'; countered(o, m, oc); }
    else if (oc.type === 'feint') { kind = 'feint_wasted'; events.push({ type: 'feint_wasted', side: o }); }
    else if (oc.type === 'block') { kind = 'double_guard'; events.push({ type: 'double_guard' }); }
    else { kind = 'counter_idle'; events.push({ type: 'counter_idle', side: m }); }
  } else if (tA === 'rush' && tB === 'rush') {
    // both race: they meet mid-rail. Full tilt rolls straight over a plain rush.
    if (!A.fullTilt === !B.fullTilt) { kind = 'rush_clash'; events.push({ type: 'rush_clash' }); }
    else { const w = A.fullTilt ? 'a' : 'b'; kind = 'rush_hit'; hit(w, other(w), played[w], 0, ['rush', 'full_tilt']); }
  } else if (tA === 'rush' || tB === 'rush') {
    const f = tA === 'rush' ? 'a' : 'b', d = other(f);
    const fc = played[f], dc = played[d];
    const tags = fc.fullTilt ? ['rush', 'full_tilt'] : ['rush'];
    if (dc.type === 'attack') {
      // the rush gets there first: the swing is knocked back before it lands
      kind = 'rush_hit'; hit(f, d, fc, 0, tags);
    } else if (dc.type === 'block') {
      if (fc.fullTilt) { kind = 'full_tilt'; hit(f, d, fc, 0, [...tags, 'through_guard']); }
      else {
        kind = 'blocked';
        events.push({ type: 'blocked', attacker: f, blocker: d, line: fc.line, parry: !!dc.parry, rush: true });
        if (dc.parry) { st[d].parry = 1; events.push({ type: 'parry_set', side: d }); }
        else { st[d].riposte = 1; events.push({ type: 'riposte_set', side: d }); }
      }
    } else if (dc.type === 'feint') {
      kind = 'feint_punished'; hit(f, d, fc, FEINT_PUNISH_BONUS, [...tags, 'caught_feint']);
    } else {
      kind = 'clean_hit'; hit(f, d, fc, CLEAN_HIT_BONUS, [...tags, 'clean']);
      if (dc.type !== 'stagger') { st[d].staggered = 1; events.push({ type: 'staggered', side: d }); }
    }
  } else if (tA === 'attack' && tB === 'attack') {
    const sameLine = A.line === B.line && A.line !== 'any';
    if (sameLine) {
      kind = 'clash'; events.push({ type: 'clash', line: A.line });
    } else {
      kind = 'both_hit';
      hit('a', 'b', A, 0, ['trade']); hit('b', 'a', B, 0, ['trade']);
    }
  } else if ((tA === 'attack' && tB === 'block') || (tB === 'attack' && tA === 'block')) {
    const atk = tA === 'attack' ? 'a' : 'b', def = other(atk);
    const ac = played[atk], bc = played[def];
    if (!ac.unblockable && covers(bc, ac.line)) {
      kind = 'blocked';
      events.push({ type: 'blocked', attacker: atk, blocker: def, line: ac.line, parry: !!bc.parry });
      if (bc.parry) { st[def].parry = 1; events.push({ type: 'parry_set', side: def }); }
      else { st[def].riposte = 1; events.push({ type: 'riposte_set', side: def }); }
    } else {
      kind = 'hit';
      const tags = ac.unblockable ? ['unblockable'] : ['wrong_guard'];
      hit(atk, def, ac, ac.unblockable ? 0 : WRONG_GUARD_BONUS, tags);
    }
  } else if ((tA === 'attack' && tB === 'feint') || (tB === 'attack' && tA === 'feint')) {
    const atk = tA === 'attack' ? 'a' : 'b', def = other(atk);
    kind = 'feint_punished';
    hit(atk, def, played[atk], FEINT_PUNISH_BONUS, ['caught_feint']);
  } else if (tA === 'attack' || tB === 'attack') {
    // attack vs rest / special / stagger: clean hit
    const atk = tA === 'attack' ? 'a' : 'b', def = other(atk);
    const victim = played[def];
    kind = 'clean_hit';
    hit(atk, def, played[atk], CLEAN_HIT_BONUS, ['clean']);
    if (victim.type !== 'stagger') { st[def].staggered = 1; events.push({ type: 'staggered', side: def }); }
  } else if ((tA === 'feint' && tB === 'block') || (tB === 'feint' && tA === 'block')) {
    const f = tA === 'feint' ? 'a' : 'b', g = other(f);
    if (played[g].brace) { kind = 'feint_braced'; events.push({ type: 'feint_wasted', side: f }); }
    else { kind = 'feint_exposed'; st[g].exposed = 1; events.push({ type: 'exposed', side: g, by: f }); }
  } else if (tA === 'feint' && tB === 'feint') {
    kind = 'double_feint'; events.push({ type: 'double_feint' });
  } else if (tA === 'block' && tB === 'block') {
    kind = 'double_guard'; events.push({ type: 'double_guard' });
  } else if (tA === 'feint' || tB === 'feint') {
    const f = tA === 'feint' ? 'a' : 'b';
    kind = 'feint_wasted'; events.push({ type: 'feint_wasted', side: f });
  } else {
    kind = 'nothing';
    if (tA === 'block' || tB === 'block') events.push({ type: 'guard_idle' });
    else events.push({ type: 'nothing' });
  }
  if (fizzled && kind === 'nothing') kind = 'no_voltage';   // the fizzle is the story of the beat

  return { played, damage, events, status: st, kind };
}

// End of turn: Exposed wears off if it was not consumed during the following turn.
export function endTurnStatus(st) {
  const n = { ...st };
  if (n.exposed) n.exposed = Math.max(0, n.exposed - 1);   // set to 2 when applied at end of a turn-> lasts next turn
  return n;
}

export function applyHp(hp, dmg) {
  return Math.max(0, hp - dmg);
}
