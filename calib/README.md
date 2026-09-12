# Servo calibration files (LeRobot format: homing offset + tick range per motor)

| File | Arm | Notes |
|---|---|---|
| `my_follower.json` | A, SO-100 on /dev/cu.usbmodem5AE60818001 | the calibration all arm-A moves were taught and tuned in |
| `so101_arm.json` | B, SO-101 on /dev/cu.usbmodem5AE60824811 | from the colleague's `pi_leader.json`, with the gripper range widened to 900..2800 ticks so the sword-rest finger position is representable |
| `pi_bot.json`, `pi_leader.json` | colleague's originals (teleop setup) | not used by the game; `pi_bot` is a second calibration of arm A with different zero points, do not mix |

Install (LeRobot reads them from its cache by robot id):
```
mkdir -p ~/.cache/huggingface/lerobot/calibration/robots/so_follower
cp my_follower.json so101_arm.json ~/.cache/huggingface/lerobot/calibration/robots/so_follower/
```
The game's per-arm settings (rest pose, sword-on-top roll, lift limit, jaw values, gantry) are in `arm/arms.json`;
per-arm move parameters are in `sim/params/` (A) and `sim/params_B/` (B). See `arm_config.md` for the port assignment.
