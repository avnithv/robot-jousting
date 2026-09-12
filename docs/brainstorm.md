# Brainstorm notes (2026-09-12)

## Directions the user liked
- Arms start at opposite ends each turn and advance toward each other (a "pass").
- Asymmetry between the arms.
- Weapon swaps.
- Card hands so players can't always play the move they want (guards scarce).
- Moves and weapons must map to specific, repeatable arm actions that make sense.

## The pass (turn structure)
1. Approach: play approach card face down, reveal, arms advance.
   - Charge: full advance, fast. Canter: full advance, normal. Hold: stop short.
2. Clash: knowing distance and opponent approach, play clash card face down, reveal, perform.
   - Attacks connect only if weapon reach covers the distance.
   - Faster weapon strikes first; if it staggers, the slower strike is cancelled.
3. Return: both arms go home, draw cards.

## Weapons (all share one grip profile, one rack slot, one taught pickup pose)
| Weapon | Reach   | Speed   | Moves |
|--------|---------|---------|-------|
| Lance  | Long    | Medium  | High Thrust, Low Thrust (extend along line). Couch (diagonal parry, one line). |
| Spear  | Longest | Fast    | Center Thrust (weak, hits at any distance, strikes first). Reach Guard (vertical, blocks thrusts not swings). |
| Mace   | Short   | Slow    | Overhead Smash (raise, drop). Sweep (horizontal wrist arc, beats extended lances). |
| Hammer | Short   | Slowest | Overhead only. Huge damage, strikes last. |
| Rapier | Medium  | Fastest | Cut High, Cut Low, Parry, Riposte (double after Parry). Weak damage. |
| Shield | None    | Fast    | Shield Wall (blocks both lines). Shield Bash (opponent starts next pass closer, loses Hold). |
| Whip   | Medium  | Fast    | Crack (forces discard). Wrap (opponent forced to Canter next pass). |

## Swap
Play Swap: arm goes to rack instead of clash. Absent this pass; opponent gets a
free run at a ring/dummy for a point. Both swap: both rearm, nothing else.

## Cards
- ~20 per player: ~6 approach, ~10 clash (weapon-specific), 3 generic, 1 Swap.
- Hand 4, play 2 per pass (approach + clash), draw 2.
- Guards scarce: 3 or 4 per deck.
- Generic: Feint (punishes guard, forces discard), Recover (draw 2, exposed), Rest.
- Shatter: same-line lance vs lance removes both lance cards from the match.
- Weapon-locked cards are dead in hand until you hold that weapon.

## Asymmetry
- Knight (big arm): heavy rack, slower on every card, hand of 3.
- Squire (small arm): light rack, faster on every card, hand of 5.
- Different racks per side even with identical arms.
- Mounting height changes which line is fast for each arm.

## Earlier ideas still on the table
- Physical block tower as the health bar (hits knock blocks off).
- Running at the ring / knock the crown as the "hit confirmed" prop.
- Tells: small pre-lock twitch reveals attack vs defense category.
- One flinch button per match during choreography.
- Damaged arm performs slower, wobblier choreography and loses cards.
- Crowd votes and fake-coin betting on spectator phones.

---

# Round 2 (2026-09-12): Slay the Spire direction

User feedback: max 2 weapons. Focus on physical moves as cards. No two-step
pass; both arms charge at once because coolness matters. Model on Slay the Spire.

## Turn
1. Plan: 3 energy, hand of 5, play cards in order up to energy. Hidden.
2. Charge: both arms drive to center simultaneously (each stops on its own side).
3. Exchange: resolve beat by beat, A's card N vs B's card N. Extra beats hit an open opponent.
4. Return: retreat, discard hand, draw 5, energy resets.

Beat rules: attack lands unless met by a block on that line. Two attacks both land.
Two blocks nothing. Feint into a block leaves blocker Exposed.

## Sword (fast, cheap, hidden)
Slash High 1 (4 dmg high) / Slash Low 1 (4 dmg low) / Thrust 1 (3 dmg any line,
not parryable) / Parry High 1 / Parry Low 1 (block that line, next attack x2) /
Guard 1 (block both) / Feint 0 (Exposed if it meets a block) / Flourish 0 (draw 2, skip beat)

## Hammer (slow, expensive, telegraphed)
Overhead 2 (9 dmg high, Staggers, only after Wind Up) / Sweep 1 (5 dmg both lines,
not parryable) / Wind Up 0 (revealed to opponent, next attack +3) / Brace 1 (block both,
cannot be Staggered) / Shoulder Charge 1 (cancels opponent's next beat) /
Second Wind 1 (+1 energy next turn, skip beat)

## Statuses and numbers
HP 25. Staggered = double damage next turn, arm rides in late. Exposed = no block
cards next turn. Momentum = +1 dmg per turn without blocking. Overdrive (1 per deck):
all energy, max arm speed. Deck starts at 10, pick 1 of 3 after each match, loser first.

## Choreography budget
~14 card snippets per arm + charge, return, stagger, death.

---

# Round 3 (2026-09-12): v1 = 4 moves, chained, real arms + gantry

- Hardware: SO-101 + SO-100 on a gantry, bases stop 2 ft apart at the clash, ~0.5 m travel each. Weapon: plastic knife (~18 cm).
- Safety rule from the sim: hilt never crosses the centre line (<= 0.27 m from own base). Only knives enter the middle.
- v1 moves: attack_high (overhead chop), attack_low (low sweep), block_high (vertical, flat out), block_low (hanging guard).
- Chaining: two stances (high, low). Each move ends in a stance; the next move starts from it. Stance is a visible tell.
- Beat outcome bonuses (user): block vs attack -> blocker bonus; feint vs block -> feinter bonus; attack vs feint -> attacker bonus.
  Bonus TBD. Candidates: stagger (loser's next beat becomes a recoil), advantage (+dmg next attack), resource (draw/energy).
- Workflow: teach poses on the real SO-101 (arm/teach.py, torque off), play them back (arm/play.py), pull into the sim to check pairs.
