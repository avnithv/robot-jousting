"""Teleoperate a simulated robosuite UR5e with the SO-101 LeRobot leader arm.

Usage:
    # Basic — renders a Lift task, reads leader port from arm_config.md
    python run_sim.py

    # Different robosuite task
    python run_sim.py --env Stack

    # Headless (no render window)
    python run_sim.py --no-render

    # Override leader port
    python run_sim.py --leader-port /dev/tty.usbmodem5AE60824811

    # Dry-run: print joint commands without connecting to leader arm
    python run_sim.py --dry-run
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "gello_software"))

from leader_agent import LeRobotLeaderAgent
from robosuite_robot import RobosuiteURRobot


def get_leader_port_from_config() -> str | None:
    config_path = Path(__file__).parent.parent / "arm_config.md"
    if not config_path.exists():
        return None
    with open(config_path) as f:
        for line in f:
            if "LEADER_BUS:" in line:
                return line.split("LEADER_BUS:")[1].strip()
    return None


def run_loop(agent: LeRobotLeaderAgent, robot: RobosuiteURRobot, hz: int) -> None:
    dt = 1.0 / hz
    start = time.time()

    print("Control loop running. Press Ctrl+C to stop.\n")
    try:
        while True:
            obs = robot.get_observations()
            cmd = agent.act(obs)
            robot.command_joint_state(cmd)

            elapsed = time.time() - start
            print(
                f"\rTime: {elapsed:6.1f}s | "
                + "  ".join(
                    f"j{i}:{np.degrees(v):+7.1f}°"
                    for i, v in enumerate(cmd)
                ),
                end="",
                flush=True,
            )

            step_time = time.time() - (start + elapsed)
            remaining = dt - step_time
            if remaining > 0:
                time.sleep(remaining)

    except KeyboardInterrupt:
        print("\n\nStopped by user.")


def dry_run_loop(hz: int, render: bool = True) -> None:
    """Step the sim with zeros and print what the leader would send."""
    robot = RobosuiteURRobot(render=render)
    zero_cmd = np.zeros(robot.NUM_ARM_JOINTS)
    dt = 1.0 / hz
    print("Dry-run: stepping sim with zero commands. Ctrl+C to stop.\n")
    try:
        while True:
            robot.command_joint_state(zero_cmd)
            current = robot.get_joint_state()
            print(
                "\r" + "  ".join(f"j{i}:{np.degrees(v):+7.1f}°" for i, v in enumerate(current)),
                end="",
                flush=True,
            )
            time.sleep(dt)
    except KeyboardInterrupt:
        print("\nDone.")
    finally:
        robot.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="SO-101 leader → robosuite UR5e teleoperation")
    parser.add_argument("--env", default="Lift", help="Robosuite environment name (default: Lift)")
    parser.add_argument("--camera", default="frontview", help="Render camera (default: frontview)")
    parser.add_argument("--hz", type=int, default=100, help="Control frequency Hz (default: 100)")
    parser.add_argument("--leader-port", default=None, help="SO-101 serial port")
    parser.add_argument("--no-render", action="store_true", help="Disable render window")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run simulation with zero commands (no leader arm needed)",
    )
    args = parser.parse_args()

    if args.dry_run:
        dry_run_loop(args.hz, render=not args.no_render)
        return

    leader_port = args.leader_port or get_leader_port_from_config()
    if not leader_port:
        print("ERROR: No leader port. Set LEADER_BUS in arm_config.md or pass --leader-port.")
        sys.exit(1)

    print(f"Leader port : {leader_port}")
    print(f"Robosuite   : {args.env}")
    print(f"Control Hz  : {args.hz}")
    print(f"Render      : {not args.no_render}")
    print()

    print("Connecting to leader arm...")
    agent = LeRobotLeaderAgent(port=leader_port)

    print("Loading robosuite simulation...")
    robot = RobosuiteURRobot(
        env_name=args.env,
        render=not args.no_render,
        camera=args.camera,
    )

    try:
        run_loop(agent, robot, hz=args.hz)
    finally:
        agent.disconnect()
        robot.close()


if __name__ == "__main__":
    main()
