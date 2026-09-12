# Collision intent matrix

Designed from what each move is, not from simulated distances (see `collision_matrix.md` for the sim version). Arm A = rows, arm B = columns. The arms face each other, so sides are named once, from A's view: **L** = A's left = B's right, **R** = A's right = B's left, **C** = centre. Each arm's sweep from its own left to its own right therefore lands on the opponent's left: A's ATTACK_LOW_LR ends on R and is covered by B's BLOCK_LEFT, A's ATTACK_LOW_RL ends on L and is covered by B's BLOCK_RIGHT, BLOCK_MIDDLE covers both; B's sweeps mirror. BLOCK_HIGH's hand sits at the arm's own right with the bar across C. Rules: attack beats feint, feint beats block, block beats attack, two attacks both land, same line clashes.

Cell = the intended **visual** outcome: `swords` (blades meet), `A taps B` / `B taps A` (a landed attack visibly touches the other arm), `both tap`, `miss` (nothing touches). Where the rules say an attack lands but nothing is under the blade, the cell is `miss` and the defender's flinch sells the hit. Counts: 21 swords, 2 taps, 77 miss, 0 both-tap (no pair puts both arms under both blades).

Two facts drive the table. (1) The chop lands at C at about guard-hand height, so the only body it can ever reach is a centre hanging guard's sword hand; a low sweep passes ~15 cm under a raised chopping arm and a chop lands ~9 cm beside a side guard. (2) With both hilts at <= 0.27 m and 18 cm blades, every low sweep passes through the opponent's low-hand zone (x_opp 0.16-0.27 at hand height). A sweep therefore never taps a forearm cleanly: it either meets a blade (guard, bind, cocked feint) or must pass **under** the opponent's gripper. That is the "band" rule below and the one thing no end pose can fix.

| A \ B | ATTACK_HIGH | ATTACK_LOW_LR | ATTACK_LOW_RL | FEINT_HIGH | FEINT_LEFT | FEINT_RIGHT | BLOCK_HIGH | BLOCK_LEFT | BLOCK_RIGHT | BLOCK_MIDDLE |
|---|---|---|---|---|---|---|---|---|---|---|
| **ATTACK_HIGH** | **swords**<br><sub>high bind</sub> | miss<br><sub>chop above, sweep below; both land by rule</sub> | miss<br><sub>chop above, sweep below; both land by rule</sub> | **swords**<br><sub>feint blade meets landed chop</sub> | miss<br><sub>different heights</sub> | miss<br><sub>different heights</sub> | **swords**<br><sub>bar catches chop</sub> | miss<br><sub>chop lands beside the guard, in air</sub> | miss<br><sub>chop lands beside the guard, in air</sub> | **A taps B**<br><sub>chop tip on the guard hand</sub> |
| **ATTACK_LOW_LR** | miss<br><sub>chop above, sweep below; both land by rule</sub> | **swords**<br><sub>cross mid-sweep, both land</sub> | **swords**<br><sub>low bind, side R</sub> | miss<br><sub>different heights</sub> | **swords**<br><sub>sweep brushes cocked feint blade</sub> | miss<br><sub>feint on the sweep's start side</sub> | miss<br><sub>sweep under the bar</sub> | **swords**<br><sub>guard on the sweep's line (R)</sub> | miss<br><sub>guard on the sweep's start side</sub> | **swords**<br><sub>guard intercepts sweep</sub> |
| **ATTACK_LOW_RL** | miss<br><sub>chop above, sweep below; both land by rule</sub> | **swords**<br><sub>low bind, side L</sub> | **swords**<br><sub>cross mid-sweep, both land</sub> | miss<br><sub>different heights</sub> | miss<br><sub>feint on the sweep's start side</sub> | **swords**<br><sub>sweep brushes cocked feint blade</sub> | miss<br><sub>sweep under the bar</sub> | miss<br><sub>guard on the sweep's start side</sub> | **swords**<br><sub>guard on the sweep's line (L)</sub> | **swords**<br><sub>guard intercepts sweep</sub> |
| **FEINT_HIGH** | **swords**<br><sub>feint blade meets landed chop</sub> | miss<br><sub>different heights</sub> | miss<br><sub>different heights</sub> | miss<br><sub>both stop short</sub> | miss | miss | miss<br><sub>feint stops short of the guard</sub> | miss | miss | miss<br><sub>feint stops short of the guard</sub> |
| **FEINT_LEFT** | miss<br><sub>different heights</sub> | **swords**<br><sub>sweep brushes cocked feint blade</sub> | miss<br><sub>feint on the sweep's start side</sub> | miss | miss | miss<br><sub>both stop short</sub> | miss | miss | miss<br><sub>feint stops short of the guard</sub> | miss<br><sub>feint stops short of the guard</sub> |
| **FEINT_RIGHT** | miss<br><sub>different heights</sub> | miss<br><sub>feint on the sweep's start side</sub> | **swords**<br><sub>sweep brushes cocked feint blade</sub> | miss | miss<br><sub>both stop short</sub> | miss | miss | miss<br><sub>feint stops short of the guard</sub> | miss | miss<br><sub>feint stops short of the guard</sub> |
| **BLOCK_HIGH** | **swords**<br><sub>bar catches chop</sub> | miss<br><sub>sweep under the bar</sub> | miss<br><sub>sweep under the bar</sub> | miss<br><sub>feint stops short of the guard</sub> | miss | miss | miss<br><sub>bars parallel, ~5 cm</sub> | miss | miss | miss |
| **BLOCK_LEFT** | miss<br><sub>chop lands beside the guard, in air</sub> | **swords**<br><sub>guard on the sweep's line (L)</sub> | miss<br><sub>guard on the sweep's start side</sub> | miss | miss | miss<br><sub>feint stops short of the guard</sub> | miss | miss | miss<br><sub>hanging blades nose to nose</sub> | miss<br><sub>hanging blades nose to nose</sub> |
| **BLOCK_RIGHT** | miss<br><sub>chop lands beside the guard, in air</sub> | miss<br><sub>guard on the sweep's start side</sub> | **swords**<br><sub>guard on the sweep's line (R)</sub> | miss | miss<br><sub>feint stops short of the guard</sub> | miss | miss | miss<br><sub>hanging blades nose to nose</sub> | miss | miss<br><sub>hanging blades nose to nose</sub> |
| **BLOCK_MIDDLE** | **B taps A**<br><sub>chop tip on the guard hand</sub> | **swords**<br><sub>guard intercepts sweep</sub> | **swords**<br><sub>guard intercepts sweep</sub> | miss<br><sub>feint stops short of the guard</sub> | miss<br><sub>feint stops short of the guard</sub> | miss<br><sub>feint stops short of the guard</sub> | miss | miss<br><sub>hanging blades nose to nose</sub> | miss<br><sub>hanging blades nose to nose</sub> | miss<br><sub>hanging blades nose to nose</sub> |

## End poses to calibrate by hand

One calibrated pose per group; each covers every cell listed. `end@X` = a contact variant of that end pose stored for opponent move X (as in `reactions_and_pairs.md`), `stop` = a feint's stop/retreat pose, `band` = a low sweep's hand height and blade pitch. Do the groups in this order; C1 and C5 are anchors that the others depend on.

**C1. ATTACK_HIGH end (anchor) vs BLOCK_MIDDLE guard hand: tip stops on the top of the gripper (0-1 cm), never drives down.**  
Cells (2): ATTACK_HIGH vs BLOCK_MIDDLE, BLOCK_MIDDLE vs ATTACK_HIGH.

**C2. BLOCK_HIGH contact variant vs the opponent's ATTACK_HIGH end: bar just touches the final blade mid-blade; grippers >= 8 cm apart.**  
Cells (2): ATTACK_HIGH vs BLOCK_HIGH, BLOCK_HIGH vs ATTACK_HIGH.

**C3. High bind: both ATTACK_HIGH ends together: blades cross mid-blade over the centre, hilts >= 8 cm; shorten both slams equally if not.**  
Cells (1): ATTACK_HIGH vs ATTACK_HIGH.

**C4. FEINT_HIGH stop pose: (a) meets the opponent's landed ATTACK_HIGH blade flat and light; (b) stops >= 3 cm above BLOCK_HIGH's bar, a centre guard hand and the mirror feint.**  
Cells (7): ATTACK_HIGH vs FEINT_HIGH, FEINT_HIGH vs ATTACK_HIGH, FEINT_HIGH vs FEINT_HIGH, FEINT_HIGH vs BLOCK_HIGH, FEINT_HIGH vs BLOCK_MIDDLE, BLOCK_HIGH vs FEINT_HIGH, BLOCK_MIDDLE vs FEINT_HIGH.

**C5. Low-sweep band (ATTACK_LOW_LR/RL hand z + blade pitch, windup included): blade passes >= 2 cm under the opponent's low gripper at every bearing (opponent ATTACK_LOW_* ends, FEINT_LEFT/RIGHT stops).**  
Cells (10): ATTACK_LOW_LR vs ATTACK_LOW_LR, ATTACK_LOW_LR vs FEINT_LEFT, ATTACK_LOW_LR vs FEINT_RIGHT, ATTACK_LOW_RL vs ATTACK_LOW_RL, ATTACK_LOW_RL vs FEINT_LEFT, ATTACK_LOW_RL vs FEINT_RIGHT, FEINT_LEFT vs ATTACK_LOW_LR, FEINT_LEFT vs ATTACK_LOW_RL, FEINT_RIGHT vs ATTACK_LOW_LR, FEINT_RIGHT vs ATTACK_LOW_RL.

**C6. Low sweep into its guard: ATTACK_LOW_LR end pan vs opponent BLOCK_LEFT and BLOCK_MIDDLE stops 2-3 cm before the hanging blade; the guard's contact variant hangs its blade so it crosses the sweep line >= 6 cm ahead of the attacker's hilt (this also clears the windup on the off side and keeps two same-side guards >= 4 cm apart). ATTACK_LOW_RL vs BLOCK_RIGHT/MIDDLE by mirror, then verified.**  
Cells (19): ATTACK_LOW_LR vs BLOCK_LEFT, ATTACK_LOW_LR vs BLOCK_RIGHT, ATTACK_LOW_LR vs BLOCK_MIDDLE, ATTACK_LOW_RL vs BLOCK_LEFT, ATTACK_LOW_RL vs BLOCK_RIGHT, ATTACK_LOW_RL vs BLOCK_MIDDLE, BLOCK_LEFT vs ATTACK_LOW_LR, BLOCK_LEFT vs ATTACK_LOW_RL, BLOCK_LEFT vs BLOCK_RIGHT, BLOCK_LEFT vs BLOCK_MIDDLE, BLOCK_RIGHT vs ATTACK_LOW_LR, BLOCK_RIGHT vs ATTACK_LOW_RL, BLOCK_RIGHT vs BLOCK_LEFT, BLOCK_RIGHT vs BLOCK_MIDDLE, BLOCK_MIDDLE vs ATTACK_LOW_LR, BLOCK_MIDDLE vs ATTACK_LOW_RL, BLOCK_MIDDLE vs BLOCK_LEFT, BLOCK_MIDDLE vs BLOCK_RIGHT, BLOCK_MIDDLE vs BLOCK_MIDDLE.

**C7. Low bind: ATTACK_LOW_LR end vs the opponent's ATTACK_LOW_RL end on the same side: both stop ~5 deg short so the blades cross mid-blade, hilts >= 8 cm.**  
Cells (2): ATTACK_LOW_LR vs ATTACK_LOW_RL, ATTACK_LOW_RL vs ATTACK_LOW_LR.

**C8. Crossing sweeps (no end pose): the crossing frame of two opposite low sweeps; C5 keeps the blades off the grippers, the blades brush flat at the centre; lengthen t_slash on both if the brush is hard.**  
Cells (2): ATTACK_LOW_LR vs ATTACK_LOW_LR, ATTACK_LOW_RL vs ATTACK_LOW_RL.

**C9. FEINT_LEFT/RIGHT stop pose: (a) cocked blade placed so the opponent's same-side sweep brushes its flat in the last 2-3 deg; (b) >= 3 cm clear of the guard on its line and of the mirror feint on the same side. FEINT_RIGHT by mirror.**  
Cells (14): ATTACK_LOW_LR vs FEINT_LEFT, ATTACK_LOW_RL vs FEINT_RIGHT, FEINT_LEFT vs ATTACK_LOW_LR, FEINT_LEFT vs FEINT_RIGHT, FEINT_LEFT vs BLOCK_RIGHT, FEINT_LEFT vs BLOCK_MIDDLE, FEINT_RIGHT vs ATTACK_LOW_RL, FEINT_RIGHT vs FEINT_LEFT, FEINT_RIGHT vs BLOCK_LEFT, FEINT_RIGHT vs BLOCK_MIDDLE, BLOCK_LEFT vs FEINT_RIGHT, BLOCK_RIGHT vs FEINT_LEFT, BLOCK_MIDDLE vs FEINT_LEFT, BLOCK_MIDDLE vs FEINT_RIGHT.

**C10. BLOCK_HIGH vs BLOCK_HIGH: two level bars, parallel, ~5 cm apart in x: verify >= 3 cm.**  
Cells (1): BLOCK_HIGH vs BLOCK_HIGH.

### Notes and limits

- Every touching cell is blade-on-blade except C1 (chop tip on the guard hand). Keep it that way: a sweep whose commanded end lies past a hanging guard or a gripper stalls the servo into it, which is a strike, hence the "stop 2-3 cm short" variants in C6/C7 rather than relying on the guard to absorb the sweep.
- C5 is the safety-critical one. If the blade cannot be kept under the opponent's low gripper by hand height and pitch alone (nothing below the base plane), the alternatives are a per-arm low-line height offset (params_B) or a longer t_slash for the four sweep-vs-sweep cells. The crossing cells (C8) are the only ones where contact happens mid-move, not at an end pose.
- Chop vs low sweep is a `miss` in v1. An ATTACK_HIGH end-pan variant of ~15 deg toward the sweeper would let the chop tap the sweeper's forearm; not worth a variant until the anchors above are in.
- The sim matrix flags far more contacts (82 pairs) because it measures every frame from rest; this table states what the pair should look like at the beat's impact, and the calibration groups are what make the sim agree.
