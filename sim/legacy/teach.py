"""Teach mode: torque off, move the arm by hand, snapshot named poses.

    cd ~/so-arm && source .venv/bin/activate && python ~/game/arm/teach.py

Commands at the prompt:  <name>  snapshot the current joints as <name> (overwrites)
                         list    show saved poses        show    print live joints once
                         q       quit (torque stays off; the arm goes limp on disconnect, support it)
Poses go to arm/poses_real.json in lerobot degrees, the same convention the sim uses."""
from common import connect, read_pose, load_poses, save_poses, POSES_REAL, JOINTS

def main():
    robot = connect()
    robot.bus.disable_torque()
    print("Torque OFF. Move the arm by hand. Type a pose name and press Enter to snapshot.")
    poses = load_poses(POSES_REAL)
    try:
        while True:
            cmd = input("pose name > ").strip()
            if not cmd: continue
            if cmd == "q": break
            if cmd == "list":
                for k, v in poses.items(): print(f"  {k:14s} {[round(x, 1) for x in v]}")
                continue
            q = read_pose(robot)
            print("  live:", dict(zip(JOINTS, [round(x, 1) for x in q])))
            if cmd == "show": continue
            poses[cmd] = q; save_poses(POSES_REAL, poses); print(f"  saved '{cmd}' -> {POSES_REAL}")
    finally:
        robot.disconnect()

if __name__ == "__main__":
    main()
