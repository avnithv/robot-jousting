
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

## Rows REST, MID, SALUTE, LOW_TIP (56 files: <END>__<START>.json for all 14 STARTs each)
All 56 files validate on both arms (validate_transition.py, 0 failures; filmstrips checked for the styled paths). Every file has
"direct" (via []) where the validator accepts it on both arms, else the fastest safe routed "plain" path, plus 1-2 styled
paths. Via-leg durations are the slower arm's seg_time rounded up to 0.05 s (idle flourishes get a little extra so they read).

REST -> move (the charge-in handoffs), all read as coming up out of the folded rest into the windup:
  - -> ATTACK_HIGH / FEINT_HIGH: "salute_rise" (via SALUTE, 0.64 s: blade snaps up vertical then tilts forward into the raised
    windup) and "uncoil" (via [-2,-76,2,10,0,5], 0.55 s: forearm flicks the blade up first, shoulder follows).
  - -> ATTACK_LOW_LR / FEINT_LEFT: "roll_then_drop" (blade turns flat sideways while still folded, then the arm swings down-left
    and cocks, 0.80 s) and "wag_in" (overshoots the mark on the left and eases back in, 0.70 s).
  - -> ATTACK_LOW_RL / FEINT_RIGHT: "through_mid" (via MID, roll -45 is on the way; A 0.64 / B 0.84 s) and "roll_then_drop"
    (A 0.88 / B 1.11 s).
  - -> BLOCK_HIGH: "salute_bar" (via SALUTE; A 0.79 / B 1.10 s, B's bar needs a 110 deg lift).
  - -> BLOCK_LEFT/RIGHT/MIDDLE: "through_mid" and "swing_out_*" (via a lifted roll -90 pose: arm swings out with the blade
    sideways, then the blade flops into the guard). ~1.06 s on A because A's guards sit at roll ~-180 (a full roll from rest);
    B is 0.26-0.6 s direct. The roll -90 via is a half-roll for both arms so neither pays a detour.
  - REST -> REST: "hold" + "look_around" (pan -10/+10 wag while folded). No jaw flicks at rest (blade would swing over the arm).
MID -> X: direct everywhere (0.26-0.80 s). Styled: "salute_rise" to the high windups, "wag_in" overshoots to the low windups,
  "salute_bar" to BLOCK_HIGH, "swing_out_*" to the guards, "roll_then_dip" to LOW_TIP, "flick_up" past vertical to SALUTE,
  "twirl" idle (roll -80/-10) for MID -> MID. MID -> REST is direct only (0.27 s, too short to style).
SALUTE -> X: direct everywhere. Styled: "nod_raise" (small wrist nod then tilt forward) to the high windups, "roll_drop" to the
  left windups, "through_mid" to the right windups and LOW_TIP, "pan_over" to BLOCK_HIGH, "swing_out_*" to the guards,
  "twirl_down" to MID, "nod_and_fold" to REST; SALUTE -> SALUTE has "hold", "nod" and "twirl" (roll -35/+35, 1.0 s).
LOW_TIP -> X (blade underneath, roll -180, tip on the floor): direct everywhere except BLOCK_HIGH. Styled: "scoop_up" to the
  high windups (via [0,-60,10,20,-90,0], blade rolls back on top as it rises), "lift_roll_over" to the left windups, "wag_in"
  to the right windups, "lift_then_roll" to MID, "through_mid" to REST/SALUTE, "drag_*"/"lift_settle" to the guards (via a
  roll -135 pose so A pays 0.27 s a leg and B, whose guards are roll 0, is not slowed), "floor_sweep" idle (pan -10/+10).

Pairs that are safe but cannot meet ~1.2 s (roll geometry, no via pose can shorten them):
  - LOW_TIP -> ATTACK_LOW_LR / FEINT_LEFT: 270 deg roll (-180 -> +90) on both arms, 1.59 s direct and styled.
  - LOW_TIP -> BLOCK_HIGH: direct is safe on A (1.37 s) but unsafe on B (straight line overreaches), so "plain" goes via MID
    (A 1.37 / B 1.59 s; B's bar is at roll +90, i.e. a 270 deg roll). No second styled path: everything is > 1.4 s.
  - LOW_TIP -> REST / SALUTE / ATTACK_HIGH and REST/SALUTE -> LOW_TIP: 180 deg roll, 1.06-1.19 s, at the budget.
Nothing was left unsafe. No other files were edited.

## ENDs ATTACK_HIGH, FEINT_HIGH, BLOCK_HIGH (42 files) — 2026-09-12
All 42 files pass validate_transition.py for both arms (arm B's BLOCK_RIGHT params changed mid-session; revalidated after).
- ATTACK_HIGH -> *: `direct` everywhere except ATTACK_LOW_RL/FEINT_RIGHT (straight blend overreaches 0.35 m on arm B -> `plain` via MID) and BLOCK_HIGH (overreaches on both arms -> `plain` via the raised cocked pose [0,-34,-32,17,0,5]). Styled: `recoil_roll` (recoil up to [0,-25,-32,30,-90,0], roll while high, then drop) into LOW_TIP and the three hanging guards (~1.08 s); `recoil_fold` (elbow folds with the blade flipped to +/-90) into the low windups (~1.0 s); `quiver` jaw-flick (0.12 s x2) before short handoffs; `salute_bar` / `salute_recock` via SALUTE.
- FEINT_HIGH -> *: `direct` everywhere (the 0.15 s re-raise into ATTACK_HIGH is the feint-then-chop). Styled: `wag` finger-wag (pan/wrist waggle, small on purpose so the hand stays under 0.22 m); `roll_then_drop` into LOW_TIP/guards; `fold_left`/`fold_right` and `salute_drop`/`hub_drop` into the low windups; `salute_bar` into BLOCK_HIGH.
- BLOCK_HIGH -> *: `direct` for REST/MID/SALUTE/high moves/low windups/BLOCK_MIDDLE; `plain` routes where the straight blend fails on arm B: LOW_TIP via MID, BLOCK_LEFT and BLOCK_RIGHT via a lifted half-rolled pose [0,-30,-20,0,-45,30]. Styled: `bar_lift` hold flourish, `roll_over` into SALUTE, `flat_first` into the right windup, `high_roll` into LOW_TIP, `up_roll` into BLOCK_MIDDLE, salute lifts elsewhere.
- Over the ~1.2 s target (roll-limited, no safe faster route exists at 170 deg/s): BLOCK_HIGH -> LOW_TIP 1.39 s (arm B's bar is roll +90 and LOW_TIP is -180: 270 deg of roll through 0), BLOCK_HIGH -> BLOCK_LEFT/RIGHT/MIDDLE 1.22-1.40 s (arm A's guards are roll -180 vs the bar's +52; arm B's wrist travels ~200 deg). ATTACK_HIGH -> BLOCK_MIDDLE `drop_guard` (via MID) is 1.23 s on arm A. Nothing was left unsafe.
- Note for the library: arm A's guards are sword-underneath (roll ~-180) while arm B's are sword-on-top (roll 0), so the roll-first styled paths read as a recoil-and-roll on A and as a sideways flick-and-back on B; both validate.
