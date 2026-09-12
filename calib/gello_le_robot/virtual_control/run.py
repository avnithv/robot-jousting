"""Teleoperate a UR5 with the SO-101 LeRobot leader arm via GELLO's control loop.

Usage:
    # Dry-run: print UR5 joint commands without connecting to the robot
    python run.py --dry-run

    # Live run with default UR5 IP
    python run.py --ur-ip 192.168.1.10

    # Fix wrist_3 at zero and don't use the gripper channel
    python run.py --ur-ip 192.168.1.10 --fix-last-joint

    # Override leader port (otherwise read from arm_config.md)
    python run.py --ur-ip 192.168.1.10 --leader-port /dev/tty.usbmodem5AE60824811
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "gello_software"))

from gello.env import RobotEnv
from gello.robots.robot import PrintRobot
from gello.robots.ur import URRobot
from gello.utils.control_utils import run_control_loop

from leader_agent import LeRobotLeaderAgent


def get_leader_port_from_config() -> str | None:
    config_path = Path(__file__).parent.parent / "arm_config.md"
    if not config_path.exists():
        return None
    with open(config_path) as f:
        for line in f:
            if "LEADER_BUS:" in line:
                return line.split("LEADER_BUS:")[1].strip()
    return None


def gradual_move_to_start(env: RobotEnv, agent: LeRobotLeaderAgent) -> bool:
    """Gradually move the robot to match the leader's current position.

    Returns False if the required movement is dangerously large.
    """
    start_pos = agent.act(env.get_obs())
    curr_joints = env.get_obs()["joint_positions"]

    abs_deltas = np.abs(start_pos - curr_joints)
    max_delta = abs_deltas.max()

    print(f"Max joint delta to leader position: {np.degrees(max_delta):.1f}°")

    # Refuse if any joint needs to move more than ~57° (1 rad)
    if max_delta > 1.0:
        print(
            "ERROR: Too far from leader position — move the leader arm to roughly "
            "match the robot's current pose before starting, then retry."
        )
        for i, (d, s, c) in enumerate(zip(abs_deltas, start_pos, curr_joints)):
            if d > 0.1:
                print(
                    f"  joint[{i}]: leader={np.degrees(s):.1f}°  "
                    f"robot={np.degrees(c):.1f}°  Δ={np.degrees(d):.1f}°"
                )
        return False

    steps = max(int(max_delta / 0.005), 20)
    print(f"Moving to start position over {steps} steps...")
    for jnt in np.linspace(curr_joints, start_pos, steps):
        env.step(jnt)
        time.sleep(0.002)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="SO-101 leader → UR5 teleoperation")
    parser.add_argument("--ur-ip", default="192.168.1.10", help="UR5 IP address")
    parser.add_argument(
        "--leader-port",
        default=None,
        help="SO-101 serial port (default: read from arm_config.md)",
    )
    parser.add_argument(
        "--hz", type=int, default=100, help="Control frequency in Hz (default: 100)"
    )
    parser.add_argument(
        "--fix-last-joint",
        action="store_true",
        help="Hold UR5 wrist_3 fixed at 0 and ignore SO-101 gripper channel",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print joint commands instead of connecting to the UR5",
    )
    args = parser.parse_args()

    # Resolve leader port
    leader_port = args.leader_port or get_leader_port_from_config()
    if not leader_port:
        print("ERROR: No leader port found. Set LEADER_BUS in arm_config.md or pass --leader-port.")
        sys.exit(1)

    print(f"Leader port : {leader_port}")
    print(f"UR5 IP      : {args.ur_ip}")
    print(f"Control Hz  : {args.hz}")
    print(f"Fix wrist_3 : {args.fix_last_joint}")
    print(f"Dry run     : {args.dry_run}")
    print()

    # Connect leader arm
    agent = LeRobotLeaderAgent(
        port=leader_port,
        fix_last_joint=args.fix_last_joint,
    )

    # Connect robot (or mock)
    if args.dry_run:
        print("Dry-run mode: using PrintRobot (no UR5 connection).")
        robot = PrintRobot(num_dofs=6, dont_print=False)
    else:
        print(f"Connecting to UR5 at {args.ur_ip}...")
        robot = URRobot(robot_ip=args.ur_ip, no_gripper=True)

    env = RobotEnv(robot, control_rate_hz=args.hz)

    if args.dry_run:
        print("\nStreaming leader → UR5 joint mapping (radians). Ctrl+C to stop.\n")
        try:
            while True:
                obs = env.get_obs()
                cmd = agent.act(obs)
                labels = ["pan", "lift", "elbow", "wrist1", "wrist2", "wrist3"]
                line = "  ".join(f"{l}:{np.degrees(v):+7.1f}°" for l, v in zip(labels, cmd))
                print(f"\r{line}", end="", flush=True)
                time.sleep(1.0 / args.hz)
        except KeyboardInterrupt:
            print("\nStopping dry run.")
        finally:
            agent.disconnect()
        return

    # Live run
    if not gradual_move_to_start(env, agent):
        agent.disconnect()
        sys.exit(1)

    print("\nStarting control loop. Press Ctrl+C to stop.\n")
    try:
        run_control_loop(env, agent)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    finally:
        agent.disconnect()


if __name__ == "__main__":
    main()
