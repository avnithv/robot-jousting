
## Rows BLOCK_LEFT, BLOCK_RIGHT, BLOCK_MIDDLE (42 files: <END>__<START>.json for all 14 STARTs each)
All 42 files validate on both arms (validate_transition.py, 0 failures). Every file has a "direct" (via []) path where the
validator accepts it, else a fastest safe routed "plain" path, plus 1-2 styled paths; durations are sized at ~0.85x the
slower arm's need per leg (rounded up to 0.05 s) so both arms clear the too-fast check and the Catmull-Rom speed cap.

Design constraint that shaped everything: a via pose is one joint vector shared by both arms, but arm A's guards sit at
roll ~-180 (sword underneath) and arm B's at roll 0 (sword on top). A via pose near one arm's guard costs the other arm a
full 180 deg roll (~1.06 s) each way, so all styled via poses sit at roll -90 (a half-roll for BOTH arms, ~0.53 s a leg),
at roll 0 with the hand lifted, or are hubs. Consequences:
  - Guard-to-guard: "direct" pan slides (A 0.16-0.33 s, B 0.15-0.42 s) plus a "side_flick" flourish (via a lifted roll -90
    pose with jaw 40, ~1.0 s): the blade swings out sideways with a jaw flick mid-slide and drops into the new guard. A
    literal lift-up/wrist-down guard bounce is not expressible as a shared via pose (see above), so the flick stands in.
    Same-state files have "hold" (via []) + the same flick as an idle flourish.
  - Guard -> sword-on-top moves on arm A: "direct" passes the validator for REST/MID/SALUTE/ATTACK_HIGH/FEINT_HIGH/
    ATTACK_LOW_LR/FEINT_LEFT and (from BLOCK_RIGHT/BLOCK_MIDDLE) ATTACK_LOW_RL/FEINT_RIGHT. Styled "lift_then_roll" /
    "lift_first" / "side_rise" / "lift_then_swing" paths go via a lifted roll -90 pose ([s*, -50, 15..20, 10, -90, 0]) so
    the blade is clear of the board before the wrist finishes rolling; "hub_*" paths go via MID; "over_the_top" (to the
    low-left windups) goes via a lifted roll-0 level pose; "flick_fold" (to REST) is the side flick then fold.
  - LOW_TIP: direct is 0.21 s on A (same roll world) and 1.06 s on B (full roll under); styled "dip_settle" dips the tip a
    touch under the hub pose then settles.

Pairs that are safe but cannot meet ~1.2 s (geometric floors, confirmed by a 6000-pose grid search over via poses):
  - -> ATTACK_LOW_LR / FEINT_LEFT (windup roll +90): arm A must roll 270 deg (-180 -> +90; the short way crosses the -185
    wrap), 1.59 s direct, 1.43-1.49 s for the styled paths. Arm B is 0.53-0.76 s.
  - -> BLOCK_HIGH: arm A rolls 228 deg (-176 -> +52), 1.34 s floor. Direct is safe on A but overreaches (0.33-0.40 m) on
    arm B, so "plain" goes via SALUTE (A 1.24-1.29 s, B 1.27 s) and "hub_rear" via MID (~1.5 s).
  - BLOCK_LEFT -> ATTACK_LOW_RL / FEINT_RIGHT: no direct path (A: tip to -0.10 m; B: reach 0.33 m). "plain" goes via a
    lifted-back roll -90 pose [-20,-60,50,-30,-90,0] (A 0.95 s, B 1.04 s; B's second leg bounds it), "hub_swing" via MID.
Nothing was left unsafe.
