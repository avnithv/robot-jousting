"""Chain compiler v2: states, connectors, flourishes, per-arm.
    ../.venv/bin/python chain.py CHAIN_A ATTACK_HIGH BLOCK_LEFT ATTACK_LOW_RL [--arm A|B] [--seed 1]
    ../.venv/bin/python chain.py pair ATTACK_HIGH BLOCK_LEFT -- BLOCK_HIGH ATTACK_LOW_LR      # A chain vs B chain, beats aligned, pair render
Beat model: BEAT s per move; attacks pin their strike key at IMPACT s (then retract and return along the strike line to the
strike-ready pose), feints pin their mid-swing stop at IMPACT, blocks pin their guard key at GUARD s; the arm holds
to the beat end. The gap before each move's windup is filled by a CONNECTOR: a flourish (flourishes.json) if one fits the
window, else a direct blend if the straight joint path is safe, else a route through the MID hub (hubs.json).
Charge/ride-in happens at REST. Connectors never touch a move's keys or its pinned time."""
import sys, os, json, random, numpy as np, mujoco, imageio
import arena, ik, tune
from tune import JOINTS, OUT, catmull_rom, recipe
BEAT, IMPACT, GUARD = 1.4, 1.0, 0.55
RETURN_T = 0.4   # after an attack's retract, seconds to come back along the strike line to the strike-ready pose before any connector
try:   # arm/turn_profile.json overrides the beat model (edit it there; every consumer reads the same file)
    _P = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "arm", "turn_profile.json")))
    BEAT, IMPACT, GUARD, RETURN_T = float(_P.get("beat", BEAT)), float(_P.get("impact", IMPACT)), float(_P.get("guard", GUARD)), float(_P.get("return_t", RETURN_T))
except Exception: pass
TIP_MIN = -0.10             # blade tip floor (m). The real board sits below the sim base plane; the captured left guard reaches -0.07 without touching.
REACH_MAX = 0.40            # hand reach allowed in transit (m): the extended low slashes reach 0.38; contact safety comes from the calibrated stops
BLEND_RATE = 170.0          # deg/s used to size transitions (Catmull-Rom peaks ~1.5x the mean, so this keeps peaks < 300)
HERE = os.path.dirname(os.path.abspath(__file__))
HUBS = {k: np.array(v, float) for k, v in json.load(open(os.path.join(HERE, "hubs.json"))).items() if not k.startswith("_")}
def load_hubs():
    """Hub poses for the CURRENT arm (from its params/<STATE>.json), falling back to hubs.json."""
    global HUBS
    HUBS = {n: (tune.state_pose(n) if n in tune.PARAMS else HUBS[n]) for n in ("MID", "SALUTE", "LOW_TIP")}
LIB = os.path.join(HERE, "transitions")
FLOURISHES = {k: v for k, v in json.load(open(os.path.join(HERE, "flourishes.json"))).items() if not k.startswith("_")}
FAMILY = {"ATTACK_HIGH": "high", "FEINT_HIGH": "high", "ATTACK_LOW_LR": "low_left", "FEINT_LEFT": "low_left", "ATTACK_LOW_RL": "low_right", "FEINT_RIGHT": "low_right",
          "BLOCK_HIGH": "bar", "BLOCK_LEFT": "guard", "BLOCK_RIGHT": "guard", "BLOCK_MIDDLE": "guard", "REST": "rest"}

def start_index(move):
    """Index (within the recipe, after dropping REST) of the move's START pose: the pose a transition must reach before the move
    does its own thing. Blocks/states: the held pose. Low attacks/feints: the wide windup. High attack/feint: the COCKED pose
    (sword up, jaw open) right before the chop; the raise into it belongs to the transition."""
    return 1 if move in ("ATTACK_HIGH", "FEINT_HIGH") else 0

def move_keys(move):
    """(start pose, [(pose, seconds), ...] from the start pose onward)"""
    rec = [(np.array(k, float), float(d)) for k, d in recipe(move)][1:]
    i = start_index(move); return rec[i][0], rec[i:]

def pin_of(move):
    if move in tune.STATES: return ("first", GUARD)   # a state step: arrive by GUARD time and hold
    """Which key is pinned to the beat clock: blocks pin the guard key at GUARD; attacks pin the impact (last) key at IMPACT;
    feints pin the mid-swing stop (third key from the end) at IMPACT so the fake commits when a real attack would land."""
    if move.startswith("BLOCK"): return ("first", GUARD)
    if move.startswith("FEINT"): return ("feint", IMPACT)
    return ("strike", IMPACT)   # attacks: the strike key itself lands at IMPACT (the retract and the return follow it)
def seg_time(a, b): return max(float(np.max(np.abs(b[:5] - a[:5])) / BLEND_RATE), 0.15)

def path_ok(a, b, n=12):
    """Straight joint-space path from a to b: hand reach <= 0.30, hand above the table, tip above TIP_MIN, roll inside the wrap, lift floor."""
    for s in np.linspace(0, 1, n):
        q = a + s * (b - a); h, t, p = ik.fk(q)
        if np.hypot(h[0], h[1]) > REACH_MAX or h[2] < 0.0 or t[2] < TIP_MIN or not (-185 <= q[4] <= 100) or q[1] < tune.LIFT_MIN: return False
    return True

def resolve_via(via):
    return [HUBS[v] if isinstance(v, str) else np.array(v, float) for v in via]

def matches(pattern, move):
    return pattern == "*" or pattern == move or pattern == FAMILY.get(move, "") or pattern in HUBS and move == pattern

def library_paths(prev_move, move):
    """Precomputed transition paths for this handoff from sim/transitions/<END>__<START>.json (authored + validated)."""
    f = os.path.join(LIB, f"{prev_move}__{move}.json")
    if not os.path.exists(f): return []
    return json.load(open(f)).get("paths", [])

def candidates(prev_move, prev_pose, move, first, window, last_flourish=None):
    """All valid connectors for this gap: (name, path poses, seconds needed, score). Higher score wins.
    Library paths (precomputed) come first; then flourishes.json; then a direct blend; then hub routes."""
    out = []
    for p in library_paths(prev_move, move):
        path = resolve_via(p.get("via", [])); segs = list(zip([prev_pose] + path, path + [first]))
        if all(path_ok(a, b) for a, b in segs):
            durs = list(p.get("durations", [])) + [seg_time(path[-1] if path else prev_pose, first)]
            need = max(sum(durs), sum(seg_time(a, b) for a, b in segs)); fits = need <= window
            base = 5.0 + (0 if p.get("style") == "plain" or p["name"] == "direct" else 1.5) - (2 if p["name"] == last_flourish else 0)
            out.append((f"lib:{p['name']}", path, need, (base - 0.1 * need) if fits else (-100 - 10 * need)))
    def add(name, path, base):
        segs = list(zip([prev_pose] + path[:-1] if path else [], path)); segs = list(zip([prev_pose] + path, path + [first]))
        if all(path_ok(a, b) for a, b in segs):
            need = sum(seg_time(a, b) for a, b in segs); fits = need <= window
            out.append((name, path, need, (base - 0.1 * need) if fits else (-100 - 10 * need)))   # if nothing fits, the fastest wins
    add("direct", [], 2.0)
    for name, f in FLOURISHES.items():
        if matches(f["from"], prev_move) and matches(f["to"], move):
            add(name, resolve_via(f["via"]), 2.0 + f.get("weight", 1) - (2 if name == last_flourish else 0))
    for h in HUBS:
        add(f"via {h}", [HUBS[h]], 1.0)
    return sorted(out, key=lambda c: -c[3])

def strike_index(rec):
    """Index of an attack's strike END key: the last key, unless the last key is a retract (moves back toward the previous key)."""
    keys = [k for k, _ in rec]
    if len(rec) >= 3:
        a, b, cc = keys[-3], keys[-2], keys[-1]
        if np.dot(cc - b, a - b) > 0 and np.linalg.norm(cc - b) < 0.6 * np.linalg.norm(a - b): return len(rec) - 2
    return len(rec) - 1

STOPS_FILE = os.path.join(HERE, "contact_stops.json")
def apply_stop(rec, stop_pose_sim, retract=0.2, t_retract=0.3):
    """Truncate a move's strike at a calibrated stop: the strike END key becomes the stop pose (strike time scaled by the
    remaining fraction) and the retract, if any, backs out from there."""
    keys = [k for k, _ in rec]; durs = [d for _, d in rec]
    end_i = len(rec) - 1 if not (len(rec) >= 2 and np.allclose(keys[-1][:5], keys[-2][:5], atol=15) and durs[-1] <= 0.35 and len(rec) > 2 and False) else len(rec) - 1
    # find the strike END key: the last key whose successor (if any) is a retract (moves back toward the previous key)
    strike_i = len(rec) - 1
    if len(rec) >= 3:
        a, b, cc = keys[-3], keys[-2], keys[-1]
        if np.dot(cc - b, a - b) > 0 and np.linalg.norm(cc - b) < 0.6 * np.linalg.norm(a - b): strike_i = len(rec) - 2   # last key is a retract
    start = keys[strike_i - 1]; full = keys[strike_i]; frac = float(np.linalg.norm(stop_pose_sim[:5] - start[:5]) / max(np.linalg.norm(full[:5] - start[:5]), 1e-6))
    new = list(rec); new[strike_i] = (stop_pose_sim, max(durs[strike_i] * min(frac, 1.0), 0.08))
    if strike_i == len(rec) - 2: new[-1] = (stop_pose_sim + retract * (start - stop_pose_sim), durs[-1])
    return new

def compile_chain(moves, name, arm="A", seed=0, beat_extra=None, save=True, verbose=True, stops=None):
    tune.use_arm(arm); load_hubs(); rest = tune.REST.copy(); rng = random.Random(seed)
    tuned = json.load(open(OUT)); suffix = "" if arm == "A" else f"@{arm}"
    keys = [rest]; times = [0.0]; beats = []; prev_move = "REST"; t_beat = 0.0; stretches = []; last_fl = None
    for move in moves:
        start, rec = move_keys(move)                                          # transition targets START; the move plays from there
        if stops and len(beats) in stops:                                     # a calibrated contact stop for this beat's pairing
            rec = apply_stop(rec, stops[len(beats)]); print(f"  {move:14s} strike truncated at the calibrated stop") if verbose else None
        strike_i = strike_index(rec) if move.startswith("ATTACK") else None
        if strike_i is not None: rec = rec + [(rec[0][0].copy(), RETURN_T)]   # pull back the way it came, all the way to the strike-ready pose, before any connector
        pin_which, pin_t = pin_of(move); pin_i = {"first": 0, "last": len(rec) - 1, "feint": len(rec) - 3, "strike": strike_i}[pin_which]
        windup = sum(d for _, d in rec[1:pin_i + 1]); window = pin_t - windup
        cands = candidates(prev_move, keys[-1], move, rec[0][0], window, last_fl)
        if not cands: raise RuntimeError(f"no safe connector {prev_move} -> {move}")
        top = [c for c in cands if c[3] >= cands[0][3] - 0.5]; cname, path, need, _ = rng.choice(top)   # a little variety among near-equal options
        last_fl = cname.replace("lib:", "") if (cname in FLOURISHES or cname.startswith("lib:")) else None
        t_tr = max(window, need); stretch = t_tr - window
        if beat_extra is not None: stretch = max(stretch, beat_extra[len(beats)]); t_tr = window + stretch
        stretches.append(stretch)
        if verbose: print(f"  {move:14s} connector: {cname:14s} {t_tr:.2f}s (needs {need:.2f}, window {window:.2f})" + (f"  ** beat stretched {stretch:.2f}s" if stretch > 1e-3 else ""))
        full = path + [rec[0][0]]; segs = list(zip([keys[-1]] + full[:-1], full)); w = np.array([seg_time(a, b) for a, b in segs]); w = w / w.sum() * t_tr
        t = t_beat
        for (a, b), dt in zip(segs, w): t += dt; keys.append(b); times.append(t)
        for k, d in rec[1:]: t += d; keys.append(k); times.append(t)
        beat_end = max(t_beat + BEAT + stretch, t + 0.05); keys.append(keys[-1].copy()); times.append(beat_end)
        beats.append({"move": move, "start": round(t_beat, 3), "pinned_at": round(t_beat + t_tr + windup, 3), "end": round(beat_end, 3), "connector": cname})
        prev_move = move; t_beat = beat_end
    # disengage: back to REST after the last beat
    keys.append(rest.copy()); times.append(t_beat + max(seg_time(keys[-1], rest), 0.6))
    ts, Q = catmull_rom(keys, times); Q[:, 5] = np.clip(Q[:, 5], 0, 100)
    peak = np.abs(np.gradient(Q, ts, axis=0)).max(0); over = [JOINTS[k] for k in range(5) if peak[k] > tune.SERVO_CAP_DPS]
    if verbose: print(f"  total {ts[-1]:.2f}s; peak deg/s {dict(zip(JOINTS, np.round(peak).astype(int).tolist()))}" + (f"  OVER CAP: {over}" if over else ""))
    if save:
        import fcntl; lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX); tuned = json.load(open(OUT))
        Qr = Q.copy(); Qr[:, 4] += tune.ROLL_OFFSET; keys_r = [np.array(k) + np.array([0, 0, 0, 0, tune.ROLL_OFFSET, 0]) for k in keys]
        tuned[name] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in r] for r in Qr], "roll_offset": tune.ROLL_OFFSET, "arm": arm, "joints": JOINTS,
                       "keys": [[round(float(x), 1) for x in k] for k in keys_r], "key_times": [round(float(x), 2) for x in times], "chain": moves, "beats": beats, "seed": seed}
        json.dump(tuned, open(OUT + ".tmp", "w")); os.replace(OUT + ".tmp", OUT); fcntl.flock(lock, fcntl.LOCK_UN)   # atomic: a reader never sees a half-written file
    return ts, Q, beats, stretches

def pair_stops(ours, theirs):
    """Per-beat calibrated stops for each arm from contact_stops.json (keys 'A:ATTACK|B:DEFENCE' / 'B:ATTACK|A:DEFENCE')."""
    if not os.path.exists(STOPS_FILE): return {}, {}
    S = json.load(open(STOPS_FILE)); arms_cfg = json.load(open(os.path.join(HERE, "..", "arm", "arms.json"))); sa, sb = {}, {}
    for i, (a, b) in enumerate(zip(ours, theirs)):
        if f"A:{a}|B:{b}" in S:
            r = S[f"A:{a}|B:{b}"]; q = np.array(r["stop_pose_real"], float); q[4] -= arms_cfg["A"]["roll_offset"]; sa[i] = q
            if "stop_pose_real_B" in r: q = np.array(r["stop_pose_real_B"], float); q[4] -= arms_cfg["B"]["roll_offset"]; sb[i] = q   # clash: both strikes truncated
        if f"B:{b}|A:{a}" in S: q = np.array(S[f"B:{b}|A:{a}"]["stop_pose_real"], float); q[4] -= arms_cfg["B"]["roll_offset"]; sb[i] = q
    return sa, sb

def compile_pair(ours, theirs, seed=0, render=True):
    sa, sb = pair_stops(ours, theirs)
    if sa or sb: print("calibrated stops applied at beats:", {"A": sorted(sa), "B": sorted(sb)})
    sA = compile_chain(ours, "CHAIN_A", "A", seed, verbose=False, save=False, stops=sa)[3]; sB = compile_chain(theirs, "CHAIN_B", "B", seed, verbose=False, save=False, stops=sb)[3]
    n = max(len(sA), len(sB)); extra = [max((sA + [0] * n)[i], (sB + [0] * n)[i]) for i in range(n)]
    print("beat lengths:", [round(BEAT + e, 2) for e in extra])
    print("== CHAIN_A (arm A)", ours); compile_chain(ours, "CHAIN_A", "A", seed, beat_extra=extra, stops=sa)
    print("== CHAIN_B (arm B)", theirs); compile_chain(theirs, "CHAIN_B", "B", seed, beat_extra=extra, stops=sb)
    # The pair pass does two things: the blade-distance SAFETY CHECK (always) and a MuJoCo video (optional).
    # The game only needs the check, and the render is the overwhelming bulk of the time. server.py passes --no-render.
    import pair; pair.run("CHAIN_A", "CHAIN_B", render=render)

if __name__ == "__main__":
    a = sys.argv[1:]; seed = 0; arm = "A"
    if "--seed" in a: i = a.index("--seed"); seed = int(a[i + 1]); a = a[:i] + a[i + 2:]
    if "--arm" in a: i = a.index("--arm"); arm = a[i + 1]; a = a[:i] + a[i + 2:]
    render = "--no-render" not in a
    if not render: a = [x for x in a if x != "--no-render"]
    if a and a[0] == "pair":
        i = a.index("--"); compile_pair(a[1:i], a[i + 1:], seed, render=render)
    else:
        name, moves = a[0], a[1:]; print("==", name, moves, "arm", arm); ts, Q, beats, _ = compile_chain(moves, name, arm, seed); tune.replay(name, ts, Q)
