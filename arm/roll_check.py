"""Hold the cocked pose (sword should point straight up) at a given real-arm roll value so a person can look.
    python roll_check.py 66      # hold with wrist_roll=66 for 8 s, then return to rest"""
import sys, json, os, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, read_pose
from play_motion import ease_to, HERE
roll = float(sys.argv[1]); hold = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
M = json.load(open(os.path.join(HERE, "motions_tuned.json")))["ATTACK_HIGH"]; k2 = np.array(M["keys"][2]); k2[4] = roll
rest = np.array(json.load(open(os.path.join(HERE, "motions_real.json")))["REST"]["q"][0])
robot = connect()
try:
    ease_to(robot, rest, 2.0); ease_to(robot, k2, 3.0)
    print("holding cocked pose with roll", roll, "->", [round(x, 1) for x in read_pose(robot)]); time.sleep(hold)
finally:
    ease_to(robot, rest, 3.0); robot.disconnect(); print("back at rest, torque off")
