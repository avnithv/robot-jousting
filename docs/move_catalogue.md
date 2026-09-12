# Move catalogue (candidates, 2026-09-12)

Conventions as in `sim/move_params.py`: pan + = own right; roll 0 = sword on top, 90 = on the side (jaw swings sideways), 180 = underneath; jaw 0 shut, 100 open; hand x/z in metres from the pan axis. Limits: x <= 0.27, z 0.07..0.48, vertical blade only at z >= ~0.18. Beat 1.2 s; at ~300 deg/s a 90 deg travel costs 0.35 s, so a 40 deg pan sweep is the biggest sideways motion that still fits windup + settle in a beat.

What a spectator at 3 m sees: hand height, blade orientation (vertical / flat / diagonal), big pan sweeps, and the jaw snap. Two moves must differ on at least two of those; wrist-pitch-only differences are invisible. (v1) = already exists. Timing: w windup, s strike, h hold.

## 1. Attacks

| Name | Rules | Physical, timing | Reads as | Reach / risk |
|---|---|---|---|---|
| ATTACK_HIGH (v1) | High attack, 4 | Raise+cock: lift -20, elbow -32, wrist 134, roll 0, jaw 85 (1.05 s); slam to lift -6, wrist 72, jaw 0 (0.22 s) | Tall vertical blade, then the drop | Verified |
| ATTACK_LOW_LR / RL (v1) | Low attack, 4 | z 0.08, roll 90, pan -20 to +20 (mirror for RL), jaw 55 to 0 during the sweep; w 0.7, s 0.4 | Low, wide swipe | Verified; elbow near table at z 0.08 |
| ATTACK_THRUST | Either line, 3, not parryable | Roll 0, blade level and forward, jaw 0. Retract to x 0.14 z 0.20 (w 0.5), lunge to x 0.27 (0.25), h 0.2, ease back | Straight in-out, no swing | Farthest tip of any move; verify vs opponent BLOCK_HIGH bar |
| ATTACK_HIGH_SIDE | High attack, 4 | ATTACK_LOW at z 0.24: roll 90, pan -25 to +25, jaw 60 to 0; w 0.6, s 0.4 | Head-height swipe; differs from low slash by height | Mirror pair meets in the middle: verify |
| ATTACK_DIAGONAL_L / R | 4; beats a side hanging guard on the far side | Roll 45, x 0.22 z 0.30 pan -20, jaw 70 (w 0.6); slam to z 0.14 pan +15, jaw 0, lift forward (0.4) | Slanted stroke across the body | Roll 45 + pitch may hit wrist limits at the top |
| ATTACK_RISING | Low attack, 4; ignores hanging guards | Roll 180 (blade underneath), x 0.24 z 0.12, jaw 80 so the blade hangs back (w 0.6); jaw 0 while lift raises to z 0.24 (0.35) | The only blade that travels upward | Roll 180 may exceed the real roll range; fall back to roll -150 |
| ATTACK_FLURRY | 2+2, first hit lands before slow moves | Roll 90 z 0.20; jaw 50-0-50-0 with pan -10/+10 in time: 4 x 0.25 s | Rapid double snap | Jaw servo heat; cap at two snaps |
| ATTACK_OVERHEAD_HEAVY | 2 beats, 9, staggers; needs WIND_UP first | Beat 1 = WIND_UP. Beat 2: lift -30/wrist 140 to lift +5/wrist 60 in 0.35 s with jaw slam, then 0.3 s buried hold at z 0.10 | Biggest arc: straight up to nearly the table | Stop wrist at -60 so the tip clears the table |

## 2. Blocks / guards

| Name | Rules | Physical | Reads as | Reach / risk |
|---|---|---|---|---|
| BLOCK_HIGH (v1) | Blocks high | lift 70, elbow -70, wrist -94, pan 20, roll 90, jaw 100: finger up, blade sticks out sideways as a level bar; move 0.8, h 0.4 | Horizontal bar at head height | Verified; pan 20 centres the bar |
| BLOCK_LEFT / RIGHT / MIDDLE (v1) | Blocks low on that side | x 0.26 z 0.20, pan -20/+20/0, blade pitched -45 (hanging); move 0.8, h 0.4 | Blade slanted down across the low line | Verified |
| BLOCK_POST | Blocks high side slashes only (not the chop) | x 0.24 z 0.26, roll 0, jaw 0, blade vertical (pitch 90); move 0.7, h 0.5 | Upright post, contrasts with the flat bar of BLOCK_HIGH | Vertical blade fine at z 0.26 |
| BRACE | Blocks both lines, cannot be staggered, costs the beat | Pull in to x 0.16 z 0.18, roll 45, pitch -30, blade across the chest; move 0.6, then a 0.15 s lift +5 "dig in", h | Hunched, blade across the body | Elbow vs shoulder bracket near the base |
| PARRY_HIGH / LOW | Block that line; next attack x2 | Matching guard (w 0.5); at 0.7 s a 0.2 s jaw flick 35 to 0 with a 10 deg pan snap toward the opponent, h | Guard plus a visible beat of the blade | Same envelope as the guards |
| DODGE_BACK | Avoids anything; no bonus, no attack next beat | x 0.12 z 0.28, roll 0, pitch 60; 0.5 out, h 0.7 | Whole arm leans away | Safest move in the set |

## 3. Feints

| Name | Rules | Physical | Reads as | Reach / risk |
|---|---|---|---|---|
| FEINT_HIGH | Beats block (blocker Exposed); loses to attack | Phases 1-2 of ATTACK_HIGH (1.05 s), then jaw closes slowly (0.15) while lift returns to READY | Same windup as the chop, no drop | Verified envelope |
| FEINT_LOW | Same, low tell | ATTACK_LOW windup, then a 15 deg half-sweep that stops dead and snaps back (0.3) | Sweep that stops mid-air | Verified envelope |
| FEINT_THRUST | Feint; also reveals the opponent's next stance | Half lunge x 0.14 to 0.21 (0.25), tap 0.1, back | Short stab that stops short | Tip never reaches the middle |

## 4. Movement / stance

| Name | Rules | Physical | Reads as | Reach / risk |
|---|---|---|---|---|
| READY_HIGH / READY_LOW | Start stance; visible tell | HIGH: x 0.20 z 0.30, roll 0, blade up-forward. LOW: x 0.22 z 0.12, roll 90, blade flat forward | Blade up vs blade flat | Both are v1 end poses |
| SWITCH_STANCE | 0-cost beat, draw a card | HIGH to LOW: roll 0 to 90, jaw 0, hand descending, 0.5 s, h 0.2 | Blade rolls from vertical to flat | None |
| ADVANCE | Next attack lands through a block | Gantry +5 cm if present; lift forward 15, elbow extends x 0.18 to 0.27 at z 0.20, 0.6 s, h | Arm pushes toward the centre | Never past x 0.27 after the gantry step |
| RETREAT | Clears Exposed / Staggered | x 0.12 z 0.25, blade slightly up, 0.5 s | Arm shrinks to its base | None |
| SIDESTEP_L / R | Next attack on the far side misses | Pan +-35 at z 0.20, blade kept on the opponent via roll/pitch, 0.5 s, h | Whole arm off the centre line | x 0.26 at pan 35 stays inside 0.27 |
| WIND_UP | Reveals next attack, +3 | lift -30, wrist 140, roll 0, jaw 100, hold with a slow lift wobble | Blade straight up and quivering | Slow the last 20 deg to avoid overshoot |

## 5. Reactions

| Name | Rules | Physical | Reads as | Reach / risk |
|---|---|---|---|---|
| HIT_HIGH | Took a high hit | Lift back 20, wrist up 30, pan 15 away, jaw 40 (blade flops); 0.2 snap, 0.4 wobble back | Head snapping back | Motion is all away from the opponent |
| HIT_LOW | Took a low hit | Elbow folds 25, hand to z 0.10, wrist droops; 0.2 snap, 0.5 recover | Knee buckles | Do not undershoot z 0.07 |
| STAGGER | Loser's next beat: no card resolves | Full beat: lift rocks +-12 twice, pan drifts 20 away, blade droops to pitch -50 roll 60, jaw 50; ends in EXPOSED | Drunken wobble, guard drops | Stays in own half |
| CLASH | Same-line attack vs attack, no damage | Both freeze at the strike end 0.1 s, rebound 5 cm along the strike path with a jaw jitter 0-20-0, h 0.5 | Swords meet and bounce | Verify every same-line attack pair |
| RIPOSTE | Free short cut after PARRY | From the parry pose: 0.3 s jaw slam with a 10 cm push, back to guard | Counter-snap right after the block | Hilt <= 0.27 during the push |
| EXPOSED | Cannot block next turn | Blade hanging at the side: roll 90, pitch -60, x 0.15 z 0.15, pan 25 away; held | Blade at the floor, chest open | Tip above the base plane at z 0.15 |

## 6. Flourishes / taunts (may run longer than a beat)

| Name | Use | Physical | Reads as | Reach / risk |
|---|---|---|---|---|
| IDLE_BREATHE | Waiting for locks | 3 s loop: lift +-3, elbow -+2, wrist +-2 | The arm is alive | None |
| SALUTE | Round start | Blade vertical in front of the base x 0.14 z 0.34 (0.8), h 0.6, then whip down-out to pan 30 z 0.15 (0.6) | Fencer's salute | Vertical blade fine at z 0.34 |
| TWIRL | Flourish card: skip beat, draw 2 | Jaw 30, roll -140 to +140 three times at full speed (0.9 s each way), z 0.30, pan 0 | Propeller spin (really a back-and-forth) | Keep pan 0 so the blade stays in own half |
| TAUNT_BECKON | Opponent's next block costs +1 | Blade pointed at the opponent z 0.22 pitch 0; jaw 0-25-0 twice (0.3 each) with a pan wag | "Come here" | None |
| TAP_TABLE | Impatience on the timer | x 0.20 z 0.10, roll 90, pitch -30; jaw 20-0 four times at 0.4 s | Audible tick on the table | Confirm the tip reaches the table plane |
| VICTORY | Match win | Blade vertical at z 0.45, jaw pumps 0-60-0 three times (0.4 each), then pan -50 to +50 (1.5 s) | Sword pumped overhead, then a crowd wave | Keep x <= 0.15 at z 0.45 |
| DEFEAT | Match loss | 3 s: lift forward 35, elbow folds, wrist -70, jaw to 90 so the blade dangles, pan 40 away | Head down, sword hanging | Hand z >= 0.20 so the dangling tip clears the table |
| BOW | Between rounds | Lift forward 40, wrist down 30, blade flat, h 1 s, return 1 s | A bow | Fine at x 0.18 |

## 7. Transitions

| Name | Use | Physical | Reach / risk |
|---|---|---|---|
| HOME | Power on/off, e-stop resume | Folded: lift 0, elbow max fold, wrist neutral, roll 0, jaw 0, pan 0 | Teach on the real arm; origin of every pair check |
| CHARGE | Exchange start | Gantry to 0.61 m separation while HOME to READY_HIGH, 2 s | Arm stays x <= 0.20 until the gantry stops |
| RETURN | Exchange end | READY to HOME, then gantry back, 2 s | None |
| GUARD_TO_GUARD | Filler between blocks | Any block to any block through via point x 0.22 z 0.22 pan 0, 0.6 s | Via point keeps the blade out of the middle |

## Signature combos

1. **Salute-chop**: READY_HIGH -> FEINT_HIGH -> ATTACK_HIGH. The same raise twice; the first stops dead, the second drops. The crowd learns the tell and gets the payoff, and the rules reward it (feint beats block, then the Exposed defender eats the chop).
2. **Low-low-up**: ATTACK_LOW_LR -> ATTACK_LOW_RL -> ATTACK_RISING. Two flat sweeps in opposite directions (the pan reversal is the arm's biggest motion), then the only blade that travels upward. Three attacks, three directions, no repeated silhouette.
3. **Fortress riposte**: PARRY_HIGH -> RIPOSTE -> ATTACK_THRUST. Bar, snap, straight line in. Uses the parry x2 bonus, and the thrust is the one attack that ignores a re-guard.
4. **Hammer telegraph**: WIND_UP -> ATTACK_OVERHEAD_HEAVY -> BRACE (opponent: STAGGER). A quivering vertical blade for a whole beat is the clearest tell in the set, the payoff is the largest arc, and the third beat is either the opponent's wobble or the attacker hunching to cover recovery.
5. **Matador**: SIDESTEP_L -> ATTACK_DIAGONAL_R -> TAUNT_BECKON. Off the line, a cut back across the body, then point and beckon. Reads as personality rather than rules, which is what spectators remember; the diagonal is the only cut that crosses both side-to-side and high-to-low.

## Notes for tune.py

- Express new attacks as an `end` pose plus offsets (as ATTACK_HIGH) so the whole move follows its anchor.
- First pair checks: ATTACK_THRUST vs BLOCK_HIGH, ATTACK_HIGH_SIDE vs its mirror, ATTACK_RISING vs BLOCK_LEFT/RIGHT, ATTACK_OVERHEAD_HEAVY vs BRACE.
- BLOCK_HIGH is now a flat bar, so BLOCK_POST (vertical) is the free high-guard silhouette; moves differing only in wrist pitch (BLOCK_MIDDLE vs an un-pulled-in BRACE) do not read from 3 m.
