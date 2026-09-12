"""Record the arm's joints live (through the daemon, torque off) until arm/STOP exists; then report which joint moved most
and the final pose.   ~/game/.venv/bin/python arm/find_servo.py"""
import json, os, time, urllib.request, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); STOP = os.path.join(HERE, "STOP"); OUT = os.path.join(HERE, "find_servo.json")
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
def status(): return json.load(urllib.request.urlopen("http://127.0.0.1:8766/status", timeout=2))
if os.path.exists(STOP): os.remove(STOP)
rows = []
while not os.path.exists(STOP):
    try: rows.append([time.time()] + status()["pose"])
    except Exception: pass
    time.sleep(0.05)
os.remove(STOP); R = np.array(rows); q = R[:, 1:]
rng = q.max(0) - q.min(0); k = int(np.argmax(rng[:5]))
res = {"samples": len(R), "seconds": round(float(R[-1, 0] - R[0, 0]), 1), "range_deg": dict(zip(JOINTS, np.round(rng, 1).tolist())), "moved_most": JOINTS[k], "final_pose": np.round(q[-1], 1).tolist()}
json.dump({"result": res, "t": (R[:, 0] - R[0, 0]).round(3).tolist(), "q": q.round(2).tolist()}, open(OUT, "w")); print(json.dumps(res, indent=1))
