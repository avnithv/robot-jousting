"""Background teach session. Arm connected with torque OFF; watches cmd.txt for commands:
    rec <NAME>    start recording joints at ~50 Hz
    stop          stop recording, trim idle ends, save to motions_real.json under <NAME>
    snap <NAME>   save the current joints as a single pose in poses_real.json
    quit          disconnect (arm stays limp)
Live joint reading goes to live.json; events to teach_log.txt."""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, read_pose, load_poses, save_poses, POSES_REAL, JOINTS
HERE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(HERE, "cmd.txt"); LIVE = os.path.join(HERE, "live.json"); LOG = os.path.join(HERE, "teach_log.txt")
MOTIONS = os.path.join(HERE, "motions_real.json")
REC_HZ = 50.0
def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"; print(line, flush=True); open(LOG, "a").write(line + "\n")
def trim(t, q, vel_thresh_dps=8.0, pad=0.15):
    """Drop still time at both ends: keep from the first to the last sample whose joint speed exceeds the threshold."""
    q = np.asarray(q); t = np.asarray(t)
    if len(q) < 5: return t, q
    v = np.max(np.abs(np.gradient(q[:, :5], t, axis=0)), axis=1)
    moving = np.where(v > vel_thresh_dps)[0]
    if len(moving) == 0: return t, q
    i0 = np.searchsorted(t, t[moving[0]] - pad); i1 = np.searchsorted(t, t[moving[-1]] + pad, side="right")
    t = t[i0:i1]; return t - t[0], q[i0:i1]
robot = None
for attempt in range(3):
    try: robot = connect(); break
    except Exception as e: log(f"connect attempt {attempt} failed: {e}"); time.sleep(1)
if robot is None: sys.exit(1)
robot.bus.disable_torque(); log("connected, torque OFF, waiting for commands")
poses = load_poses(POSES_REAL)
motions = json.load(open(MOTIONS)) if os.path.exists(MOTIONS) else {}
rec_name, rec_t, rec_q, t0 = None, [], [], 0.0
try:
    while True:
        q = read_pose(robot); now = time.time()
        if rec_name:
            rec_t.append(now - t0); rec_q.append(q)
        if int(now * 2) != int((now - 1 / REC_HZ) * 2):
            json.dump(dict(zip(JOINTS, [round(x, 1) for x in q])), open(LIVE, "w"))
        if os.path.exists(CMD):
            cmd = open(CMD).read().strip(); os.remove(CMD)
            if cmd == "quit": log("quit"); break
            elif cmd.startswith("rec "):
                rec_name = cmd.split(None, 1)[1].strip(); rec_t, rec_q, t0 = [], [], time.time(); log(f"recording {rec_name} ...")
            elif cmd == "stop" and rec_name:
                t, qq = trim(rec_t, rec_q)
                motions[rec_name] = {"t": [round(float(x), 4) for x in t], "q": [[round(float(x), 2) for x in row] for row in qq], "joints": JOINTS}
                json.dump(motions, open(MOTIONS, "w")); log(f"saved motion {rec_name}: {len(rec_t)} raw samples, {len(t)} after trim, {t[-1] if len(t) else 0:.2f}s"); rec_name = None
            elif cmd.startswith("snap "):
                name = cmd.split(None, 1)[1].strip(); poses[name] = q; save_poses(POSES_REAL, poses); log(f"saved pose {name}: {dict(zip(JOINTS, [round(x, 1) for x in q]))}")
        time.sleep(1 / REC_HZ if rec_name else 0.1)
finally:
    robot.disconnect(); log("disconnected")
