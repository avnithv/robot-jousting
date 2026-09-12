"""Play a tuned motion (arm/motions_tuned.json) on the real arm.
    python play_motion.py ATTACK_HIGH --scale 0.5       # half speed
    python play_motion.py ATTACK_HIGH                   # full speed
Sequence: torque on -> ease from wherever it is to the motion's first frame (3 s) -> play -> hold 1 s
          -> ease back to REST (3 s) -> torque off. Ctrl-C at any point eases back to REST first."""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, read_pose, JOINTS
HERE = os.path.dirname(os.path.abspath(__file__))
RATE = 50.0

def send(robot, q):
    robot.send_action({f"{j}.pos": float(q[k]) for k, j in enumerate(JOINTS)})

def ease_to(robot, target, seconds):
    cur = np.array(read_pose(robot)); tgt = np.array(target, float); n = max(int(seconds * RATE), 1)
    for i in range(1, n + 1):
        a = 0.5 - 0.5 * np.cos(np.pi * i / n); send(robot, cur + a * (tgt - cur)); time.sleep(1 / RATE)

def play(robot, t, Q, scale):
    T = t[-1] / scale; t0 = time.perf_counter(); n = 0
    while True:
        now = time.perf_counter() - t0
        if now > T: send(robot, Q[-1]); break
        q = np.array([np.interp(now * scale, t, Q[:, k]) for k in range(6)]); send(robot, q); n += 1
        time.sleep(1 / RATE)
    return n

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("name"); ap.add_argument("--scale", type=float, default=1.0, help="time scale: 0.5 = half speed")
    ap.add_argument("--no-return", action="store_true"); ap.add_argument("--repeat", type=int, default=1, help="play this many times"); a = ap.parse_args()
    M = json.load(open(os.path.join(HERE, "motions_tuned.json")))[a.name]; t = np.array(M["t"]); Q = np.array(M["q"])
    rest = np.array(json.load(open(os.path.join(HERE, "motions_tuned.json")))["REST"]["q"][0])
    print(f"{a.name}: {t[-1]:.2f}s at scale {a.scale} -> {t[-1]/a.scale:.2f}s, {len(t)} samples")
    robot = connect(max_relative_target=None)   # trajectory is dense and smooth; per-step limit would distort the fast slam
    try:
        print("start:", [round(x, 1) for x in read_pose(robot)])
        ease_to(robot, rest, 3.0); ease_to(robot, Q[0], 1.0)   # always start from REST, then the motion's first frame
        off = np.abs(np.array(read_pose(robot))[:5] - Q[0][:5]).max()
        print("at first frame:", [round(x, 1) for x in read_pose(robot)], f"(max off {off:.1f} deg)")
        if off > 5.0: raise RuntimeError(f"arm did not reach the start pose ({off:.1f} deg off); not playing")
        time.sleep(0.5)
        for i in range(a.repeat):
            if i: ease_to(robot, Q[0], 2.0); time.sleep(0.5)
            n = play(robot, t, Q, a.scale); time.sleep(1.0)
            print(f"run {i+1}: played {n} commands; end pose:", [round(x, 1) for x in read_pose(robot)], "target:", [round(float(x), 1) for x in Q[-1]])
    except KeyboardInterrupt:
        print("interrupted")
    finally:
        if not a.no_return:
            print("returning to REST"); ease_to(robot, rest, 3.0)
        robot.disconnect(); print("torque off")

if __name__ == "__main__":
    main()
