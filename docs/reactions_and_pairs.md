# Reactions and pair choreography

The layer between the rules engine ("who won this beat") and the pre-generated trajectories in `arm/motions_tuned.json`. Conventions from `sim/move_params.py`: q = `[pan, lift, elbow, wrist, roll, jaw]` degrees, x/z metres from the arm's own pan axis, hilt x <= 0.27 m (centre line at 0.305). Reaction deltas are added to whatever pose the arm is in when the reaction fires, so one definition works from any stance.

## 0. Beat layout (one clock, both arms)

ATTACK_HIGH takes 1.27 s to impact, so 1.2 s beats are too short. Recommend **BEAT = 1.4 s** with the impact frame pinned at a canonical beat time so every attack hits at the same instant and reactions align to it.

| Beat time | Event | Notes |
|---|---|---|
| 0.00 | `start` | both arms leave their stance |
| 0.55 | `guard_set` | block in place; front-pad the 0.8 s move (leave stance later, never move faster) |
| 1.00 | `impact` / `commit` | attack end key (front-pad ATTACK_LOW by 0.10 s); feint's cocked pose |
| 1.07 | `react` | defender reaction starts, 70 ms after impact (tune 50-100) |
| 1.40 | `beat_end` | reaction settled into a stance; next `start` |

Reactions get ~0.33 s. Anything longer (stagger) is a whole-beat move, which is what the rules already say.

## 1. Outcome -> choreography

**A** = attacker/feinter, **D** = defender. Timings from `react` unless noted.

| Outcome | A, this beat | D, this beat | Next beat |
|---|---|---|---|
| Hit, high line | hold impact 120 ms; `rebound`: wrist -20, lift +6, jaw 30, 200 ms; high stance | `flinch_high`: 80 ms lift +12, wrist +25, pan 10 away from the blade side; 250 ms settle to stance with lift -3 (looks rocked) | `stagger` for D if the bonus or a clean hit applies |
| Hit, low line | same `rebound` | `flinch_low` (knee buckles): 80 ms lift -10, elbow +18, wrist -20 (hand drops ~4 cm, floor z >= 0.06), jaw 40 (sword droops); 250 ms settle | as above |
| Blocked (same-line guard) | blade held at contact 150 ms, then `rebound` with wrist -30; ends one stance lower (pushed off) | `hold_and_shove`: hold 150 ms; 180 ms pan 8 toward A's blade, lift +5, jaw -10 (a rotation, x never grows); 100 ms back to guard | blocker bonus is a rules effect; guard is D's stance |
| Clash (same line) | `bind_separate`, symmetric: hold impact 200 ms with jaw +-5 at ~8 Hz (blades tremble); separate 300 ms wrist +25, lift +10, pan 12 outward; high stance | same | none |
| Both hit (different lines) | `flinch_*` for the line that hit it, scale 0.7 | same | none |
| Feint into block | cocked keys of the attack to `commit`, then `withdraw`: lift +10, wrist +15, 250 ms, ends in the opposite stance (tell) | guard, then `over_commit` = `hold_and_shove` with pan 15, lift +8, plus a 120 ms wobble (pan -4, +4). Shoving air | D is Open: D's block plays but A's attack resolves as a hit |
| Feint into attack | `flinch_high` from the cocked pose with wrist +35 (raised sword flops back) | normal `rebound` | attacker bonus on A |
| Block into block | `wary`: hold guard; two slow micro-moves pan +-3, 150 ms each | same | none |
| Hit on recover / open | as hit | `flinch_*` scale 1.3 | `stagger` if clean |
| Stagger consumed | plays its move; it lands (open opponent) | `stagger` for the whole beat | D resumes from `stagger`'s end stance |

**`stagger` (1.4 s)**: 0-0.3 s lift -18, elbow +20, wrist -25, pan 15 to own right (sways sideways and drops ~5 cm; pan reduces x, so it never nears the centre); 0.3-0.7 s pan to -12 (overshoot), jaw 50 (sword hangs); 0.7-1.1 s slow return with 4 deg lift overshoot; 1.1-1.4 s settle to low stance. Per-frame checks: hilt x <= 0.27, hand z >= 0.06, joints clipped to `arena.py` ranges. It is a sway plus a droop, never a reach.

**Clean hit** = `flinch_*` at scale 1.3, then `stagger`. No new animation.

Nine reactions total: `flinch_high`, `flinch_low`, `rebound`, `hold_and_shove`, `bind_separate`, `withdraw`, `over_commit`, `wary`, `stagger`; three are parametrised copies.

## 2. Synchronisation and representation

Both arms run on one 50 Hz clock (`pair.py` already interpolates both from t = 0). Contact reads as causal when the impact frame is at a known beat time and the defender starts 50-100 ms later: shorter looks anticipated, longer looks laggy.

Add to each `motions_tuned.json` entry:

```
"events": {"start": 0.0, "commit": 1.05, "impact": 1.27},      # attacks
"events": {"start": 0.0, "guard_set": 0.80, "hold_end": 1.20},  # blocks
"stance_in": "high", "stance_out": "high"
```

A reaction is a delta record:

```
"FLINCH_HIGH": {"trigger": "impact", "delay": 0.07, "scale": 1.0,
                "keys": [[0,0,0,0,0,0], [10,12,0,25,0,0], [0,-3,0,0,0,0]],
                "key_times": [0.0, 0.08, 0.33], "mirror_pan_from": "attacker"}
```

Beat compiler, per arm per beat:

1. Rules outcome -> (move, reaction) from the table above.
2. Front-pad the move so `impact` / `guard_set` lands on the canonical time. Never time-scale a taught move.
3. Cut at the trigger event, append reaction keys (deltas on the pose at the cut), `catmull_rom` the beat, clip jaw 0-100 and joints to range.
4. Concatenate beats; assert each move's `stance_in` equals the previous `stance_out`.
5. Run `pair.run` on the compiled pair before streaming.

Per-arm latency: the SO-100 and SO-101 sit on separate buses. Measure command-to-motion delay once per arm and store `latency_s`; the compiler subtracts it from that arm's start. A 40 ms bus difference otherwise eats half the causal gap.

## 3. Pair adjustments without combinatorial explosion

One definition per move; pairing goes through **contact targets**, each with a single approach direction.

| Target | World position (centre x = 0.305) | Approached by | Covered by |
|---|---|---|---|
| `HIGH` | centre line, z ~ 0.30 | ATTACK_HIGH (from above) | BLOCK_HIGH |
| `LOW_L` | centre line, z ~ 0.12, y = +0.08 (defender's left) | ATTACK_LOW_LR | BLOCK_LEFT, BLOCK_MIDDLE |
| `LOW_R` | mirror | ATTACK_LOW_RL | BLOCK_RIGHT, BLOCK_MIDDLE |

- Attacks are unchanged (end pose is the anchor). Requirement: at `impact` the 60 % point of the blade passes through its target; check with the existing hilt/tip sites.
- Blocks get one extra solve after `pose_search`: keep pan/pitch/tol, search x, z within +-3 cm and pan within +-8 deg so `seg_dist(A blade at impact, D blade)` equals `gap` (3 cm in v1 no-contact, 0 in v2), least travel from the base pose, hilt x <= 0.27. Store as a delta: `"contact_variants": {"ATTACK_HIGH": [dpan, dlift, delbow, dwrist, 0, 0]}`. Still one BLOCK_HIGH in the move file.

Variant count for 4 attacks x 4 blocks:

| Class | Pairs | Solves | Notes |
|---|---|---|---|
| Same line, contact | HIGH/HIGH, LEFT/LR, RIGHT/RL, MIDDLE/LR, MIDDLE/RL = 5 | **3** | RIGHT/RL and MIDDLE/RL are mirrors |
| Off line, must miss | 11 | 0 | verify `seg_dist` >= 4 cm every frame |
| Attack vs attack | 4 after mirroring | 0 | blades may pass through in sim; bind pose = both impact keys |

Three solves, five stored after mirroring, zero attack changes. A fifth block costs at most two more solves. Note BLOCK_HIGH is at x = 0.28, 1 cm over the rule; let the contact solve pull it back, never forward.

## 4. Safety in pairs

Rule 1 (existing): hilt x <= 0.27 on **every frame of every compiled beat**, reactions and stagger included; hence the shove is a pan rotation and the stagger a sway. Rule 2: hand z >= 0.06 and joints within `arena.py` ranges.

Two hilts at 0.27 leave 7 cm in x, enough for hands, but wrists, grippers and 18 cm blades have bulk. Watch list:

| Pair | Concern | Flag |
|---|---|---|
| BLOCK_HIGH vs ATTACK_HIGH | both hands high and forward; closest gripper-to-gripper case | body-body < 8 cm |
| BLOCK_MIDDLE/LEFT/RIGHT vs ATTACK_LOW_* | blade sweeps at z 0.08 under D's hand at z 0.20: blade meets the **wrist**, not the blade | blade-body < 5 cm |
| ATTACK_LOW_LR vs ATTACK_LOW_LR | sweeps in opposite world directions; hands cross laterally at equal z | body-body at the crossing frame |
| ATTACK_LOW_LR vs ATTACK_LOW_RL | parallel sweep; trailing blade can rake the leading forearm | blade-body < 5 cm |
| any `hold_and_shove` | pan sweep carries D's blade across A's gripper | blade-body < 5 cm |
| `stagger` vs any attack | attack lands into a moving arm | run every (stagger, attack) pair |

Extend `pair.py`: (1) add capsule collision geoms for forearm, wrist and gripper on both arms, blades stay sites; (2) per logged frame report blade-blade (`seg_dist`, exists), blade-body (segment to capsule) and body-body (`mj_geomDistance`); (3) thresholds: blade-blade >= 3 cm in v1 (0 in v2), blade-body >= 5 cm, body-body >= 8 cm, hilt x <= 0.27, hand z >= 0.06, joint speed under the config cap; (4) write a pass/fail matrix over all move and reaction pairs to `sim/out/pair_matrix.md`, with the failing frame time so the key can be moved in `move_params.py`. A beat streams only if its compiled pair passed.

## 5. Build order for a playable demo

| # | Reaction | Why |
|---|---|---|
| 1 | `flinch_high` | most frequent outcome; the crowd must read it instantly |
| 2 | `flinch_low` | second line, same skeleton; scaled copies cover double and undefended hits |
| 3 | `rebound` | without it the attacker freezes at impact and the hit reads as a pose |
| 4 | `hold_and_shove` | the blocked outcome; reused as `over_commit`, so it unlocks feints for free |
| 5 | `bind_separate` | the signature clash; symmetric, one definition |
| 6 | `stagger` | required by the bonus rule and the only whole-beat reaction, so it exercises stance chaining |

These six cover every cell of the attack / block / feint table: hits (1-3), blocked (3-4), clash (5), feint into block (4 plus the existing cocked keys), feint into attack (1 from the cocked pose), block into block (hold), stagger (6). `withdraw`, `wary`, clean-hit scaling, victory and defeat are polish.

First sim runs, in order: BLOCK_HIGH vs ATTACK_HIGH (contact solve, body-body), BLOCK_LEFT vs ATTACK_LOW_LR (blade-wrist), ATTACK_HIGH vs ATTACK_HIGH (bind), then `stagger` vs each attack.
