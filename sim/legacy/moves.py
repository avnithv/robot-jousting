"""Sword move library for the joust.
Poses are defined by INTENT (where the sword hilt is, in metres from the arm's pan axis, and the blade pitch in
degrees, + = tip up) and resolved to joint angles with the planar IK. Pan is in degrees (+ = the arm's own right),
roll in degrees. Joint angles are SO101 new-calib degrees [pan, lift, elbow, wrist_flex, wrist_roll, gripper].
Every move starts from READY and returns to READY so beats chain.
Mounting assumption: arms bolted flat to the table (pan axis 0 above the surface, shoulder ~12 cm up)."""
import json, os, numpy as np

MAX_JOINT_SPEED_DPS = 240.0   # servo cap used for timing (STS3215 no-load ~400 deg/s at 12 V; margin for load)
MIN_SEG_TIME = 0.25
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poses.json")

# name: (hilt_x, hilt_z, pitch, pan, roll)
TARGETS = {
    "READY":       (0.26, 0.20,  10,   5,   0),   # en garde: retracted, tip slightly up, mid line, 5 deg to own right so blades pass
    "CHARGE":      (0.30, 0.21,   0,   0,   0),   # leaning in for the ride-in
    "HOME":        (0.12, 0.30,  80,   0,   0),   # parked, sword up
    "THRUST_COIL": (0.16, 0.20,   0,   0,   0),   # pulled back
    "THRUST_EXT":  (0.36, 0.21,   0,   0,   0),   # full extension on the mid line
    "FEINT_HALF":  (0.30, 0.21,   0,   0,   0),
    "HIGH_WINDUP": (0.08, 0.40,  75,   0,   0),   # raised overhead, blade up and back
    "HIGH_STRIKE": (0.29, 0.30, -10,   0,   0),   # cut lands on the high line
    "LOW_WINDUP":  (0.24, 0.11,  -5,  50,   0),   # blade low, swung out to own right
    "LOW_STRIKE":  (0.24, 0.11,  -5, -35,   0),   # sweep across the low line to own left
    "GUARD_HIGH":  (0.25, 0.27,  85,   0,   0),   # blade vertical, tip up, in front
    "GUARD_LOW":   (0.26, 0.26, -45,   0,   0),   # hanging guard, blade angled down across the low line
    "PARRY_HIGH":  (0.26, 0.26,  45, -15,  45),   # blade diagonal across the high line
    "PARRY_LOW":   (0.26, 0.22, -30,  15, -45),   # blade diagonal across the low line
}

# Hand-verified joint overrides (FK-checked): the IK targets above are kept for documentation.
OVERRIDES = {
    "GUARD_HIGH":  [0, 70, -70, -94, 0, 0],   # hilt (0.27, 0.29), tip (0.26, 0.49), blade vertical
    "GUARD_LOW":   [0, 30, -80,  94, 0, 0],   # hilt (0.31, 0.20), tip (0.45, 0.06), hanging guard at -44 deg
    "THRUST_COIL": [0, -60, 51,   9, 0, 0],   # sword horizontal, pulled back (see FK probe)
    "HOME":        [0, -99, 95, -60, 0, 0],   # folded up, sword pointing up
}

def _resolve():
    key = json.dumps([TARGETS, OVERRIDES], sort_keys=True)
    if os.path.exists(CACHE):
        c = json.load(open(CACHE))
        if c.get("key") == key: return {k: np.array(v) for k, v in c["poses"].items()}, c["errors"]
    import ik
    poses, errors = {}, {}
    for name, (x, z, pitch, pan, roll) in TARGETS.items():
        if name in OVERRIDES:
            poses[name] = np.array(OVERRIDES[name], float); errors[name] = [0.0, 0.0, 0.0]; continue
        q, err, h, t = ik.solve(x, z, pitch, pan=pan, roll=roll)
        poses[name] = q; errors[name] = [float(e) for e in err]
    json.dump({"key": key, "poses": {k: v.tolist() for k, v in poses.items()}, "errors": errors}, open(CACHE, "w"), indent=1)
    return poses, errors

POSES, IK_ERRORS = _resolve()
globals().update(POSES)
FLOURISH_A = READY.copy(); FLOURISH_A[4] = 100
FLOURISH_B = READY.copy(); FLOURISH_B[4] = -100
POSES["FLOURISH_A"] = FLOURISH_A; POSES["FLOURISH_B"] = FLOURISH_B

MOVES = {
    "slash_high": [(HIGH_WINDUP, 0.35), (HIGH_STRIKE, 0.30), (READY, 0.35)],
    "slash_low":  [(LOW_WINDUP, 0.35),  (LOW_STRIKE, 0.30),  (READY, 0.35)],
    "thrust":     [(THRUST_COIL, 0.30), (THRUST_EXT, 0.25),  (READY, 0.40)],
    "guard_high": [(GUARD_HIGH, 0.35),  (GUARD_HIGH, 0.40),  (READY, 0.35)],
    "guard_low":  [(GUARD_LOW, 0.35),   (GUARD_LOW, 0.40),   (READY, 0.35)],
    "parry_high": [(PARRY_HIGH, 0.35),  (PARRY_HIGH, 0.40),  (READY, 0.35)],
    "parry_low":  [(PARRY_LOW, 0.35),   (PARRY_LOW, 0.40),   (READY, 0.35)],
    "feint":      [(FEINT_HALF, 0.25),  (READY, 0.25),       (READY, 0.30)],
    "flourish":   [(FLOURISH_A, 0.30),  (FLOURISH_B, 0.40),  (READY, 0.30)],
    "rest":       [(READY, 0.30),       (READY, 0.30),       (READY, 0.30)],
}

def timed(keyframes, start):
    """Stretch segment durations so no joint exceeds MAX_JOINT_SPEED_DPS."""
    out = []; prev = start
    for pose, t in keyframes:
        need = float(np.max(np.abs(pose - prev)) / MAX_JOINT_SPEED_DPS)
        out.append((pose, max(t, need, MIN_SEG_TIME))); prev = pose
    return out

def move_duration(name, start=None):
    return sum(t for _, t in timed(MOVES[name], READY if start is None else start))

if __name__ == "__main__":
    for n, q in POSES.items():
        e = IK_ERRORS.get(n); print(f"{n:12s} q={np.round(q[:5]).astype(int).tolist()}  ik_err={np.round(e,3).tolist() if e else '-'}")
    for n in MOVES: print(f"{n:11s} {move_duration(n):.2f}s")
