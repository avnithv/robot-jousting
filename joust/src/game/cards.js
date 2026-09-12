// Card catalogue. Every card maps to a move name in the robot-jousting motion library
// (arm/motions_tuned.json / sim/params/*.json). `taught: false` marks moves that exist in
// docs/move_catalogue.md but have not been tuned on the real arms yet: the front end plays them
// in sim, the hardware bridge substitutes the `fallback` move until they are taught.
//
// Lines: 'high' | 'low' | 'any'. Blocks cover a list of lines. Costs are energy (3 per turn).

export const CARDS = {
  chop: {
    id: 'chop', name: 'Overhead Chop', type: 'attack', line: 'high', cost: 1, dmg: 4,
    hw: 'ATTACK_HIGH', icon: 'chop',
    text: 'Deal 4 on the HIGH line.', flavor: 'Raise it tall, bring it down.',
  },
  slash_l: {
    id: 'slash_l', name: 'Low Slash', type: 'attack', line: 'low', side: 'l', cost: 1, dmg: 4,
    hw: 'ATTACK_LOW_LR', icon: 'slash',
    text: 'Deal 4 on the LOW line.', flavor: 'A flat sweep at the knees.',
  },
  slash_r: {
    id: 'slash_r', name: 'Low Slash', type: 'attack', line: 'low', side: 'r', cost: 1, dmg: 4,
    hw: 'ATTACK_LOW_RL', icon: 'slash', mirror: true,
    text: 'Deal 4 on the LOW line.', flavor: 'Backhand. Same knees.',
  },
  thrust: {
    id: 'thrust', name: 'Thrust', type: 'attack', line: 'any', cost: 1, dmg: 3, unblockable: true,
    hw: 'ATTACK_THRUST', fallback: 'ATTACK_HIGH', taught: false, icon: 'thrust',
    text: 'Deal 3. Cannot be blocked.', flavor: 'The shortest path is a straight line.',
  },
  feint_high: {
    id: 'feint_high', name: 'High Feint', type: 'feint', line: 'high', cost: 0,
    hw: 'FEINT_HIGH', icon: 'feint',
    text: 'Meets a guard: the guard is EXPOSED. Meets an attack: you get punished.', flavor: 'Make them flinch.',
  },
  feint_low: {
    id: 'feint_low', name: 'Low Feint', type: 'feint', line: 'low', side: 'l', cost: 0,
    hw: 'FEINT_LEFT', icon: 'feint',
    text: 'Meets a guard: the guard is EXPOSED. Meets an attack: you get punished.', flavor: 'A sweep that stops dead.',
  },
  feint_right: {
    id: 'feint_right', name: 'Low Feint', type: 'feint', line: 'low', side: 'r', cost: 0,
    hw: 'FEINT_RIGHT', icon: 'feint', mirror: true,
    text: 'Meets a guard: the guard is EXPOSED. Meets an attack: you get punished.', flavor: 'The backhand that never comes.',
  },
  guard_high: {
    id: 'guard_high', name: 'High Guard', type: 'block', blocks: ['high'], cost: 1,
    hw: 'BLOCK_HIGH', icon: 'guard_high',
    text: 'Blocks the HIGH line. Stopping an attack gives RIPOSTE: +2 on your next attack.', flavor: 'A level bar at the brow.',
  },
  guard_low: {
    id: 'guard_low', name: 'Hanging Guard', type: 'block', blocks: ['low'], cost: 1,
    hw: 'BLOCK_MIDDLE', icon: 'guard_low',
    text: 'Blocks the LOW line, from either side. Stopping an attack gives RIPOSTE: +2 on your next attack.', flavor: 'Blade slanted down across the knees.',
  },
  // The two side guards: a hanging guard set to one side of the body. Each stops only the sweep that comes
  // from its own side (sim/collision_intent.json: BLOCK_LEFT meets ATTACK_LOW_LR, BLOCK_RIGHT meets ATTACK_LOW_RL).
  guard_left: {
    id: 'guard_left', name: 'Left Guard', type: 'block', blocks: ['low'], sides: ['l'], cost: 1,
    hw: 'BLOCK_LEFT', icon: 'guard_low',
    text: 'Blocks a LOW slash from the LEFT only. Stopping an attack gives RIPOSTE: +2 on your next attack.', flavor: 'Hanging guard, left side.',
  },
  guard_right: {
    id: 'guard_right', name: 'Right Guard', type: 'block', blocks: ['low'], sides: ['r'], cost: 1,
    hw: 'BLOCK_RIGHT', icon: 'guard_low', mirror: true,
    text: 'Blocks a LOW slash from the RIGHT only. Stopping an attack gives RIPOSTE: +2 on your next attack.', flavor: 'Hanging guard, right side.',
  },
  parry_high: {
    id: 'parry_high', name: 'High Parry', type: 'block', blocks: ['high'], cost: 1, parry: true,
    hw: 'PARRY_HIGH', fallback: 'BLOCK_HIGH', taught: false, icon: 'parry',
    text: 'Blocks the HIGH line. Stop an attack and your next attack deals DOUBLE.', flavor: 'Catch, then snap.',
  },
  parry_low: {
    id: 'parry_low', name: 'Low Parry', type: 'block', blocks: ['low'], cost: 1, parry: true,
    hw: 'PARRY_LOW', fallback: 'BLOCK_MIDDLE', taught: false, icon: 'parry',
    text: 'Blocks the LOW line. Stop an attack and your next attack deals DOUBLE.', flavor: 'Catch, then snap.',
  },
  brace: {
    id: 'brace', name: 'Brace', type: 'block', blocks: ['high', 'low'], cost: 2, brace: true,
    hw: 'BRACE', fallback: 'BLOCK_HIGH', taught: false, icon: 'brace',
    text: 'Blocks BOTH lines. Cannot be staggered or exposed this beat.', flavor: 'Hunch and hold.',
  },
  rush: {
    id: 'rush', name: 'Rush', type: 'rush', line: 'any', cost: 1, dmg: 4, volt: 1,
    hw: 'ATTACK_HIGH', icon: 'chop',
    text: 'Needs 1 VOLTAGE. Rush the rail: lands before any swing. A guard stops it. Right after your own Rush it is FULL TILT: 6, through any guard.',
    flavor: 'Down the rail before they finish the backswing.',
  },
  counter: {
    id: 'counter', name: 'Counter', type: 'counter', cost: 0,
    hw: 'BLOCK_HIGH', icon: 'guard_high',
    text: 'Hold the counter. Any attack into it is stopped and thrown back at the attacker. Spent when it fires.',
    flavor: 'Let them hit themselves. Politely.',
  },
  windup: {
    id: 'windup', name: 'Wind Up', type: 'special', effect: 'windup', cost: 0,
    hw: 'WIND_UP', fallback: 'FEINT_HIGH', taught: false, icon: 'windup',
    text: 'Skip this beat. Your next attack deals +3. Everyone sees it coming.', flavor: 'Blade up, quivering.',
  },
  flourish: {
    id: 'flourish', name: 'Flourish', type: 'special', effect: 'flourish', cost: 0,
    hw: 'TWIRL', fallback: 'FEINT_HIGH', taught: false, icon: 'flourish',
    text: 'Skip this beat. Draw 2 extra cards next turn.', flavor: 'Showing off is a tactic.',
  },
};

// Implicit card for an unfilled beat: the arm holds en garde and is open.
export const REST = { id: 'rest', name: 'Rest', type: 'rest', cost: 0, hw: 'REST', icon: 'rest', text: 'Hold en garde. Open to attacks.' };
// The beat a Staggered arm loses (no card resolves).
export const STAGGER = { id: 'stagger', name: 'Staggered', type: 'stagger', cost: 0, hw: 'STAGGER', icon: 'stagger', text: 'Reeling. No move this beat.' };
// What a Rush becomes when it fires in the beat right after your own rush: the same card (same id, so the
// table still shows the Rush you played), harder, through any guard, and its own move on the arm.
export const FULL_TILT = {
  ...CARDS.rush, name: 'Full Tilt', dmg: 6, fullTilt: true, unblockable: true,
  hw: 'ATTACK_LOW_LR', icon: 'slash',
  text: 'The whole rail at once. Deal 6, through any guard. A Counter still throws it back.',
  flavor: 'No brakes on this one.',
};
// The Counter is a resource, not a deck card: match.js puts this id in the hand while status.counter > 0 and
// never lets it reach a discard pile.
export const COUNTER_ID = 'counter';

export const STARTER_DECK = ['chop', 'chop', 'slash_l', 'slash_r', 'thrust', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'rush', 'flourish'];

export const REWARD_POOL = ['thrust', 'parry_high', 'parry_low', 'brace', 'windup', 'chop', 'slash_l', 'feint_high', 'rush', 'flourish', 'guard_high', 'guard_low'];

// The simple duel: no draw pile, no discard, no counters. Every turn both players draft their three beats from
// one of each physical move the arms know (the ten tuned moves), and each beat is its own pass down the rail.
export const SIMPLE_DECK = ['chop', 'slash_l', 'slash_r', 'feint_high', 'feint_low', 'feint_right', 'guard_high', 'guard_left', 'guard_right', 'guard_low'];

export const ENERGY_PER_TURN = 3;
export const BEATS_PER_TURN = 3;
export const HAND_SIZE = 5;

export function card(id) {
  if (id === 'rest') return REST;
  if (id === 'stagger') return STAGGER;
  const c = CARDS[id];
  if (!c) throw new Error('unknown card ' + id);
  return c;
}

export const TYPE_LABEL = { attack: 'Attack', block: 'Guard', feint: 'Feint', special: 'Trick', rest: 'Rest', stagger: 'Stagger', rush: 'Rush', counter: 'Counter' };
