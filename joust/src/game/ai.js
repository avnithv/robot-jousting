// Opponent chain chooser. Samples valid chains from the hand, scores them against a profile, picks with
// softmax randomness. Also produces the pre-lock "tell" (the category of the first beat) the brainstorm
// notes describe: honest for the squire and the knight, sometimes a bluff for the champion.
import { card, BEATS_PER_TURN } from './cards.js';
import { VOLTAGE_MAX } from './rules.js';

export const PROFILES = {
  squire:   { temp: 1.6, aggression: 0.9, caution: 0.3, cunning: 0.2, bluff: 0.0 },
  knight:   { temp: 0.7, aggression: 0.9, caution: 0.8, cunning: 0.7, bluff: 0.0 },
  champion: { temp: 0.35, aggression: 1.1, caution: 0.9, cunning: 1.1, bluff: 0.5 },
};

// Only legal chains are sampled: the projected voltage at a beat has to pay for a rush played there (feints
// load it, rushes spend it), and the counter is cheap enough to spam, so one per chain.
function sampleChain(hand, energy, rng, voltage = 0) {
  const ids = [...hand]; const chain = [];
  let e = energy, v = voltage, counters = 0; let guard = 0;
  const beats = BEATS_PER_TURN;
  for (let i = 0; i < beats && guard++ < 50; i++) {
    const options = ids.map((id, k) => ({ id, k })).filter(o => {
      const c = card(o.id);
      if (c.cost > e) return false;
      if (c.type === 'rush' && v <= 0) return false;
      if (c.type === 'counter' && counters >= 1) return false;
      return true;
    });
    if (!options.length || rng() < 0.08) { chain.push(null); continue; }
    const pick = options[Math.floor(rng() * options.length)];
    const c = card(pick.id);
    chain.push(pick.id); e -= c.cost; ids.splice(pick.k, 1);
    if (c.type === 'feint') v = Math.min(VOLTAGE_MAX, v + 1);
    else if (c.type === 'rush') v -= 1;
    else if (c.type === 'counter') counters++;
  }
  while (chain.length < beats) chain.push(null);
  return chain;
}

function score(chain, ctx, P) {
  const cards = chain.map(id => (id ? card(id) : null));
  let s = 0;
  const opp = ctx.oppStatus, me = ctx.myStatus;
  const oppLast = (ctx.oppLastChain || []).map(id => (id ? card(id) : null));
  const oppAttackLines = oppLast.filter(c => c && c.type === 'attack').map(c => c.line);
  const oppGuards = oppLast.filter(c => c && (c.type === 'block' || c.type === 'counter')).length;
  const oppFeints = oppLast.filter(c => c && c.type === 'feint').length;
  const oppAttacks = oppLast.filter(c => c && (c.type === 'attack' || c.type === 'rush')).length;
  const lowHp = ctx.myHp / ctx.myMaxHp < 0.35;
  const oppLowHp = ctx.oppHp / ctx.oppMaxHp < 0.3;
  const hasRush = (ctx.hand || []).some(id => id && card(id).type === 'rush');
  let windupPending = !!me.windup, feintPending = false;
  let volt = me.voltage || 0, lastFired = !!me.fired;   // the rail, projected through the chain

  cards.forEach((c, i) => {
    const wasFired = lastFired; lastFired = false;
    if (!c) { s -= 1.5; return; }
    if (c.type === 'rush') {
      if (volt <= 0) { s -= 4; return; }                                 // fizzling wastes the beat and the energy
      const full = wasFired;                                             // second rush in a row: full tilt
      const nextIsRush = cards[i + 1] && cards[i + 1].type === 'rush' && volt - 1 > 0;
      s += 2.6 * P.aggression + (full ? 3.0 : 0);
      if (oppAttacks >= 2) s += 1.6 * P.cunning;                         // they swing a lot: the rush beats swings
      if (oppGuards >= 2 && !full && !nextIsRush) s -= 1.4 * P.cunning;  // they turtle: a lone rush is stopped
      if (opp.staggered && i === 0) s += 2;
      if (oppLowHp) s += 1.5 * P.aggression;
      volt -= 1; lastFired = true;
      return;
    }
    if (c.type === 'counter') {
      s += 0.8 * P.caution + (oppAttacks >= 2 ? 1.8 * P.cunning : 0);
      if (lowHp) s += 1.6 * P.caution;
      if (me.exposed) s += 0.5;                                          // exposed never touches the counter
      return;
    }
    if (c.type === 'attack') {
      s += 2.2 * P.aggression + c.dmg * 0.25;
      if (opp.staggered && i === 0) s += 3;
      if (opp.exposed) s += 1.5;
      if (me.riposte || me.parry) s += 2;
      if (windupPending) { s += 2.5; windupPending = false; }
      if (feintPending) { s += 1.2 * P.cunning; feintPending = false; }
      if (oppGuards >= 2 && !c.unblockable) s -= 0.8 * P.cunning;
      if (oppLowHp) s += 1.5 * P.aggression;
      if (c.unblockable && oppGuards >= 1) s += 1.0 * P.cunning;
    } else if (c.type === 'block') {
      const lineHits = c.blocks.filter(l => oppAttackLines.includes(l)).length;
      s += 1.0 * P.caution + lineHits * 1.2 * P.cunning;
      if (lowHp) s += 1.5 * P.caution;
      if (i === 0 && oppAttackLines.length >= 2) s += 0.8 * P.cunning;
      if (oppFeints >= 1) s -= 1.0 * P.cunning;
      if (me.exposed) s -= 3;
      if (c.brace) s += 0.5;
    } else if (c.type === 'feint') {
      s += 0.6 + oppGuards * 1.1 * P.cunning;
      if (i === 2) s -= 0.7;               // a feint on the last beat sets up nothing
      if (volt < VOLTAGE_MAX && hasRush) s += 0.9;       // ...unless it is loading the rail
      volt = Math.min(VOLTAGE_MAX, volt + 1);
      feintPending = true;
    } else if (c.type === 'special') {
      if (c.effect === 'windup') { s += i < 2 ? 1.2 * P.cunning : -1; windupPending = true; }
      if (c.effect === 'flourish') s += ctx.handSize <= 5 ? 0.8 : 0.2;
    }
  });
  const attacks = cards.filter(c => c && (c.type === 'attack' || c.type === 'rush')).length;
  if (attacks === 0) s -= 2 * P.aggression;
  if (attacks === 3) s += 0.5 * P.aggression;
  return s;
}

export function chooseChain({ hand, energy, ctx, profile = 'knight', rng = Math.random, samples = 160 }) {
  const P = PROFILES[profile] || PROFILES.knight;
  const seen = new Map();
  const c2 = { ...ctx, hand };                         // the scorer wants to know if a rush is waiting
  const volt = ctx.myStatus?.voltage || 0;
  for (let i = 0; i < samples; i++) {
    const ch = sampleChain(hand, energy, rng, volt); const key = ch.join('|');
    if (!seen.has(key)) seen.set(key, { chain: ch, score: score(ch, c2, P) });
  }
  const cands = [...seen.values()];
  const max = Math.max(...cands.map(c => c.score));
  const weights = cands.map(c => Math.exp((c.score - max) / P.temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < cands.length; i++) { x -= weights[i]; if (x <= 0) return cands[i].chain; }
  return cands[cands.length - 1].chain;
}

export const CATEGORY = { attack: 'attack', block: 'guard', feint: 'trick', special: 'trick', rest: 'rest', rush: 'attack', counter: 'guard' };

export function tellFor(chain, profile = 'knight', rng = Math.random) {
  const P = PROFILES[profile] || PROFILES.knight;
  const first = chain.find(Boolean);
  const real = first ? CATEGORY[card(first).type] : 'rest';
  if (rng() < P.bluff) {
    const others = ['attack', 'guard', 'trick'].filter(c => c !== real);
    return { category: others[Math.floor(rng() * others.length)], honest: false };
  }
  return { category: real, honest: true };
}
