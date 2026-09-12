"""Play poses or move chains on the real arm, slowly, with a speed cap.

    python ~/game/arm/play.py --list                        # show poses and moves
    python ~/game/arm/play.py --pose STANCE_HIGH            # dry run: prints the plan only
    python ~/game/arm/play.py --pose STANCE_HIGH --go       # actually move
    python ~/game/arm/play.py --chain attack_high block_low attack_low --go
    python ~/game/arm/play.py --sim --pose STANCE_HIGH --go # use the sim's poses_v1.json instead of taught poses

Safety: joint speed capped by --speed (deg/s, default 90); every command step is also limited by lerobot's
max_relative_target (default 8 deg). Keep the e-stop / power switch in reach. Start at --speed 60."""
import argparse, time, sys, os
import numpy as np
from common import connect, read_pose, load_poses, POSES_REAL, POSES_SIM, JOINTS

MOVES = {   # sequences of (pose name, nominal seconds). First version, mirrors sim/moves_v1.py.
    "attack_high": [("WINDUP_HIGH", 0.5), ("STRIKE_HIGH", 0.4), ("STANCE_HIGH", 0.5)],
    "attack_low":  [("WINDUP_LOW", 0.5),  ("STRIKE_LOW", 0.4),  ("STANCE_LOW", 0.5)],
    "block_high":  [("BLOCK_HIGH", 0.4),  ("BLOCK_HIGH", 0.5),  ("STANCE_HIGH", 0.4)],
    "block_low":   [("BLOCK_LOW", 0.4),   ("BLOCK_LOW", 0.5),   ("STANCE_LOW", 0.4)],
}
RATE = 50.0

def interpolate_to(robot, target, speed, gripper=None, hold=0.0):
    cur = np.array(read_pose(robot)); tgt = np.array(target, float)
    if gripper is not None: tgt[5] = gripper
    dur = max(float(np.max(np.abs(tgt[:5] - cur[:5])) / speed), 0.05)
    n = int(dur * RATE)
    for i in range(1, n + 1):
        a = i / n; a = 0.5 - 0.5 * np.cos(np.pi * a)   # ease in/out
        q = cur + a * (tgt - cur)
        robot.send_action({f"{j}.pos": float(q[k]) for k, j in enumerate(JOINTS)})
        time.sleep(1.0 / RATE)
    time.sleep(hold)
    return dur

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pose"); ap.add_argument("--chain", nargs="*"); ap.add_argument("--list", action="store_true")
    ap.add_argument("--sim", action="store_true", help="use sim/poses_v1.json instead of poses_real.json")
    ap.add_argument("--speed", type=float, default=90.0, help="max joint speed, deg/s")
    ap.add_argument("--gripper", type=float, default=None, help="fixed gripper value 0-100 (e.g. closed on the knife handle)")
    ap.add_argument("--go", action="store_true", help="actually move (otherwise dry run)")
    a = ap.parse_args()
    poses = load_poses(POSES_SIM if a.sim else POSES_REAL)
    if a.list or not (a.pose or a.chain):
        print("poses:"); [print(f"  {k:14s} {[round(x,1) for x in v]}") for k, v in poses.items()]
        print("moves:"); [print(f"  {k:12s} {v}") for k, v in MOVES.items()]; return
    plan = [(a.pose, 0.0)] if a.pose else [step for mv in a.chain for step in MOVES[mv]]
    missing = [p for p, _ in plan if p not in poses]
    if missing: sys.exit(f"missing poses: {missing} (teach them with teach.py or use --sim)")
    print("plan:"); [print(f"  -> {p:14s} {[round(x,1) for x in poses[p]]}  hold {t}s") for p, t in plan]
    if not a.go: print("dry run. add --go to move."); return
    robot = connect(max_relative_target=8.0)
    try:
        print("current:", [round(x, 1) for x in read_pose(robot)])
        for p, t in plan:
            d = interpolate_to(robot, poses[p], a.speed, gripper=a.gripper, hold=t)
            print(f"  {p:14s} reached in {d:.2f}s  now {[round(x,1) for x in read_pose(robot)]}")
    finally:
        robot.disconnect()

if __name__ == "__main__":
    main()
