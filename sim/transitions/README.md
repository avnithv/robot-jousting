# Transition library

One JSON file per (END state -> START state) handoff, named `<END>__<START>.json`, e.g. `ATTACK_HIGH__BLOCK_LEFT.json`.
States: the hubs `REST`, `MID`, `SALUTE`, `LOW_TIP`, plus each move's END pose (the move name, e.g. `ATTACK_HIGH`) and
each move's START pose (the move name, e.g. `ATTACK_HIGH`). Rows are ENDs, columns are STARTs; the END of a block is its
guard pose and its START is the same pose, the END of a feint is its pulled-back pose.

```json
{
 "from": "ATTACK_HIGH", "to": "BLOCK_LEFT",
 "paths": [
  {"name": "sweep_down", "style": "smooth",
   "via": [[0, -40, 10, 30, -90, 0], "LOW_TIP"],          // poses the arm passes through, in order (sim degrees
                                                          // [pan, lift, elbow, wrist, roll, jaw]) or hub names
   "durations": [0.35, 0.30],                              // seconds to reach each via pose; the final leg to the START pose is auto-timed
   "notes": "blade drops sideways then settles into the hanging guard"},
  {"name": "direct", "style": "plain", "via": [], "durations": []}
 ]
}
```

Rules every path must satisfy (the validator checks them): hand reach <= 0.32 m in transit, hand >= 4 cm above the base plane,
blade tip >= -8 cm, roll within -185..+100 (sim), shoulder lift >= the arm's floor, no joint faster than ~300 deg/s given the
durations. Both arms use the same library (poses are in the arm's own sim convention); the validator runs per arm.
Validate:  `../.venv/bin/python validate_transition.py transitions/ATTACK_HIGH__BLOCK_LEFT.json`  (add `--render` for a filmstrip in out/).
