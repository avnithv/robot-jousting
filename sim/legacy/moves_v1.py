"""Version-1 move set for chaining: attack_high, attack_low, block_high, block_low.
Two stances (HIGH, LOW). Every move starts from either stance and ENDS in a stance, so chains flow.
Pose convention: SO101 new-calib degrees [pan, lift, elbow, wrist_flex, wrist_roll, gripper]; +pan = own right.
Safety rule: the hilt never crosses the centre line (hilt <= 0.27 m from own base at a 0.61 m clash gap)."""
import json, os, numpy as np

KNIFE_LEN = 0.18              # plastic knife blade past the hand, metres
MAX_JOINT_SPEED_DPS = 240.0
BEAT_SECONDS = 1.2            # fixed beat length; every move must fit
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "poses_v1.json")

# name: (hilt_x, hilt_z, pitch_deg(+ = tip up), pan_deg, roll_deg)
TARGETS = {
    "STANCE_HIGH": (0.18, 0.27,  20,   5,   0),   # knife forward and up, retracted
    "STANCE_LOW":  (0.18, 0.15, -15,   5,   0),   # knife forward and down, retracted
    "WINDUP_HIGH": (0.08, 0.38,  75,   0,   0),   # raised overhead, tip up and back
    "STRIKE_HIGH": (0.27, 0.30, -10,   0,   0),   # chop lands on the high line, hilt at the safety limit
    "WINDUP_LOW":  (0.22, 0.12, -10,  45,   0),   # knife low, swung out to own right
    "STRIKE_LOW":  (0.27, 0.11, -10, -25,   0),   # swept across the low line to own left
    "BLOCK_HIGH":  (0.24, 0.26,  85,   0,  90),   # vertical, tip up, flat of the blade facing forward
    "BLOCK_LOW":   (0.26, 0.24, -45,   0,  90),   # hanging guard across the low line, flat facing forward
}
OVERRIDES = {  # hand-verified joint configs where the IK struggles (FK-checked)
    "BLOCK_HIGH": [0, 70, -70, -94, 90, 0],
    "BLOCK_LOW":  [0, 30, -80,  94, 90, 0],
}

def _resolve():
    key = json.dumps([TARGETS, OVERRIDES], sort_keys=True)
    if os.path.exists(CACHE):
        c = json.load(open(CACHE))
        if c.get("key") == key: return {k: np.array(v) for k, v in c["poses"].items()}, c["errors"]
    import ik
    poses, errors = {}, {}
    for name, (x, z, pitch, pan, roll) in TARGETS.items():
        if name in OVERRIDES: poses[name] = np.array(OVERRIDES[name], float); errors[name] = [0, 0, 0]; continue
        q, err, h, t = ik.solve(x, z, pitch, pan=pan, roll=roll); poses[name] = q; errors[name] = [float(e) for e in err]
    json.dump({"key": key, "poses": {k: v.tolist() for k, v in poses.items()}, "errors": errors}, open(CACHE, "w"), indent=1)
    return poses, errors

POSES, IK_ERRORS = _resolve()
globals().update(POSES)
STANCES = {"high": STANCE_HIGH, "low": STANCE_LOW}

# move: keyframes (pose, seconds) and the stance it ends in. Timing is nominal; `timed` stretches for the speed cap.
MOVES = {
    "attack_high": dict(frames=[(WINDUP_HIGH, 0.40), (STRIKE_HIGH, 0.30), (STANCE_HIGH, 0.40)], ends="high"),
    "attack_low":  dict(frames=[(WINDUP_LOW, 0.40),  (STRIKE_LOW, 0.30),  (STANCE_LOW, 0.40)],  ends="low"),
    "block_high":  dict(frames=[(BLOCK_HIGH, 0.35),  (BLOCK_HIGH, 0.50),  (STANCE_HIGH, 0.35)], ends="high"),
    "block_low":   dict(frames=[(BLOCK_LOW, 0.35),   (BLOCK_LOW, 0.50),   (STANCE_LOW, 0.35)],  ends="low"),
}

def timed(frames, start):
    out = []; prev = start
    for pose, t in frames:
        need = float(np.max(np.abs(pose - prev)) / MAX_JOINT_SPEED_DPS)
        out.append((pose, max(t, need))); prev = pose
    return out

def duration(name, from_stance):
    return sum(t for _, t in timed(MOVES[name]["frames"], STANCES[from_stance]))

if __name__ == "__main__":
    for n, q in POSES.items(): print(f"{n:12s} q={np.round(q[:5]).astype(int).tolist()}  ik_err={np.round(IK_ERRORS[n],3).tolist()}")
    for n in MOVES:
        for s in STANCES: print(f"{n:12s} from {s:4s}: {duration(n, s):.2f}s  (beat {BEAT_SECONDS}s)")
