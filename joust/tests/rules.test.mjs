// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBeat, emptyStatus, RIPOSTE_BONUS, WINDUP_BONUS, CLEAN_HIT_BONUS, FEINT_PUNISH_BONUS, WRONG_GUARD_BONUS, VOLTAGE_MAX } from '../src/game/rules.js';
import { card, REST, HAND_SIZE, COUNTER_ID, SIMPLE_DECK } from '../src/game/cards.js';
import { Deck, SimpleDeck } from '../src/game/match.js';

const S = () => emptyStatus();
const r = (a, b, sa = S(), sb = S()) => resolveBeat(a && card(a), b && card(b), sa, sb);

test('attack into a guard on the same line is blocked and grants riposte', () => {
  const o = r('chop', 'guard_high');
  assert.equal(o.kind, 'blocked'); assert.deepEqual(o.damage, { a: 0, b: 0 }); assert.equal(o.status.b.riposte, 1);
});

test('attack into a guard on the wrong line lands with the off-balance bonus', () => {
  const o = r('chop', 'guard_low');
  assert.equal(o.kind, 'hit'); assert.equal(o.damage.b, 4 + WRONG_GUARD_BONUS); assert.equal(o.damage.a, 0);
});

test('same-line attacks clash for no damage', () => {
  const o = r('chop', 'chop');
  assert.equal(o.kind, 'clash'); assert.deepEqual(o.damage, { a: 0, b: 0 });
});

test('different-line attacks both land', () => {
  const o = r('chop', 'slash_l');
  assert.equal(o.kind, 'both_hit'); assert.deepEqual(o.damage, { a: 4, b: 4 });
});

test('attack punishes a feint', () => {
  const o = r('chop', 'feint_high');
  assert.equal(o.kind, 'feint_punished'); assert.equal(o.damage.b, 4 + FEINT_PUNISH_BONUS);
});

test('feint into a guard exposes the guard', () => {
  const o = r('feint_high', 'guard_high');
  assert.equal(o.kind, 'feint_exposed'); assert.equal(o.status.b.exposed, 1); assert.deepEqual(o.damage, { a: 0, b: 0 });
});

test('an exposed guard fizzles and the follow-up is a clean hit that staggers', () => {
  const sb = { ...S(), exposed: 1 };
  const o = r('chop', 'guard_high', S(), sb);
  assert.equal(o.played.b, REST); assert.equal(o.kind, 'clean_hit');
  assert.equal(o.damage.b, 4 + CLEAN_HIT_BONUS); assert.equal(o.status.b.staggered, 1); assert.equal(o.status.b.exposed, 0);
});

test('a staggered arm loses its beat and is not re-staggered', () => {
  const sb = { ...S(), staggered: 1 };
  const o = r('chop', 'chop', S(), sb);
  assert.equal(o.played.b.type, 'stagger'); assert.equal(o.damage.b, 4 + CLEAN_HIT_BONUS); assert.equal(o.status.b.staggered, 0);
});

test('thrust ignores guards', () => {
  const o = r('thrust', 'guard_high');
  assert.equal(o.kind, 'hit'); assert.equal(o.damage.b, 3);
});

test('wind up then attack adds +3 once', () => {
  const o1 = r('windup', 'rest');
  assert.equal(o1.status.a.windup, 1);
  const o2 = r('chop', 'guard_low', o1.status.a, o1.status.b);
  assert.equal(o2.damage.b, 4 + WRONG_GUARD_BONUS + WINDUP_BONUS); assert.equal(o2.status.a.windup, 0);
});

test('parry doubles the next attack', () => {
  const o1 = r('chop', 'parry_high');
  assert.equal(o1.kind, 'blocked'); assert.equal(o1.status.b.parry, 1); assert.equal(o1.status.b.riposte, 0);
  const o2 = r('rest', 'chop', o1.status.a, o1.status.b);
  assert.equal(o2.damage.a, (4 + CLEAN_HIT_BONUS) * 2);
});

test('riposte and wind up stack', () => {
  const sa = { ...S(), riposte: 1, windup: 1 };
  const o = r('slash_l', 'guard_high', sa, S());
  assert.equal(o.damage.b, 4 + WRONG_GUARD_BONUS + RIPOSTE_BONUS + WINDUP_BONUS);
});

test('brace blocks both lines, shrugs off feints, and cannot be exposed', () => {
  assert.equal(r('chop', 'brace').kind, 'blocked');
  assert.equal(r('slash_r', 'brace').kind, 'blocked');
  const o = r('feint_low', 'brace');
  assert.equal(o.kind, 'feint_braced'); assert.equal(o.status.b.exposed, 0);
});

test('flourish banks extra draws', () => {
  const o = r('flourish', 'rest');
  assert.equal(o.status.a.flourish, 2); assert.equal(o.kind, 'nothing');
});

test('rest vs rest does nothing', () => {
  const o = r(null, null);
  assert.equal(o.kind, 'nothing'); assert.deepEqual(o.damage, { a: 0, b: 0 });
});

// ---------------------------------------------------------------------------------------------------
// The rail: VOLTAGE, the Rush, FULL TILT and the Counter.
// ---------------------------------------------------------------------------------------------------
const charged = (n = 1, extra = {}) => ({ ...S(), voltage: n, ...extra });

test('a feint loads one voltage, and the rail caps at two', () => {
  const o = r('feint_high', 'rest');
  assert.equal(o.status.a.voltage, 1);
  const ev = o.events.find(e => e.type === 'loaded');
  assert.equal(ev.side, 'a'); assert.equal(ev.charged, false);
  const o2 = r('feint_high', 'rest', o.status.a, o.status.b);
  assert.equal(o2.status.a.voltage, VOLTAGE_MAX);
  assert.equal(o2.events.find(e => e.type === 'loaded').charged, true);
  const o3 = r('feint_high', 'rest', o2.status.a, o2.status.b);
  assert.equal(o3.status.a.voltage, VOLTAGE_MAX);
  assert.equal(o3.events.find(e => e.type === 'loaded').capped, true);
});

test('a feint loads even when it is punished, but not when the beat is lost to a stagger', () => {
  const o = r('feint_high', 'chop');
  assert.equal(o.kind, 'feint_punished'); assert.equal(o.status.a.voltage, 1);
  const o2 = r('feint_high', 'chop', { ...S(), staggered: 1 }, S());
  assert.equal(o2.played.a.type, 'stagger'); assert.equal(o2.status.a.voltage, 0);
});

test('a rush on an empty rail fizzles: played as rest, energy gone, kind no_voltage', () => {
  const o = r('rush', 'rest');
  assert.equal(o.kind, 'no_voltage'); assert.equal(o.played.a, REST);
  assert.equal(o.events.find(e => e.type === 'no_voltage').side, 'a');
  assert.deepEqual(o.damage, { a: 0, b: 0 }); assert.equal(o.status.a.fired, 0);
  // and the fizzle leaves the arm open: the opponent's swing is a clean hit
  const o2 = r('rush', 'chop');
  assert.equal(o2.kind, 'clean_hit'); assert.equal(o2.damage.a, 4 + CLEAN_HIT_BONUS);
});

test('a rush beats a swing to the centre: the attacker takes it and deals nothing', () => {
  for (const swing of ['chop', 'slash_l', 'thrust']) {
    const o = r('rush', swing, charged(), S());
    assert.equal(o.kind, 'rush_hit', swing);
    assert.equal(o.damage.b, 4, swing); assert.equal(o.damage.a, 0, swing);
    assert.ok(o.events.find(e => e.type === 'hit').tags.includes('rush'));
    assert.equal(o.status.a.voltage, 0); assert.equal(o.status.a.fired, 1);
  }
});

test('any guard stops a plain rush, whatever line it is on, and earns the riposte', () => {
  for (const guard of ['guard_high', 'guard_low', 'brace']) {
    const o = r('rush', guard, charged(), S());
    assert.equal(o.kind, 'blocked', guard); assert.deepEqual(o.damage, { a: 0, b: 0 }, guard);
    assert.equal(o.status.b.riposte, 1, guard);
    assert.equal(o.events.find(e => e.type === 'blocked').rush, true);
  }
  const p = r('rush', 'parry_high', charged(), S());
  assert.equal(p.kind, 'blocked'); assert.equal(p.status.b.parry, 1);
});

test('a rush right after your own rush is FULL TILT: 6 through any guard, including brace', () => {
  const sa = charged(2);
  const o1 = r('rush', 'guard_high', sa, S());
  assert.equal(o1.kind, 'blocked'); assert.equal(o1.status.a.fired, 1); assert.equal(o1.status.a.voltage, 1);
  const o2 = r('rush', 'guard_high', o1.status.a, o1.status.b);
  assert.equal(o2.kind, 'full_tilt'); assert.equal(o2.played.a.name, 'Full Tilt');
  assert.equal(o2.damage.b, 6);                        // straight through the second guard
  assert.ok(o2.events.find(e => e.type === 'hit').tags.includes('full_tilt'));
  const o3 = r('rush', 'brace', o1.status.a, S());
  assert.equal(o3.kind, 'full_tilt'); assert.equal(o3.damage.b, 6);
  assert.equal(o3.played.a.hw, 'ATTACK_LOW_LR');       // the arms get their own move for it
});

test('fired clears on any beat without a rush, so the chain has to be back to back', () => {
  const o1 = r('rush', 'rest', charged(2), S());
  assert.equal(o1.status.a.fired, 1);
  const o2 = r('chop', 'rest', o1.status.a, o1.status.b);
  assert.equal(o2.status.a.fired, 0);
  const o3 = r('rush', 'guard_high', o2.status.a, o2.status.b);
  assert.equal(o3.kind, 'blocked');                     // plain rush again, not full tilt
});

test('two rushes meet mid-rail for no damage', () => {
  const o = r('rush', 'rush', charged(), charged());
  assert.equal(o.kind, 'rush_clash'); assert.deepEqual(o.damage, { a: 0, b: 0 });
  assert.ok(o.events.some(e => e.type === 'rush_clash'));
  assert.equal(o.status.a.fired, 1); assert.equal(o.status.b.fired, 1);
});

test('full tilt rolls over a plain rush', () => {
  const o = r('rush', 'rush', charged(2, { fired: 1 }), charged());
  assert.equal(o.kind, 'rush_hit'); assert.equal(o.damage.b, 6); assert.equal(o.damage.a, 0);
  assert.ok(o.events.find(e => e.type === 'hit').tags.includes('full_tilt'));
});

test('a rush punishes a feint and cleans up an idle arm', () => {
  const f = r('rush', 'feint_high', charged(), S());
  assert.equal(f.kind, 'feint_punished'); assert.equal(f.damage.b, 4 + FEINT_PUNISH_BONUS);
  assert.equal(f.status.b.voltage, 1);                  // the feint still loads
  const i = r('rush', 'rest', charged(), S());
  assert.equal(i.kind, 'clean_hit'); assert.equal(i.damage.b, 4 + CLEAN_HIT_BONUS); assert.equal(i.status.b.staggered, 1);
});

test('a counter throws an attack back at the attacker and is spent', () => {
  const sb = { ...S(), counter: 1 };
  const o = r('chop', 'counter', S(), sb);
  assert.equal(o.kind, 'countered'); assert.equal(o.damage.a, 4); assert.equal(o.damage.b, 0);
  assert.equal(o.status.b.counter, 0);
  const e = o.events.find(x => x.type === 'countered');
  assert.equal(e.attacker, 'a'); assert.equal(e.defender, 'b'); assert.equal(e.dmg, 4);
  assert.ok(e.tags.includes('countered'));
  assert.equal(r('thrust', 'counter', S(), sb).damage.a, 3);   // a thrust is countered too
});

test('a counter wastes the attacker riposte, wind up and parry instead of returning them', () => {
  const sa = { ...S(), riposte: 1, windup: 1, parry: 1 };
  const o = r('chop', 'counter', sa, { ...S(), counter: 1 });
  assert.equal(o.damage.a, 4);                          // base damage only
  assert.equal(o.status.a.riposte, 0); assert.equal(o.status.a.windup, 0); assert.equal(o.status.a.parry, 0);
});

test('a counter throws a rush and a full tilt back too', () => {
  const sb = { ...S(), counter: 1 };
  const o = r('rush', 'counter', charged(), sb);
  assert.equal(o.kind, 'countered'); assert.equal(o.damage.a, 4); assert.equal(o.status.b.counter, 0);
  assert.ok(o.events.find(x => x.type === 'countered').tags.includes('rush'));
  const t = r('rush', 'counter', charged(2, { fired: 1 }), sb);
  assert.equal(t.damage.a, 6); assert.equal(t.damage.b, 0);
  assert.ok(t.events.find(x => x.type === 'countered').tags.includes('full_tilt'));
});

test('a feint into a counter is wasted, but still loads the rail', () => {
  const o = r('feint_high', 'counter', S(), { ...S(), counter: 1 });
  assert.equal(o.kind, 'feint_wasted'); assert.deepEqual(o.damage, { a: 0, b: 0 });
  assert.equal(o.status.a.voltage, 1); assert.equal(o.status.b.counter, 1);   // nothing to reflect: not spent
  assert.equal(o.status.b.exposed, 0);                                        // and a counter is never exposed
});

test('two counters are a standoff, and a counter against nothing just idles', () => {
  const both = { ...S(), counter: 1 };
  const st = r('counter', 'counter', both, both);
  assert.equal(st.kind, 'double_guard'); assert.ok(st.events.some(e => e.type === 'counter_standoff'));
  assert.equal(st.status.a.counter, 1); assert.equal(st.status.b.counter, 1);
  const idle = r('counter', 'rest', both, S());
  assert.equal(idle.kind, 'counter_idle'); assert.equal(idle.events.find(e => e.type === 'counter_idle').side, 'a');
  assert.equal(idle.status.a.counter, 1);
  assert.equal(r('counter', 'windup', both, S()).kind, 'counter_idle');
  assert.equal(r('counter', 'guard_high', both, S()).kind, 'double_guard');   // two guards, nothing to throw back
});

test('an exposed side still counters, but a staggered side loses the counter beat', () => {
  const ex = { ...S(), counter: 1, exposed: 1 };
  const o = r('chop', 'counter', S(), ex);
  assert.equal(o.kind, 'countered'); assert.equal(o.damage.a, 4);
  const stg = { ...S(), counter: 1, staggered: 1 };
  const o2 = r('chop', 'counter', S(), stg);
  assert.equal(o2.played.b.type, 'stagger'); assert.equal(o2.kind, 'clean_hit');
  assert.equal(o2.damage.b, 4 + CLEAN_HIT_BONUS); assert.equal(o2.damage.a, 0);
  assert.equal(o2.status.b.counter, 1);                 // the counter is still in hand for next beat
});

// ---------------------------------------------------------------------------------------------------
// Hands persist between turns and are trimmed back to HAND_SIZE at random.
// ---------------------------------------------------------------------------------------------------
test('the hand persists, tops up to five, and is trimmed back to five at random', () => {
  const d = new Deck(['chop', 'chop', 'slash_l', 'slash_r', 'thrust', 'feint_high', 'feint_low', 'guard_high', 'guard_low', 'rush']);
  d.drawTo(HAND_SIZE);
  assert.equal(d.hand.length, HAND_SIZE);
  const kept = d.hand.slice(0, 3);
  d.spend([d.hand[3], d.hand[4]]);                       // play two
  assert.equal(d.discard.length, 2); assert.deepEqual(d.hand, kept);
  d.drawTo(HAND_SIZE + 2);                               // next turn, with a flourish
  assert.equal(d.count(), 7);
  for (const id of kept) assert.ok(d.hand.includes(id), 'unplayed cards stay in hand');
  const dropped = d.trimTo(HAND_SIZE);
  assert.equal(dropped.length, 2); assert.equal(d.count(), HAND_SIZE);
  for (const id of dropped) assert.ok(d.discard.includes(id));
});

test('the counter rides in the hand while it is held, never counts and never reaches the discard', () => {
  const d = new Deck(['chop', 'chop', 'slash_l', 'slash_r', 'thrust', 'feint_high']);
  d.drawTo(HAND_SIZE); d.offerCounter(true);
  assert.equal(d.hand.length, HAND_SIZE + 1); assert.equal(d.count(), HAND_SIZE);
  d.spend([COUNTER_ID]);
  assert.ok(!d.hand.includes(COUNTER_ID)); assert.ok(!d.discard.includes(COUNTER_ID));
  d.offerCounter(true); d.drawTo(HAND_SIZE + 3); d.trimTo(HAND_SIZE);   // trimming never drops it
  assert.ok(d.hand.includes(COUNTER_ID)); assert.equal(d.count(), HAND_SIZE);
  d.offerCounter(false);                                  // a spent counter leaves the hand
  assert.ok(!d.hand.includes(COUNTER_ID)); assert.ok(!d.discard.includes(COUNTER_ID));
});

test('the table is symmetric', () => {
  const ids = ['chop', 'slash_l', 'thrust', 'feint_high', 'guard_high', 'guard_low', 'parry_high', 'brace', 'windup', 'rush', 'counter', 'rest'];
  // once with cold statuses, once with a loaded rail, a counter in hand and a rush already fired
  for (const st of [() => S(), () => ({ ...S(), voltage: 2, counter: 1 }), () => ({ ...S(), voltage: 2, counter: 1, fired: 1 })]) {
    for (const x of ids) for (const y of ids) {
      const o1 = r(x, y, st(), st()), o2 = r(y, x, st(), st());
      assert.equal(o1.damage.a, o2.damage.b, `${x} vs ${y}`); assert.equal(o1.damage.b, o2.damage.a, `${x} vs ${y}`);
      assert.equal(o1.status.a.voltage, o2.status.b.voltage, `voltage ${x} vs ${y}`);
      assert.equal(o1.status.a.counter, o2.status.b.counter, `counter ${x} vs ${y}`);
    }
  }
});

// ---- the simple duel: side guards, the three extra cards, the deck that never runs out ----
test('a side guard stops the low slash from its own side', () => {
  const o = r('slash_l', 'guard_left');
  assert.equal(o.kind, 'blocked'); assert.deepEqual(o.damage, { a: 0, b: 0 }); assert.equal(o.status.b.riposte, 1);
  assert.equal(r('slash_r', 'guard_right').kind, 'blocked');
});
test('a side guard on the wrong side is passed like a wrong-line guard', () => {
  const o = r('slash_l', 'guard_right');
  assert.equal(o.kind, 'hit'); assert.equal(o.damage.b, 4 + WRONG_GUARD_BONUS);
  assert.equal(r('slash_r', 'guard_left').kind, 'hit');
});
test('the hanging guard in the middle stops both low slashes', () => {
  assert.equal(r('slash_l', 'guard_low').kind, 'blocked'); assert.equal(r('slash_r', 'guard_low').kind, 'blocked');
});
test('the chop goes over every low guard', () => {
  for (const g of ['guard_left', 'guard_right', 'guard_low']) assert.equal(r('chop', g).kind, 'hit');
  assert.equal(r('chop', 'guard_high').kind, 'blocked');
});
test('the two low slashes clash, the feints punish and expose as before', () => {
  assert.equal(r('slash_l', 'slash_r').kind, 'clash');
  assert.equal(r('slash_r', 'feint_right').kind, 'feint_punished');
  assert.equal(r('feint_right', 'guard_left').kind, 'feint_exposed');
});
test('the simple deck is one card for each of the ten tuned moves', () => {
  const hw = SIMPLE_DECK.map(id => card(id).hw);
  assert.equal(new Set(hw).size, 10);
  assert.deepEqual([...hw].sort(), ['ATTACK_HIGH', 'ATTACK_LOW_LR', 'ATTACK_LOW_RL', 'BLOCK_HIGH', 'BLOCK_LEFT', 'BLOCK_MIDDLE', 'BLOCK_RIGHT', 'FEINT_HIGH', 'FEINT_LEFT', 'FEINT_RIGHT']);
  for (const id of SIMPLE_DECK) assert.equal(card(id).taught !== false, true, id + ' must be a taught move');
});
test('the simple deck never spends, trims or offers a counter', () => {
  const d = new SimpleDeck();
  assert.equal(d.drawTo(5).length, SIMPLE_DECK.length);
  d.spend(['chop', 'chop', 'guard_high']); d.offerCounter(true);
  assert.deepEqual(d.trimTo(HAND_SIZE), []);
  assert.deepEqual(d.drawTo(5), SIMPLE_DECK);
  assert.equal(d.hand.includes(COUNTER_ID), false);
  assert.equal(Deck.from(d.snapshot()) instanceof SimpleDeck, true);
});
