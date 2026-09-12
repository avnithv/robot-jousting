# Transitions and flourishes for chained moves

Conventions as in `sim/move_params.py`: joints `[pan, lift, elbow, wrist, roll, jaw]` in degrees, sim roll (real = sim + 76), jaw 0 shut / 100 open. All numbers below were checked with `ik.fk` on straight joint-space blends (hand reach, tip height above table, peak joint delta). Timing rule used: Catmull-Rom peaks at ~1.5x the mean rate, so a blend covering D degrees needs `T >= D/200 s` to stay under the 300 deg/s cap.

## 0. Findings that affect chaining (fix before building chains)

1. **The RL family is not a true mirror.** `attack_low(mirror=True)` negates pan and roll, but the sword hangs on the offset moving jaw, so with roll -90 the tip sits ~8 cm lower: `ATTACK_LOW_RL` end tip z = 0.00, windup tip z = 0.01 (LR: 0.08 / 0.11). Anything chained *out of* an RL end pose grazes the table. Raise the RL end/windup `z` by ~0.03 in a per-side override before chaining.
2. **The 0.27 m hilt rule is already exceeded** by `ATTACK_HIGH` end (0.282) and `BLOCK_HIGH` (0.287). The hard limit is the centre line at 0.305 (bases 0.61 m apart). Transitions below are rated against 0.30; direct blends into/out of `BLOCK_HIGH` swing the hand to 0.33-0.36 and are the main reason for routing.
3. **Roll flips (+90 to -90) cost 0.9 s** and must pass through 0 (never +/-180). A flip at a low end pose dips the tip to -0.02; flips happen only at READY_MID or higher. `BLOCK_HIGH` after an RL-side move needs the mirrored bar (`pan -20, roll -90`, already noted in move_params) or it does not fit the beat.

## 1. Ready poses (hubs)

| Name | Joints `[pan, lift, elbow, wrist, roll, jaw]` | Hand x, z / tip z | Role |
|---|---|---|---|
| **EN_GARDE (EG)** | `[0, -60, 30, 20, 0, 0]` | 0.22, 0.30 / 0.28 | Between-turn stance, sword level forward. Flourish base. 0.2 s from REST-like poses. |
| **READY_MID (RM)** | `[0, -50, 60, -20, 0, 0]` | 0.25, 0.22 / 0.20 | Hub for all low-line traffic, roll flips, and entry to BLOCK_HIGH. Elbow already folded like the low poses. |
| **SALUTE/TUCK (ST)** | `[10, 20, -20, -90, r, 0]` | 0.23, 0.38 / 0.55 | Sword vertical, finger up. Exit hub from BLOCK_HIGH toward low slashes; doubles as the salute pose. `r` = incoming roll. |
| **GATE (GT)** | `[20, 10, -95, -94, r, 0]` | 0.08, 0.36 / 0.32 | Elbow tucked, hand close to base. Hub between BLOCK_HIGH and the hanging guards / EN_GARDE. |

**Route vs blend rule.** Blend directly when the straight joint-space line keeps hand reach <= 0.30 m and tip z >= 0.05 m, and max joint delta / 200 fits the next move's windup (+0.3 s). Route via a hub when either fails. In practice: every move that touches `BLOCK_HIGH` (lift +70) routes; every low-to-low move that changes roll or pitches the wrist down routes via RM; everything else blends.

**Ordering rules inside a blend** (apply to every cell below):
- Jaw closes in the first 0.1 s; opens only in the last 0.25 s, after roll has settled. Jaw > 30 with roll 0 only when lift >= -25 (arm forward), otherwise the blade swings back over the upper arm.
- Roll runs at its own pace from t = 0 (it never moves the hand), so a 90 deg roll (0.45 s) hides inside any windup.
- When the tip starts below 0.10 m (both low ends, all hanging guards), lift/elbow lead and wrist-down lags by 0.15 s.

## 2. Transition table

Start poses (windup key of the next move): **AH** = ATTACK_HIGH/FEINT_HIGH raised `[0,-20,-32,10,0,5]`; **LR** = ATTACK_LOW_LR/FEINT_LEFT windup `[-20,-55,92,-24,90,55]`; **RL** = ATTACK_LOW_RL/FEINT_RIGHT windup (mirror); **BH** = BLOCK_HIGH `[20,70,-70,-94,90,100]`; **G(s)** = hanging guard `[s*20,-40,31,31,0,0]`.
Budget = next move's windup + 0.3 s: AH 1.0, LR 1.0, RL 1.15, BH 1.1, G 1.1.
Codes: **D** direct blend; **Vx** via hub x; **R** roll-first (roll leads through 0); **HOP** via arc-over key; **MIRROR** needs BLOCK_HIGH mirrored variant; time in seconds.

| End pose family (roll) | to AH | to LR | to RL | to BH | to G(L/R/M) |
|---|---|---|---|---|---|
| **High extended slammed** `[0,-6,-32,72,0,0]` (0) | D 0.4 wrist-led pull-up (reads as recover) | D 0.7, roll 0->90 | D 0.85, roll 0->-90 | **VRM 1.1** (0.45 + 0.65); direct swings hand to 0.36 | D 0.5-0.8, wrist lags |
| **Low right slashed** (LR end) `[20,-7,68,-47,90,0]` (+90) | **VEG 0.8** (direct reaches 0.32) | **HOP 0.5** via `[0,-70,80,-40,90,0]` (sword arcs back over the line) | **VRM+R 0.9** flip at RM, jaw shut until roll settles | **VRM 1.1**, roll stays 90 | **VRM 0.75** (lift first, roll 90->0, wrist down last) |
| **Low left slashed** (RL end) (-90) | VEG 0.8 | VRM+R 0.9 | HOP 0.5 (mirror key) | **MIRROR** VRM 1.1 with BLOCK_HIGH_M; unmirrored = 1.8 s, over budget | VRM 0.75 |
| **Feint-high pulled back** `[0,-40,-32,0,0,20]` (0) | D 0.4 re-raise (the classic feint-then-chop) | D 0.7, jaw 20->0 first | D 0.85 | D 0.8 (hand 0.287) | D 0.8, wrist lags |
| **Feint-low pulled back L** `[-20,-80,92,-24,90,0]` (+90) | D 0.7 | **D 0.3 re-cock** (jaw 0->55 only) | VRM+R 0.9 | VST 0.9 (direct is 0.294, borderline) | D 0.8 |
| **Feint-low pulled back R** (-90) | D 0.7 | VRM+R 0.9 | D 0.3 re-cock | MIRROR VST 0.9 | D 0.8 |
| **High bar** (BLOCK_HIGH) (+90, jaw 100) | D 0.9, jaw shuts first 0.15 s | **VST 0.9** (direct reaches 0.31) | **OVER** 1.7 s (flip + fold): forbid, or insert one 0.6 s reset beat | hold; add bar-shake flourish | **VGT 0.95**, jaw shut then roll 90->0 in first leg |
| **Hanging guard L/R/M** `[s*20,-40,31,31,0,0]` (0) | D 0.7 | D 0.7, roll 0->90 | D 0.85, roll 0->-90 | **VGT 0.95** (direct reaches 0.33) | pan slide D 0.3-0.4 (tip stays 0.08); same side = hold |

Notes: FEINT_* start poses equal the matching ATTACK_* windups, so the FEINT columns are the LR/RL/AH columns. Every routed path above peaks at <= 0.29 m reach and keeps the tip >= 0.08 m (LR side) - the RL side inherits finding 1.

## 3. Flourishes

Servo reality: a roll twirl of +/-80 in 0.9 s is ~800 deg/s. Twirls are **+/-45 deg, 1.5 s per full out-and-back** (peak ~270). Wrist "nods" must stay small: `[10,20,-20,-60]` pushes the hand to 0.31. Any sword-down "droop" puts the tip through the table; defeat is a sag no deeper than a hanging guard.

| Flourish | Where it attaches | Joints and timing | Blends into next move |
|---|---|---|---|
| **Blade quiver** (hit landed) | Immediately after AH or AL end, before the transition | Hold end pose; jaw 0->35->0 three times at 0.12 s each, pan +/-3 in phase. 0.4 s. Roll 90 sides quiver sideways, reads as a stuck blade. | End pose unchanged, so the table applies as-is; if the next transition needs its full budget, drop to 2 flicks. |
| **Twirl** (hit landed, taunt, victory) | At EG, RM, or ST only; never at a low end | Roll 0->-45->+45->0 over 1.5 s, jaw 0. At ST it reads as a spinning vertical blade. | Finish at roll 0; the next transition's roll starts from 0 (LR/RL both 0.45 s). |
| **Guard bounce** (block succeeded) | During BLOCK_L/R/M hold | `[s*20,-40,31,31]` <-> `[s*20,-46,37,25]` twice, 0.25 s each. Hand rises 1 cm, tip rises to 0.105; the "wrong" bounce (lift up + wrist down) drops the tip to 0.01, so lift and wrist go opposite ways. | Ends on the guard pose. |
| **Bar shake** (BLOCK_HIGH succeeded) | During BLOCK_HIGH hold | pan 20->12->28->20 over 0.5 s, jaw stays 100. Reads as a shove. | Ends on the bar. |
| **Finger wag** (feint drew a block) | After FEINT_HIGH end | wrist 0->-15->+15->0 over 0.6 s with pan -10->+10; jaw stays 20; hand stays under 0.09 forward. | Ends on the feint-high pose; AH re-raise 0.4 s follows naturally. |
| **Sideways tease** (low feint drew a block) | After FEINT_LEFT/RIGHT end | pan +/-10 sweep 0.5 s with jaw 0->30->0 at roll +/-90 (sideways flick, tip stays 0.25). | Ends on the feint-low pose; re-cock into the slash. |
| **Shrug** (between turns, nothing happened) | At EG in dead time | `[0,-60,30,20]` -> `[0,-72,45,8]` -> back, 0.3 s each way, twice. Sword stays level (pitch -6 -> +3). | Ends at EG. |
| **Beckon** (taunt) | At EG | `[0,-45,20,50,0,0]` <-> `[0,-45,20,35]` three times at 0.25 s: blade dips and lifts, tip >= 0.05 (wrist 60+ hits the table). Optional pan sweep -15..+15 underneath. | Ends at EG. |
| **Salute** (pre-round) | REST -> ST 0.8 s, hold 0.6, both arms mirrored (pan +10 each) | Nod = wrist -90 -> -78 -> -90 over 0.5 s (small on purpose), then ST -> EG 0.6 s. | Ends at EG, the turn-start stance. |
| **Victory** | After the winning beat, from wherever via ST (<= 0.9 s) | ST twirl 1.5 s; then pump `[0,-30,-40,-90]` <-> `[0,0,-20,-90]` three times, 0.35 s each (blade thrusts overhead, hand under 0.13); at the top roll to 90 and jaw 0->60->0 (sideways flick); finish EG with a shrug. ~4.5 s. | Ends at EG. |
| **Defeat** | After the losing beat | Sag to a middle guard `[0,-40,31,31,0,0]` over 1.5 s (slow = sad), then roll to 90 and jaw to 40 so the blade lolls sideways (tip 0.10), pan wanders -10..+10 over 2 s, then fold to REST over 2 s with roll back to 0 first. | Ends at REST. |

Rules: flourishes never attach to a pose whose tip is below 0.10 m except the guard bounce and the blade quiver (both verified); a flourish that ends off-hub costs nothing because the table's end-pose rows still apply.

## 4. Example turns (one arm, ~1.2 s beats; the other arm runs its own chain in parallel)

**Turn A: FEINT_HIGH -> ATTACK_HIGH -> BLOCK_MIDDLE** (feint baits a block, chop lands, cover)

| t (s) | Joint target `[pan, lift, elbow, wrist, roll, jaw]` | Spectator sees |
|---|---|---|
| 0.0 | EG `[0,-60,30,20,0,0]` | En garde. |
| 0.0-0.7 | raise `[0,-20,-32,10,0,5]` | Sword rises overhead. |
| 0.7-1.05 | cock, jaw 85 | Blade cocks back. |
| 1.05-1.35 | pull back `[0,-40,-32,0,0,20]` | Jerk back: the feint. |
| 1.35-1.95 | finger wag (wrist -15/+15, pan -10/+10) | "Made you flinch." (dead time, other arm still blocking) |
| 1.95-2.35 | D 0.4 re-raise `[0,-20,-32,10,0,5]` | Re-lifts fast. |
| 2.35-2.7 | jaw 85 | Cocks. |
| 2.7-2.92 | slam `[0,-6,-32,72,0,0]` | Chop lands. |
| 2.92-3.32 | blade quiver (jaw 0/35 x3) | Blade shakes in the target. |
| 3.32-3.9 | D 0.6 to `[0,-40,31,31,0,0]` | Drops into a middle hanging guard. |
| 3.9-4.3 | hold + guard bounce | Settles, bobs twice. |
| 4.3-4.6 | EG | Back to stance. |

**Turn B: ATTACK_LOW_LR -> ATTACK_LOW_RL -> BLOCK_HIGH** (double low slash, then the bar; shows the roll flip and the mirrored bar)

| t (s) | Joint target | Spectator sees |
|---|---|---|
| 0.0-0.7 | windup `[-20,-55,92,-24,90,55]`, roll 0->90 from t=0, jaw opens 0.45-0.7 | Sword drops to the left, cocks sideways. |
| 0.7-1.1 | slash `[20,-7,68,-47,90,0]` | Low sweep left to right. |
| 1.1-1.55 | to RM `[0,-50,60,-20,90->-90 (through 0),0]` roll starting at t=1.1 | Hand lifts to mid, blade rolls over the top... |
| 1.55-2.0 | roll finishes -90; to `[20,-55,92,-24,-90,55]`, jaw opens last 0.25 | ...and drops back to the right side, cocked (0.9 s total, inside RL's 1.15 budget). |
| 2.0-2.4 | slash `[-20,-7,68,-47,-90,0]` | Backhand sweep right to left. |
| 2.4-2.85 | to RM, roll -90 held | Hand lifts. |
| 2.85-3.5 | to BLOCK_HIGH_M `[-20,70,-70,-94,-90,100]`, jaw opens 3.2-3.5 | Arm rears up, blade swings out as a level bar. |
| 3.5-3.9 | hold + bar shake (pan -20 -> -12 -> -28 -> -20) | Bar shoves. |
| 3.9-4.85 | VGT to EG (`[20,10,-95,-94,-90,0]` then EG, roll to 0 in leg 1) | Tucks in and settles. |

**Turn C: BLOCK_LEFT -> FEINT_RIGHT -> ATTACK_LOW_RL** (block, tease, punish)

| t (s) | Joint target | Spectator sees |
|---|---|---|
| 0.0-0.8 | `[-20,-40,31,31,0,0]` | Hanging guard on the left. |
| 0.8-1.2 | hold + guard bounce (opponent's attack was blocked) | Bobs twice, smug. |
| 1.2-2.05 | D 0.85 to `[20,-55,92,-24,-90,55]`, roll 0->-90 from t=1.2, lift/elbow lead, jaw opens 1.8-2.05 | Swings across to the right and cocks low. |
| 2.05-2.35 | pull back `[20,-80,92,-24,-90,0]` | Yanks back: feint. |
| 2.35-2.85 | sideways tease (pan +/-10, jaw 0/30) | Wiggles the blade. |
| 2.85-3.15 | D 0.3 re-cock, jaw 55 | Cocks again, fast. |
| 3.15-3.55 | slash `[-20,-7,68,-47,-90,0]` | Low sweep lands. |
| 3.55-3.95 | blade quiver | Blade shakes. |
| 3.95-4.7 | VRM to EG (roll -90->0 during leg 1) | Lifts, rolls the blade back on top, stance. |

Chain compiler summary: replace each move's `(REST, 0)` key with the previous end pose, look up the row/column above for the route and time, insert hub keys as extra Catmull-Rom knots, and run the existing `peak deg/s` check in `tune.py` on the stitched spline.
