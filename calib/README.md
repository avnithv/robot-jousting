Calibration files from the colleague's teleop setup (2026-09-12). Install with:
  cp pi_bot.json ~/.cache/huggingface/lerobot/calibration/robots/so_follower/
  cp pi_leader.json ~/.cache/huggingface/lerobot/calibration/teleoperators/so_leader/
Per arm_config.md: port ...818001 = follower (SO-100, "pi_bot"), port ...824811 = leader (SO-101, "pi_leader").
The game currently drives the SO-100 with the "my_follower" calibration (different zero points), which all taught poses use.
