"""Shared bits for talking to the real arms through LeRobot. Two arms: A = SO-100 (the one all moves were tuned on),
B = SO-101 (the opponent). Each has its own port, calibration id and roll offset (real wrist_roll reading when the sword is on top)."""
import json, os, time
import numpy as np

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
HERE = os.path.dirname(os.path.abspath(__file__))
ARMS = {
    "A": {"port": os.environ.get("ARM_PORT", "/dev/cu.usbmodem5AE60818001"), "id": os.environ.get("ARM_ID", "my_follower"), "roll_offset": 76.0, "model": "SO-100"},
    "B": {"port": os.environ.get("ARM_B_PORT", "/dev/cu.usbmodem5AE60824811"), "id": os.environ.get("ARM_B_ID", "so101_arm"), "roll_offset": None, "model": "SO-101 (leader build)"},
}
PORT, ROBOT_ID = ARMS["A"]["port"], ARMS["A"]["id"]   # backwards compatibility
POSES_REAL = os.path.join(HERE, "poses_real.json"); POSES_SIM = os.path.join(HERE, "..", "sim", "poses_v1.json")

def connect(max_relative_target=None, arm="A", hold_on_disconnect=False):
    from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
    cfg = ARMS[arm]
    robot = SO101Follower(SO101FollowerConfig(port=cfg["port"], id=cfg["id"], use_degrees=True, max_relative_target=max_relative_target,
                                              disable_torque_on_disconnect=not hold_on_disconnect))
    robot.connect(calibrate=False)   # never run LeRobot's interactive sweep (the daemon has no stdin)
    if not robot.is_calibrated:      # servos hold some other calibration (a sweep run elsewhere): write ours back, non-interactively
        print(f"arm {arm}: servo calibration differs from '{cfg['id']}' file, writing the file to the servos", flush=True)
        robot.bus.write_calibration(robot.calibration)
    return robot

def read_pose(robot):
    obs = robot.get_observation()
    return [float(obs[f"{j}.pos"]) for j in JOINTS]

def load_poses(path):
    if not os.path.exists(path): return {}
    data = json.load(open(path)); poses = data.get("poses", data)
    return {k: [float(x) for x in v] for k, v in poses.items()}

def save_poses(path, poses):
    json.dump({"poses": poses, "joints": JOINTS, "units": "degrees (lerobot use_degrees=True); gripper 0-100"}, open(path, "w"), indent=1)
