"""Shared bits for talking to the real SO-101 follower through LeRobot.
Connection settings come from the earlier hand-tracking session (hand_to_so101/teleoperate.py)."""
import json, os, time
import numpy as np

PORT = os.environ.get("ARM_PORT", "/dev/cu.usbmodem5AE60818001")   # lerobot-find-port
ROBOT_ID = os.environ.get("ARM_ID", "my_follower")                    # lerobot calibration id
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
HERE = os.path.dirname(os.path.abspath(__file__))
POSES_REAL = os.path.join(HERE, "poses_real.json")
POSES_SIM = os.path.join(HERE, "..", "sim", "poses_v1.json")

def connect(max_relative_target=None):
    from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
    robot = SO101Follower(SO101FollowerConfig(port=PORT, id=ROBOT_ID, use_degrees=True, max_relative_target=max_relative_target))
    robot.connect(calibrate=True)   # loads the saved calibration; only runs the sweep if none exists
    return robot

def read_pose(robot):
    obs = robot.get_observation()
    return [float(obs[f"{j}.pos"]) for j in JOINTS]

def load_poses(path):
    if not os.path.exists(path): return {}
    data = json.load(open(path))
    poses = data.get("poses", data)
    return {k: [float(x) for x in v] for k, v in poses.items()}

def save_poses(path, poses):
    json.dump({"poses": poses, "joints": JOINTS, "units": "degrees (lerobot use_degrees=True); gripper 0-100"}, open(path, "w"), indent=1)
