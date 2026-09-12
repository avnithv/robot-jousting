#!/usr/bin/env python3
"""Build everything the Arm Studio dashboard needs from the robot-jousting repo.

    python3 tools/make_dashboard_data.py                 # repo = the parent folder (joust/ lives inside it), or $JOUST_REPO
    python3 tools/make_dashboard_data.py --repo ~/game   # explicit checkout

Writes (re-runnable, overwrites):
  dashboard/data/moves.json        one entry per taught move: 50 Hz trajectory, keys, params (+help), velocities,
                                   peak speeds, hand / blade-tip path from forward kinematics, rule checks
  dashboard/data/chains.json       compiled CHAIN_* entries (same analysis + chain / beats)
  dashboard/data/pairs.json        beat-aligned closest blade-blade distance for every (A move, B move) pair
  dashboard/data/hubs.json         hub poses (sim/hubs.json)
  dashboard/data/transitions.json  transition routes (sim/transitions.json)
  dashboard/data/meta.json         conventions, rules, geometry, beat model, video list
  dashboard/videos/*.mp4           MuJoCo clips (tuned_<MOVE>.mp4) and the labelled reel

Conventions (README.md of the arm repo): joints [pan, lift, elbow, wrist_flex, wrist_roll, jaw] in degrees, stored as
the REAL arm plays them (wrist_roll reads +76 when the sword is on top; sim roll = real - 76). Hand positions are
metres from the arm's own pan axis: x forward, z up from the base plane.

Kinematics: the chain is the SO101 MJCF (so101_new_calib.xml: body pos/quat + hinge joints) with the plastic sword
mounted on the moving jaw exactly as sim/arena.py does (hilt 0.353 m forward of the pan axis at the zero pose, blade
0.18 m). Numpy only, no MuJoCo needed. It reproduces the hand / tip numbers quoted in docs/transitions_and_flourishes.md
to about a centimetre. Arm B (the SO100) is treated as a mirrored SO101: the two arms are geometrically near-identical
and the sim maps B's joints so that A's poses are valid for B by construction.
"""
import argparse, glob, json, os, shutil, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
JOUST = os.path.dirname(HERE)
DASH = os.path.join(JOUST, "dashboard")
DATA = os.path.join(DASH, "data")
VIDEOS = os.path.join(DASH, "videos")
DEFAULT_REPO = os.path.expanduser(os.environ.get("JOUST_REPO", "") or os.path.join(JOUST, "..") if os.path.exists(os.path.join(JOUST, "..", "arm", "motions_tuned.json")) else os.path.join(JOUST, "..", "robot-jousting"))   # joust/ lives inside the repo

# ---------------------------------------------------------------- geometry & rules
JOINTS = ["pan", "lift", "elbow", "wrist_flex", "wrist_roll", "jaw"]
JOINT_LABELS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
ROLL_OFFSET = 76.0        # real wrist_roll reading when the sword is exactly on top (sim roll 0)
BASE_GAP = 0.61           # metres between the two pan axes
CENTRE_X = BASE_GAP / 2   # 0.305: hands never cross this
HAND_X_MAX = 0.27         # hilt no more than this far forward of its own base
SERVO_CAP = 300.0         # deg/s
LIFT_MIN = -89.0          # shoulder_lift hard limit (measured on the arm)
WRIST_FLOORS = {"wrist_flex": 0.120, "wrist_roll": 0.092}   # measured joint-housing floors (advisory: tune.py no longer enforces them)
ROLL_REAL_LIMIT = 180.0   # the real roll servo cannot cross +/-180
BEAT, IMPACT, GUARD = 1.4, 1.0, 0.55   # sim/chain.py beat model
HILT_REACH, SWORD_LEN, PAN_AXIS_X = 0.353, 0.18, 0.0388353
# sim joint ranges in degrees (MJCF; wrist_roll widened to +/-185 as arena.py does, jaw is 0..100 in the move files)
JOINT_RANGE = {"pan": (-110.0, 110.0), "lift": (-100.0, 100.0), "elbow": (-96.8, 96.8), "wrist_flex": (-95.0, 95.0),
               "wrist_roll": (-185.0, 185.0), "jaw": (-10.0, 100.0)}

# Body (pos, quat wxyz) relative to its parent, each with a hinge about its local z. From so101_new_calib.xml.
CHAIN = [
    ("shoulder",  [0.0388353, 0.0, 0.0624],           [0.0, 0.0, -1.0, 0.0]),
    ("upper_arm", [-0.0303992, -0.0182778, -0.0542],  [0.5, -0.5, -0.5, -0.5]),
    ("lower_arm", [-0.11257, -0.028, 0.0],            [0.707107, 0.0, 0.0, 0.707107]),
    ("wrist",     [-0.1349, 0.0052, 0.0],             [0.707107, 0.0, 0.0, -0.707107]),
    ("gripper",   [0.0, -0.0611, 0.0181],             [0.0172091, -0.0172091, 0.706897, 0.706897]),
    ("jaw",       [0.0202, 0.0188, -0.0234],          [0.707107, 0.707107, 0.0, 0.0]),
]

def quat_to_mat(q):
    q = np.asarray(q, float); q = q / np.linalg.norm(q); w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])

_STATIC = [(np.array(p), quat_to_mat(q)) for _, p, q in CHAIN]

def fk_bodies(q_sim_deg):
    """World (pos, R) of every body, arm base at the origin, pan axis at x = PAN_AXIS_X."""
    p = np.zeros(3); R = np.eye(3); out = []
    for (pos, Rs), qd in zip(_STATIC, q_sim_deg):
        p = p + R @ pos; R = R @ Rs @ rot_z(np.radians(qd)); out.append((p, R))
    return out

# sword frame on the moving jaw (arena._arm_with_sword with SWORD_ON_JAW=True), computed once at the zero pose
_B0 = fk_bodies([0.0] * 6)
_g0, _ = _B0[4]; _j0, _jR0 = _B0[5]
_hilt0 = np.array([PAN_AXIS_X + HILT_REACH, _g0[1], _g0[2]])
_dir = _hilt0 - _j0; _dist = float(np.linalg.norm(_dir)); _dir /= _dist
SWORD_DIR_LOCAL = _jR0.T @ _dir
SWORD_START_LOCAL = SWORD_DIR_LOCAL * _dist
_SHIFT = np.array([PAN_AXIS_X, 0.0, 0.0])

def fk(q_sim_deg):
    """Joint anchors (6 x 3), hilt (3), tip (3) in the arm's own frame: pan axis at x=0, z from the base plane."""
    B = fk_bodies(q_sim_deg)
    jp, jR = B[5]
    hilt = jp + jR @ SWORD_START_LOCAL; d = jR @ SWORD_DIR_LOCAL; tip = hilt + SWORD_LEN * d
    anchors = np.array([b[0] for b in B]) - _SHIFT
    return anchors, hilt - _SHIFT, tip - _SHIFT

def to_world(pts, arm):
    """Own frame -> arena world frame. A sits at x=0 facing +x; B at x=BASE_GAP facing -x (its left is world -y)."""
    pts = np.asarray(pts, float)
    if arm == "A": return pts
    out = pts.copy(); out[..., 0] = BASE_GAP - pts[..., 0]; out[..., 1] = -pts[..., 1]; return out

def seg_dist(p1, p2, q1, q2):
    """Closest distance between segments p1-p2 and q1-q2 (Ericson, Real-Time Collision Detection 5.1.9)."""
    d1 = p2 - p1; d2 = q2 - q1; r = p1 - q1
    a = d1 @ d1; e = d2 @ d2; f = d2 @ r; eps = 1e-12
    if a <= eps and e <= eps: return float(np.linalg.norm(r))
    if a <= eps: s = 0.0; t = np.clip(f / e, 0, 1)
    else:
        c = d1 @ r
        if e <= eps: t = 0.0; s = np.clip(-c / a, 0, 1)
        else:
            b = d1 @ d2; den = a * e - b * b
            s = np.clip((b * f - c * e) / den, 0, 1) if den > eps else 0.0
            t = (b * s + f) / e
            if t < 0: t = 0.0; s = np.clip(-c / a, 0, 1)
            elif t > 1: t = 1.0; s = np.clip((b - c) / a, 0, 1)
    return float(np.linalg.norm((p1 + d1 * s) - (q1 + d2 * t)))

# ---------------------------------------------------------------- analysis
def move_type(name):
    for k in ("ATTACK", "BLOCK", "FEINT", "REST", "CHAIN"):
        if name.startswith(k): return k.lower()
    return "other"

def pin_for(name, key_times):
    """Where chain.py pins the move inside a beat: blocks put their guard key at GUARD s, everything else its last key
    at IMPACT s. Returns (key index, key time, beat time) or None for REST."""
    if name == "REST" or len(key_times) < 2: return None
    if name.startswith("BLOCK"): return 1, float(key_times[1]), GUARD
    return len(key_times) - 1, float(key_times[-1]), IMPACT

def r4(x): return [round(float(v), 4) for v in x]

def analyse(name, M):
    t = np.array(M["t"], float); q = np.array(M["q"], float)
    q_sim = q.copy(); q_sim[:, 4] -= float(M.get("roll_offset", ROLL_OFFSET))
    vel = np.gradient(q, t, axis=0) if len(t) > 1 else np.zeros_like(q)
    peak = np.abs(vel).max(0); peak_t = t[np.abs(vel).argmax(0)]
    hand = np.zeros((len(t), 3)); tip = np.zeros((len(t), 3)); wflex_z = np.zeros(len(t)); wroll_z = np.zeros(len(t)); elbow_z = np.zeros(len(t))
    for i, row in enumerate(q_sim):
        anchors, h, tp = fk(row); hand[i] = h; tip[i] = tp; elbow_z[i] = anchors[2, 2]; wflex_z[i] = anchors[3, 2]; wroll_z[i] = anchors[4, 2]
    hand_r = np.hypot(hand[:, 0], hand[:, 1]) * np.sign(hand[:, 0])      # forward reach (signed), as ik.py measures it
    v = tip - hand; pitch = np.degrees(np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1])))
    blade_min_z = np.minimum(hand[:, 2], tip[:, 2])

    viol = []
    def add(rule, severity, value, limit, ti, joint=None, note=""):
        viol.append({"rule": rule, "severity": severity, "value": round(float(value), 3), "limit": limit, "t": round(float(ti), 2), "joint": joint, "note": note})
    for k in range(5):   # the jaw is not a positioning servo for the cap
        if peak[k] > SERVO_CAP: add("speed_cap", "hard", peak[k], SERVO_CAP, peak_t[k], JOINTS[k], f"{JOINTS[k]} peaks at {peak[k]:.0f} deg/s (cap {SERVO_CAP:.0f})")
    i = int(hand_r.argmax())
    if hand_r[i] > HAND_X_MAX + 1e-3: add("hand_x", "hard", hand_r[i], HAND_X_MAX, t[i], "hand", f"hilt reaches {hand_r[i]:.3f} m forward (rule 0.27, centre line {CENTRE_X})")
    i = int(blade_min_z.argmin())
    if blade_min_z[i] < 0: add("below_base", "hard", blade_min_z[i], 0.0, t[i], "blade", f"blade dips {(-blade_min_z[i]) * 100:.1f} cm below the base plane")
    i = int(q[:, 1].argmin())
    if q[i, 1] < LIFT_MIN - 1e-6: add("lift_min", "hard", q[i, 1], LIFT_MIN, t[i], "lift", f"shoulder_lift {q[i, 1]:.1f} deg: upper arm on the board below {LIFT_MIN:.0f}")
    i = int(np.abs(q[:, 4]).argmax())
    if abs(q[i, 4]) >= ROLL_REAL_LIMIT: add("roll_wrap", "hard", q[i, 4], ROLL_REAL_LIMIT, t[i], "wrist_roll", "real wrist_roll crosses +/-180")
    for k, j in enumerate(JOINTS):
        if j == "wrist_roll": continue   # the real roll is a full turn; its only rule is the +/-180 wrap (checked above)
        lo, hi = JOINT_RANGE[j]; col = q_sim[:, k]
        if col.min() < lo - 1e-6: add("joint_range", "hard", col.min(), lo, t[col.argmin()], j, f"{j} below its sim range ({lo})")
        if col.max() > hi + 1e-6: add("joint_range", "hard", col.max(), hi, t[col.argmax()], j, f"{j} above its sim range ({hi})")
    i = int(wflex_z.argmin())
    if wflex_z[i] < WRIST_FLOORS["wrist_flex"]: add("wrist_flex_floor", "advisory", wflex_z[i], WRIST_FLOORS["wrist_flex"], t[i], "wrist_flex", f"wrist pitch housing at {wflex_z[i] * 100:.1f} cm (measured floor 12.0 cm; floors dropped in tune.py)")
    i = int(wroll_z.argmin())
    if wroll_z[i] < WRIST_FLOORS["wrist_roll"]: add("wrist_roll_floor", "advisory", wroll_z[i], WRIST_FLOORS["wrist_roll"], t[i], "wrist_roll", f"wrist roll housing at {wroll_z[i] * 100:.1f} cm (measured floor 9.2 cm; floors dropped in tune.py)")

    key_times = [float(x) for x in M.get("key_times", [])]
    pin = pin_for(name, key_times)
    out = {
        "name": name, "type": move_type(name), "hz": round(1.0 / float(np.median(np.diff(t))), 1) if len(t) > 1 else 0,
        "duration": round(float(t[-1]), 3), "n": int(len(t)),
        "t": r4(t), "q": [[round(float(x), 2) for x in row] for row in q],
        "roll_offset": float(M.get("roll_offset", ROLL_OFFSET)), "joints": JOINTS,
        "keys": M.get("keys", []), "key_times": key_times,
        "vel": [[round(float(x), 1) for x in row] for row in vel],
        "peak": {j: round(float(peak[k]), 1) for k, j in enumerate(JOINTS)},
        "peak_t": {j: round(float(peak_t[k]), 2) for k, j in enumerate(JOINTS)},
        "hand": [r4(p) for p in hand], "tip": [r4(p) for p in tip], "hand_r": r4(hand_r), "pitch": [round(float(x), 1) for x in pitch],
        "wrist_flex_z": r4(wflex_z), "wrist_roll_z": r4(wroll_z),
        "stats": {"max_hand_x": round(float(hand_r.max()), 4), "max_hand_x_t": round(float(t[hand_r.argmax()]), 2),
                  "min_blade_z": round(float(blade_min_z.min()), 4), "min_blade_z_t": round(float(t[blade_min_z.argmin()]), 2),
                  "min_tip_z": round(float(tip[:, 2].min()), 4), "max_tip_z": round(float(tip[:, 2].max()), 4),
                  "min_hand_z": round(float(hand[:, 2].min()), 4), "max_hand_z": round(float(hand[:, 2].max()), 4),
                  "min_wrist_flex_z": round(float(wflex_z.min()), 4), "min_wrist_roll_z": round(float(wroll_z.min()), 4),
                  "min_elbow_z": round(float(elbow_z.min()), 4),
                  "min_lift": round(float(q[:, 1].min()), 1), "roll_real_range": [round(float(q[:, 4].min()), 1), round(float(q[:, 4].max()), 1)],
                  "peak_max": round(float(peak[:5].max()), 1), "peak_max_joint": JOINTS[int(peak[:5].argmax())],
                  "end_hand": r4(hand[-1]), "end_tip": r4(tip[-1]), "end_pitch": round(float(pitch[-1]), 1)},
        "pin": None if pin is None else {"key": pin[0], "key_t": pin[1], "beat_t": pin[2], "pad": round(pin[2] - pin[1], 3)},
        "violations": viol, "ok": not any(v["severity"] == "hard" for v in viol),
    }
    return out

def flatten(o, pre=""):
    out = []
    for k, v in o.items():
        if k.startswith("_"): continue
        if isinstance(v, dict): out += flatten(v, pre + k + ".")
        else: out.append((pre + k, v))
    return out

def load_params(repo):
    P = {}
    for f in sorted(glob.glob(os.path.join(repo, "sim", "params", "*.json"))):
        P[os.path.splitext(os.path.basename(f))[0]] = json.load(open(f))
    return P

def params_block(name, tuned_params, param_files):
    src = param_files.get(name, {}); help_ = src.get("_help", {}); doc = src.get("_doc", "")
    base = tuned_params if tuned_params is not None else {k: v for k, v in src.items() if not k.startswith("_")}
    rows = [{"key": k, "value": v, "help": help_.get(k, "")} for k, v in flatten(base)]
    stale = json.dumps(base, sort_keys=True) != json.dumps({k: v for k, v in src.items() if not k.startswith("_")}, sort_keys=True) if src else False
    return {"doc": doc, "rows": rows, "raw": base, "stale": stale}

def align(a, b):
    """Front-pad offsets (s) so both moves' pinned keys land on the beat clock (chain.py: impact at 1.0 s, guard at
    0.55 s). If a move cannot be padded enough (its key is later than the pin), the whole beat stretches like
    chain.py's beat_extra. Returns (offA, offB, stretch)."""
    padA = a["pin"]["pad"] if a["pin"] else 0.0; padB = b["pin"]["pad"] if b["pin"] else 0.0
    m = min(padA, padB, 0.0)
    return padA - m, padB - m, -m

def sample(m, tt, off):
    """Pose of move m at pair time tt (holds its first pose before `off` and its last after the end)."""
    t = np.array(m["t"]); q = np.array(m["q"]); tl = np.clip(tt - off, t[0], t[-1])
    return np.array([np.interp(tl, t, q[:, k]) for k in range(6)])

def pair_scan(a, b, hz=50.0):
    offA, offB, stretch = align(a, b)
    T = max(offA + a["duration"], offB + b["duration"], BEAT + stretch)
    ts = np.arange(0.0, T + 1e-9, 1.0 / hz); dist = np.zeros(len(ts)); hands = np.zeros(len(ts))
    for i, tt in enumerate(ts):
        qa = sample(a, tt, offA); qb = sample(b, tt, offB); qa[4] -= a["roll_offset"]; qb[4] -= b["roll_offset"]
        _, ha, ta = fk(qa); _, hb, tb = fk(qb)
        ha, ta = to_world(ha, "A"), to_world(ta, "A"); hb, tb = to_world(hb, "B"), to_world(tb, "B")
        dist[i] = seg_dist(ha, ta, hb, tb); hands[i] = float(np.linalg.norm(ha - hb))
    k = int(dist.argmin())
    return {"a": a["name"], "b": b["name"], "offset_a": round(offA, 3), "offset_b": round(offB, 3), "stretch": round(stretch, 3),
            "impact_t": round(IMPACT + stretch, 3), "guard_t": round(GUARD + stretch, 3), "duration": round(float(ts[-1]), 3),
            "min_cm": round(float(dist[k]) * 100, 1), "min_t": round(float(ts[k]), 2), "end_cm": round(float(dist[-1]) * 100, 1),
            "min_hand_cm": round(float(hands.min()) * 100, 1), "touch_cm": 2.4}

# ---------------------------------------------------------------- main
def copy_if_changed(src, dst):
    if not os.path.exists(src): return False
    if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src) and int(os.path.getmtime(dst)) >= int(os.path.getmtime(src)): return False
    shutil.copy2(src, dst); return True

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=DEFAULT_REPO, help="robot-jousting checkout (default: %(default)s)")
    ap.add_argument("--no-videos", action="store_true", help="skip copying the mp4 clips")
    args = ap.parse_args(); repo = os.path.abspath(os.path.expanduser(args.repo))
    tuned_path = os.path.join(repo, "arm", "motions_tuned.json")
    if not os.path.exists(tuned_path): sys.exit(f"no {tuned_path}: pass --repo or set JOUST_REPO")
    os.makedirs(DATA, exist_ok=True); os.makedirs(VIDEOS, exist_ok=True)
    tuned = json.load(open(tuned_path)); param_files = load_params(repo)

    order = {"attack": 0, "feint": 1, "block": 2, "rest": 3}
    move_names = sorted([n for n, m in tuned.items() if "chain" not in m], key=lambda n: (order.get(move_type(n), 9), n))
    chain_names = [n for n, m in tuned.items() if "chain" in m]

    moves = {}
    for n in move_names:
        a = analyse(n, tuned[n]); a["params"] = params_block(n, tuned[n].get("params"), param_files)
        a["video"] = f"videos/tuned_{n}.mp4" if os.path.exists(os.path.join(repo, "videos", f"tuned_{n}.mp4")) else None
        moves[n] = a
        flags = ", ".join(f"{v['rule']}({v['severity'][0]})" for v in a["violations"]) or "clean"
        print(f"  {n:14s} {a['duration']:.2f}s  peak {a['stats']['peak_max']:5.0f} deg/s ({a['stats']['peak_max_joint']})  hand x {a['stats']['max_hand_x']:.3f}  blade z {a['stats']['min_blade_z']:+.3f}  {flags}")
    chains = {}
    for n in chain_names:
        a = analyse(n, tuned[n]); a["chain"] = tuned[n].get("chain", []); a["beats"] = tuned[n].get("beats", []); a["pin"] = None
        chains[n] = a; print(f"  {n:14s} {a['duration']:.2f}s  chain {a['chain']}  peak {a['stats']['peak_max']:.0f} deg/s")

    print("  pair matrix ...", end="", flush=True)
    pairs = {a: {b: pair_scan(moves[a], moves[b]) for b in move_names} for a in move_names}
    print(" done")

    hubs = json.load(open(os.path.join(repo, "sim", "hubs.json"))); trans = json.load(open(os.path.join(repo, "sim", "transitions.json")))
    hub_out = {"doc": hubs.get("_doc", ""), "poses": {}}
    for k, v in hubs.items():
        if k.startswith("_"): continue
        anchors, h, tp = fk(v); hub_out["poses"][k] = {"q_sim": v, "hand": r4(h), "tip": r4(tp), "hand_r": round(float(np.hypot(h[0], h[1]) * np.sign(h[0])), 4)}
    trans_out = {"doc": trans.get("_doc", ""), "routes": {k: v for k, v in trans.items() if not k.startswith("_")}}

    copied = []
    if not args.no_videos:
        for f in sorted(glob.glob(os.path.join(repo, "videos", "*.mp4"))):
            if copy_if_changed(f, os.path.join(VIDEOS, os.path.basename(f))): copied.append(os.path.basename(f))
    videos = sorted(os.path.basename(f) for f in glob.glob(os.path.join(VIDEOS, "*.mp4")))

    meta = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"), "repo": repo, "source": tuned_path,
        "joints": JOINTS, "joint_labels": JOINT_LABELS, "joint_range_sim": JOINT_RANGE,
        "conventions": {"units": "degrees, seconds, metres", "q": "[pan, lift, elbow, wrist_flex, wrist_roll, jaw] as the real arm plays them",
                        "roll_offset": ROLL_OFFSET, "roll_note": "real wrist_roll = sim roll + 76 (sim 0 = sword on top)",
                        "pan": "+ = the arm's own right", "pitch": "positive lift/elbow/wrist pitch the chain down", "jaw": "0 shut, 100 open",
                        "hand": "metres from the arm's own pan axis: x forward, z up from the base plane"},
        "rules": {"hand_x_max": HAND_X_MAX, "centre_x": CENTRE_X, "base_gap": BASE_GAP, "servo_cap_dps": SERVO_CAP, "lift_min": LIFT_MIN,
                  "roll_real_limit": ROLL_REAL_LIMIT, "wrist_floors": WRIST_FLOORS,
                  "wrist_floors_note": "measured on the arm 2026-09-12 (pitch housing 0.120 m, roll housing 0.092 m); dropped from tune.py in the lift>=-89 commit, kept here as an advisory line",
                  "touch_cm": 2.4},
        "beat": {"beat_s": BEAT, "impact_s": IMPACT, "guard_s": GUARD, "react_s": 1.07,
                 "note": "chain.py pins an attack/feint's last key at 1.0 s and a block's guard key at 0.55 s; moves are front-padded, never time-scaled"},
        "geometry": {"chain": [{"body": n, "pos": p, "quat_wxyz": q} for n, p, q in CHAIN], "pan_axis_x": PAN_AXIS_X, "hilt_reach": HILT_REACH, "sword_len": SWORD_LEN,
                     "sword_dir_local": r4(SWORD_DIR_LOCAL), "sword_start_local": r4(SWORD_START_LOCAL),
                     "note": "SO101 MJCF chain; B drawn as a mirrored SO101 (the real B is an SO100 with the joint mapping in sim/arena.py)"},
        "moves": move_names, "chains": chain_names, "videos": videos, "reel": "videos/reel_moves.mp4" if "reel_moves.mp4" in videos else None,
    }
    json.dump(moves, open(os.path.join(DATA, "moves.json"), "w"), separators=(",", ":"))
    json.dump(chains, open(os.path.join(DATA, "chains.json"), "w"), separators=(",", ":"))
    json.dump({"moves": move_names, "beat": meta["beat"], "pairs": pairs}, open(os.path.join(DATA, "pairs.json"), "w"), separators=(",", ":"))
    json.dump(hub_out, open(os.path.join(DATA, "hubs.json"), "w"), indent=1)
    json.dump(trans_out, open(os.path.join(DATA, "transitions.json"), "w"), indent=1)
    json.dump(meta, open(os.path.join(DATA, "meta.json"), "w"), indent=1)
    sizes = {f: os.path.getsize(os.path.join(DATA, f)) for f in os.listdir(DATA)}
    print(f"wrote {DATA}: " + ", ".join(f"{k} {v // 1024} KB" for k, v in sorted(sizes.items())))
    print(f"videos: {len(videos)} in {VIDEOS}" + (f" ({len(copied)} copied)" if copied else " (up to date)"))

if __name__ == "__main__":
    main()
