"""Hand-posed keyframe motions. sim/keyframes/<name>.json holds, per arm, a list of {"t": seconds, "q": [6 REAL degrees]}
captured from the arm in the studio's Keyframes tab. This builds a Catmull-Rom trajectory through each arm's keys and saves
it to arm/motions_tuned.json as KF_<name> (arm A) and KF_<name>@B (arm B), in each arm's own coordinates, so the moves
list, Run both, Run TURN and the chain builder can use them.   Usage: python keyframes.py <name>"""
import json, os, sys, fcntl
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "..", "arm", "motions_tuned.json")
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]

def catmull_rom(keys, times, hz=50.0):
    P = np.array(keys, float); T = np.array(times, float); n = len(P); V = np.zeros_like(P)
    for i in range(1, n - 1): V[i] = (P[i + 1] - P[i - 1]) / (T[i + 1] - T[i - 1])
    ts = np.arange(0, T[-1] + 1e-9, 1 / hz); out = []
    for t in ts:
        i = min(np.searchsorted(T, t, side="right") - 1, n - 2); h = T[i + 1] - T[i]; s = (t - T[i]) / h
        h00, h10, h01, h11 = 2*s**3 - 3*s**2 + 1, s**3 - 2*s**2 + s, -2*s**3 + 3*s**2, s**3 - s**2
        out.append(h00 * P[i] + h10 * h * V[i] + h01 * P[i + 1] + h11 * h * V[i + 1])
    return ts, np.array(out)

def build(name):
    K = json.load(open(os.path.join(HERE, "keyframes", name + ".json"))); cfg = json.load(open(os.path.join(HERE, "..", "arm", "arms.json")))
    lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX); tuned = json.load(open(OUT)); made = []
    for arm in ("A", "B"):
        keys = sorted([k for k in K.get(arm, []) if k.get("q")], key=lambda k: float(k.get("t", 0)))
        if not keys: continue
        if len(keys) == 1: keys = [keys[0], {"t": float(keys[0].get("t", 0)) + 0.5, "q": keys[0]["q"]}]   # a single key: hold it
        times = [float(k["t"]) for k in keys]
        for i in range(1, len(times)):
            if times[i] <= times[i - 1]: times[i] = times[i - 1] + 0.1   # keep the clock strictly increasing
        t0 = times[0]; times = [t - t0 for t in times]; Q = [[float(x) for x in k["q"]] for k in keys]
        ts, traj = catmull_rom(Q, times); traj[:, 5] = np.clip(traj[:, 5], 0, 100)
        label = "KF_" + name + ("" if arm == "A" else "@B")
        tuned[label] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in r] for r in traj], "roll_offset": cfg[arm]["roll_offset"], "arm": arm,
                        "joints": JOINTS, "keys": [[round(x, 1) for x in q] for q in Q], "key_times": [round(t, 2) for t in times], "keyframes": name}
        made.append(f"{label}: {len(keys)} keys, {ts[-1]:.2f}s")
    json.dump(tuned, open(OUT + ".tmp", "w")); os.replace(OUT + ".tmp", OUT); fcntl.flock(lock, fcntl.LOCK_UN)
    return made

if __name__ == "__main__":
    for line in build(sys.argv[1]): print(line)
