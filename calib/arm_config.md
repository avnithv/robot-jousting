LEADER_BUS: /dev/tty.usbmodem5AE60824811
FOLLOWER_BUS: /dev/tty.usbmodem5AE60818001


Command:
lerobot-teleoperate \
    --robot.type=so101_follower \
    --robot.port=/dev/tty.usbmodem5AE60818001 \
    --robot.id=pi_bot \
    --robot.calibration_dir=calibration/robots/so_follower \
    --teleop.type=so101_leader \
    --teleop.port=/dev/tty.usbmodem5AE60824811 \
    --teleop.id=pi_leader \
    --teleop.calibration_dir=calibration/teleoperators/so_leader