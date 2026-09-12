# Transition system design (2026-09-12)

Goal: chains of selected moves look fluid and cool, play reliably on two real arms plus a gantry, and stay faithful to
the moves the players picked. This document proposes the model, the timing rules, how flourishes and the gantry fit,
and a build order. It supersedes the "stances" question: moves keep their own start and end states; a **transition
library** connects them, and stances are just the most common states.

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **State** | A named arm pose (6 joints) plus a gantry slot. Examples: `REST`, `CHARGE` (ride-in stance), `HIGH_READY`, `LOW_READY_L/R`, and every move's end state (`ATTACK_HIGH.end`, `BLOCK_HIGH.hold`, ...). |
| **Move** | A game action the player chose. It has one or more **start variants** (each: a start state + windup keys) and exactly one **impact key** and one **end state**. The impact key is the frame the rules care about (blade lands / guard set / feint commits). |
| **Connector** | Anything that takes the arm from one state to another and has no game meaning: a plain blend, a routed blend through a hub, or a **flourish** (a connector chosen for looks). Connectors never change a move's keys or its impact time. |
| **Gantry step** | A connector for the base: a move along the rail from one slot to another with a trapezoidal profile. Slots: `FAR` (start of turn), `MID`, `NEAR` (the 2 ft clash distance). |
| **Turn** | Charge -> exchange (N beats, one move each) -> disengage. Both arms run precompiled trajectories on one clock. |

Moves and connectors live in the same trajectory format (50 Hz joint rows + a gantry column) so the player code does
not care which is which.

## 2. Timing model

One clock for both arms. Fixed `BEAT` (1.4 s) with the move's **impact pinned** at `IMPACT` (1.0 s into the beat) for
attacks and feints, and the guard pinned at `GUARD` (0.55 s) for blocks. Everything before the windup is connector time;
everything after the impact is settle time.

```
beat k:  |<---- connector window ---->|<-- windup -->|impact|<-- settle/hold -->|
         beat start                                  1.0 s                     1.4 s
```

Rules:
1. **Impact frames of the two arms coincide.** This is what makes a clash read as a clash and a block as a block.
2. **A connector must fit its window** (window = IMPACT - windup, minus a 50 ms margin). If the best-looking connector
   does not fit, pick a faster one, then a hub route, then a plain blend. Only if nothing fits does the beat stretch,
   and then it stretches for both arms (already implemented in `chain.py`).
3. **Settle time is free real estate** for reaction flourishes (quiver after a hit, guard bounce after a block) as long as
   the arm is back at the move's end state by the beat end.
4. **Gantry steps take the whole connector window** (or several beats) and never overlap an impact: the base is still
   when blades meet. A gantry step can be combined with an arm connector in the same window.
5. **Rest-to-first-move**: the charge. Both bases move `FAR -> NEAR` at full speed while the arms go `REST -> CHARGE`
   (sword forward). The exchange clock starts when both bases report stopped (or at the planned arrival time + margin).
6. **Disengage**: after the last beat, both go to `REST` and `FAR`. A "victory" or "defeat" flourish can replace the
   arm part of the disengage.

## 3. Choosing connectors

For each gap (end state of move i -> start state of move i+1) the compiler builds a candidate list:

1. Flourishes tagged for that (from, to) pair, or for (from, *) / (*, to), from `sim/flourishes.json`.
2. Explicit routes from `sim/transitions.json` (hub paths; already there).
3. A plain direct blend (validated for reach, table, wrap).
4. Automatic route via `READY_MID`.

Score = fits_window * (weight + variety bonus) where the variety bonus penalises the flourish used in the previous gap
and in the opponent's same beat. Selection is deterministic given the turn seed, so a replay is identical and the game
server can show what will happen. The player never sees a connector on the reveal screen; only the moves.

Faithfulness guarantees: connectors cannot move the impact key, change the end state, or alter any move key. They can
only fill the connector window and the settle window. A flourish that would violate the safety checks is dropped, not
bent.

## 4. Start variants (moves with several starting states)

Most moves have one start variant: from the previous end state, the connector goes to the move's windup key. A few
moves benefit from a second variant that skips work when the arm is already close:

| Move | Extra start variant | Saves |
|---|---|---|
| ATTACK_HIGH | from `HIGH_READY` (already raised and cocked): windup = cock only | ~0.5 s |
| ATTACK_LOW_LR | from `LOW_READY_L` (already low on the left, sword cocked sideways): windup = none | ~0.6 s |
| BLOCK_LEFT/RIGHT/MIDDLE | from any hanging guard: pan slide only | ~0.5 s |
| FEINT_* | same variants as their attacks | same |

The compiler picks the variant whose start state matches the current state within a tolerance, else the default
variant via a connector. Variants share the impact key and end state, so the rules are unaffected.

## 5. Gantry as a game dimension

Distance changes whether an attack connects. Three slots keep it simple and safe:

| Slot | Base separation | Meaning |
|---|---|---|
| NEAR | 0.61 m (2 ft) | Normal clash distance. Everything reaches. |
| MID | 0.61 + 0.10 m | Only attacks with a **step-in** reach. Blocks are safe. |
| FAR | 0.61 + 0.25 m+ | Out of range. Used at the start/end of a turn. |

Design options for the rules (pick later): (a) each move carries an optional gantry modifier chosen by the player
(`+step in`, `+step back`) as a card cost; (b) the gantry is automatic choreography only (looks cool, no rules effect).
Recommendation: start with (b) for the first live test, then add (a) as a "lunge" and "retreat" modifier because it
gives the rules table a distance axis without adding moves.

Safety on the rail: the two carriages never both move inward in the same window past NEAR; the clash distance is a
hard software floor; a step-in is at most one slot per beat; carriage speed capped so a step fits a 0.5 s window.

## 6. Reliability

- **Everything precompiled per turn**: both arms' joint trajectories and both gantry profiles on the shared clock,
  before anything moves. No live decisions during the exchange.
- **Sim gate**: `pair.py` runs the compiled turn with both arms and reports blade-blade, blade-arm and arm-arm distances
  per beat. Arm-arm or blade-arm below threshold -> the turn is rejected and a safer connector/variant is tried.
- **Servo margins**: speed cap per joint, roll wrap margins, the shoulder-lift floor, and the centre-line rule are
  checked on every sample (already in `tune.py` / `chain.py`).
- **Timing on hardware**: the two arms sit on separate USB buses; measure each arm's command-to-motion latency once and
  subtract it, or the impact frames drift by tens of ms.
- **Abort** stays available at every level (single arm, both, gantry).

## 7. Flourish library (first entries)

| Name | From -> To | Window | Looks like |
|---|---|---|---|
| `twirl_up` | any high end -> HIGH_READY | 0.6 s | roll +/-45 back-and-forth while re-cocking |
| `low_sweep_reset` | low slash end -> LOW_READY (other side) | 0.7 s | blade skims across at the low line, jaw flick |
| `guard_slide` | hanging guard -> other hanging guard | 0.4 s | pan slide with a small bounce |
| `bar_shake` | BLOCK_HIGH hold (settle) | 0.4 s | pan wobble while holding the bar |
| `quiver` | attack impact (settle) | 0.4 s | jaw 0-30-0 x3, reads as blade stuck |
| `charge_stance` | REST -> CHARGE | ride-in | sword forward, small bob per gantry metre |
| `salute` | REST (pre-turn) | 1.5 s | vertical blade, nod |
| `victory` / `defeat` | last end -> REST | 3-4 s | pump + wave / sag |

Each is a JSON entry: `{from, to, keys, key_times, weight, tags, settle_only}`; the compiler treats them as connectors.

## 8. Build order

1. State registry: name the end states of the ten moves and the four hubs; give each move `start_state(s)`,
   `impact_index`, `end_state` in its params (mostly derivable from the recipes).
2. Connector selection in `chain.py` (candidate list + window fit + variety), flourishes as a JSON library; keep the
   current hub routes as the fallback.
3. Gantry column: add a 7th trajectory column, slots, trapezoidal steps, charge and disengage; a `gantry` adapter in
   the daemon with a stub that logs until the hardware interface is known.
4. Sim: add a slide joint per base in `arena.py` so the gantry shows in the pair renders and the collision gate.
5. Studio: a turn builder (moves + optional step modifiers per beat, seed), preview both arms, play both.
6. Start variants for the four moves in section 4; latency calibration on hardware.
