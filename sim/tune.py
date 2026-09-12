"""Generate every move from move_params.py: key poses -> Catmull-Rom spline -> speed check -> arm/motions_tuned.json
(+ a sim video per move in out/tuned_<NAME>.mp4).
    ../.venv/bin/python tune.py ALL          # regenerate all moves
    ../.venv/bin/python tune.py ATTACK_HIGH  # one move
Edit move_params.py, not this file, to change a move."""
import sys, os, json, numpy as np, mujoco, imageio
import arena, ik
from move_params import PARAMS
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
SERVO_CAP_DPS = 300.0
WRIST_Z_MIN = 0.092   # HARD RULE (user, 2026-09-12): the wrist joints never go below this height above the base plane, or the arm hits the board

def wrist_z(q):
    arena.set_pose(ik._m, ik._d, q, np.zeros(6))
    return float(min(ik._d.jnt("A_wrist_flex").xanchor[2], ik._d.jnt("A_wrist_roll").xanchor[2]))

def enforce_floor(q, label=""):
    """If a key pose puts a wrist joint below WRIST_Z_MIN, move to the nearest joint config (lift/elbow/wrist) that clears it,
    keeping the hand position and sword pitch as close as possible."""
    q = np.array(q, float); z0 = wrist_z(q)
    if z0 >= WRIST_Z_MIN: return q
    h0, t0, p0 = ik.fk(q); best = None
    for dl in np.arange(-30, 31, 3):
        for de in np.arange(-30, 31, 3):
            for dw in np.arange(-30, 31, 3):
                qq = q.copy(); qq[1:4] += (dl, de, dw); qq = np.clip(qq, ik.LO + 1, ik.HI - 1)
                if wrist_z(qq) < WRIST_Z_MIN: continue
                h, tt, p = ik.fk(qq)
                cost = abs(dl) + abs(de) + abs(dw) + 400 * (abs(h[0] - h0[0]) + abs(h[2] - h0[2])) + 2 * abs(((p - p0 + 180) % 360) - 180)
                if best is None or cost < best[0]: best = (cost, qq, h, p)
    if best is None: print(f"    FLOOR: {label} cannot be fixed within +-30 deg"); return q
    print(f"    FLOOR: {label} wrist was {z0:.3f} m -> {wrist_z(best[1]):.3f} m; joints {np.round(q[1:4]).astype(int).tolist()} -> {np.round(best[1][1:4]).astype(int).tolist()}, hand ({h0[0]:.2f},{h0[2]:.2f})->({best[2][0]:.2f},{best[2][2]:.2f}), pitch {p0:.0f}->{best[3]:.0f}")
    return best[1]
ROLL_OFFSET = 76.0      # real-arm wrist_roll reading when the sword is exactly on top (sim roll 0). Confirmed by eye 2026-09-12.
REAL = json.load(open("../arm/motions_real.json")); OUT = "../arm/motions_tuned.json"
BEAT = 1.4            # seconds per beat (impact/guard pinned inside it by the chain compiler)
_r = PARAMS["REST"]["joints"]; REST = np.array([_r["pan"], _r["lift"], _r["elbow"], _r["wrist"], _r["roll"], _r["jaw"]], float); REST[4] -= ROLL_OFFSET   # params/REST.json is in real degrees
POSE_CACHE = "pose_cache.json"

def ik_pose(x, z, pitch, pan=0, roll=0, jaw=0):
    q, err, h, t = ik.solve(x, z, pitch, pan=pan, roll=roll); q[5] = jaw
    if err[0] + err[1] > 0.01 or err[2] > 5: print(f"    WARNING ik ({x},{z},{pitch}) off by {np.round(err,3).tolist()}")
    return q

def pose_search(x, z, pan, pitch, tol, roll=0, jaw=0, near=None):
    """Brute force over the joint grid: hand within 1.5 cm of (x, z), sword pitch within tol of `pitch`, tip above the
    table; among those, the least joint travel from `near` (default REST). Cached because it is slow."""
    near = REST if near is None else near
    key = json.dumps([x, z, pan, pitch, tol, [round(float(v)) for v in near[1:4]]]); cache = json.load(open(POSE_CACHE)) if os.path.exists(POSE_CACHE) else {}
    if key in cache: q = np.array(cache[key]); q[4] = roll; q[5] = jaw; return q
    best = None
    for l in np.arange(ik.LO[1] + 2, ik.HI[1] - 1, 2.0):
        for e in np.arange(ik.LO[2] + 2, ik.HI[2] - 1, 2.0):
            for w in np.arange(ik.LO[3] + 2, ik.HI[3] - 1, 2.0):
                q = np.array([pan, l, e, w, 0, 0.0]); h, t, p = ik.fk(q); r = np.hypot(h[0], h[1])
                if abs(r - x) > 0.015 or abs(h[2] - z) > 0.015 or abs(p - pitch) > tol or t[2] < 0.03: continue
                score = float(np.sum(np.abs(q[1:4] - near[1:4]))) + 300 * (abs(r - x) + abs(h[2] - z)) + 0.5 * abs(p - pitch)
                if best is None or score < best[0]: best = (score, q, p)
    if best is None: raise RuntimeError(f"no pose near ({x},{z}) with sword pitch {pitch}+-{tol}; widen tol or move the hand")
    print(f"    pose_search ({x},{z},pan {pan},pitch {pitch}) -> {np.round(best[1],0).astype(int).tolist()} sword pitch {best[2]:.0f}")
    cache[key] = best[1].tolist(); json.dump(cache, open(POSE_CACHE, "w")); q = best[1]; q[4] = roll; q[5] = jaw; return q

def cap(P, which, jaw=None):
    """Captured pose (real degrees, from the arm) as sim joints, or None."""
    c = (P.get("captured") or {}).get(which)
    if not c: return None
    q = np.array(c, float); q[4] -= ROLL_OFFSET
    if jaw is not None: q[5] = jaw
    return q

# ---------------- recipes: list of (key pose, seconds to reach it) ----------------
def attack_high(P):
    e = P["end"]; k3 = np.array([e["pan"], e["lift"], e["elbow"], e["wrist"], 0, 0], float)
    if cap(P, "end") is not None: k3 = cap(P, "end", jaw=0)
    k2 = k3.copy(); k2[1] -= P["cock"]["lift_back"]; k2[3] -= P["cock"]["wrist_up"]; k2[5] = P["jaw_open"]
    if cap(P, "start") is not None: k2 = cap(P, "start", jaw=P["jaw_open"])
    k1 = k2.copy(); k1[5] = 5
    return [(REST, 0), (k1, P["t_raise"]), (k2, P["t_cock"]), (k3, P["t_slam"])]

def attack_low(P, mirror=False):
    e, s = P["end"], P["start"]; sgn = -1 if mirror else 1
    k1 = ik_pose(e["x"] + s["dx"], e["z"] + s["dz"], 0, pan=s["pan"], roll=P["roll"], jaw=P["jaw_open"])
    k2 = ik_pose(e["x"], e["z"], 0, pan=e["pan"], roll=P["roll"], jaw=0)
    if mirror:   # the sword hangs off one side of the jaw, so mirroring joints does not mirror the blade: re-solve on the mirrored side
        for k, (x, z, pan, jaw) in ((k1, (e["x"] + s["dx"], e["z"] + s["dz"], s["pan"], P["jaw_open"])), (k2, (e["x"], e["z"], e["pan"], 0))):
            seed = k.copy(); seed[0] *= -1; seed[4] *= -1
            q, err, h, tt = ik.solve(x, z, 0, pan=-pan, roll=-P["roll"], init=seed); q[5] = jaw; k[:] = q
            if err[0] + err[1] > 0.01 or err[2] > 5: print(f"    WARNING mirror ik ({x},{z}) off by {np.round(err,3).tolist()}")
    if cap(P, "start") is not None: k1 = cap(P, "start", jaw=P["jaw_open"])
    if cap(P, "end") is not None: k2 = cap(P, "end", jaw=0)
    return [(REST, 0), (k1, P["t_windup"] + (0.15 if mirror else 0)), (k2, P["t_slash"])]

def block(P):
    if "joints" in P:   # explicit joint angles (sideways bar)
        j = P["joints"]; k = np.array([P["pan"], j["lift"], j["elbow"], j["wrist"], P["roll"], P["jaw"]], float)
    else:
        k = pose_search(P["x"], P["z"], P["pan"], P["pitch"], P["tol"])
    if cap(P, "end") is not None: k = cap(P, "end")
    return [(REST, 0), (k, P["t_move"]), (k, P["t_hold"])]

def feint(P):
    like = P["like"]; base = PARAMS[like]
    if like.startswith("ATTACK_HIGH"):
        rec = attack_high(base)[:3]                                # REST, raised, cocked
        kb = rec[1][0].copy(); kb[1] += P["pull_back"]["lift"]; kb[3] += P["pull_back"]["wrist"]; kb[5] = P["jaw_after"]
        if cap(P, "start") is not None: rec[1] = (cap(P, "start", jaw=5), rec[1][1]); rec[2] = (cap(P, "start", jaw=rec[2][0][5]), rec[2][1])
        if cap(P, "end") is not None: kb = cap(P, "end", jaw=P["jaw_after"])
        return rec + [(kb, P["t_back"])]
    mirror = "mirror_of" in base; src = PARAMS[base["mirror_of"]] if mirror else base
    rec = attack_low(src, mirror=mirror)[:2]                       # REST, windup
    kb = rec[1][0].copy(); kb[1] += P["pull_back"]["lift"]; kb[3] += P["pull_back"]["wrist"]; kb[5] = P["jaw_after"]   # pull back = windup + joint offsets
    if cap(P, "start") is not None: rec[1] = (cap(P, "start", jaw=rec[1][0][5]), rec[1][1])
    if cap(P, "end") is not None: kb = cap(P, "end", jaw=P["jaw_after"])
    return rec + [(kb, P["t_back"])]

def recipe(name):
    P = PARAMS[name]
    if name == "REST":
        r = cap(P, "end") if cap(P, "end") is not None else REST; return [(r, 0), (r, 0.5)]
    if "mirror_of" in P: return attack_low(PARAMS[P["mirror_of"]], mirror=True)
    if name.startswith("ATTACK_HIGH"): return attack_high(P)
    if name.startswith("ATTACK_LOW"): return attack_low(P)
    if name.startswith("BLOCK"): return block(P)
    if name.startswith("FEINT"): return feint(P)
    raise KeyError(name)

# ---------------- generation ----------------
def catmull_rom(keys, times, hz=50.0):
    P = np.array(keys, float); T = np.array(times, float); n = len(P); V = np.zeros_like(P)
    for i in range(1, n - 1): V[i] = (P[i + 1] - P[i - 1]) / (T[i + 1] - T[i - 1])
    ts = np.arange(0, T[-1] + 1e-9, 1 / hz); out = []
    for t in ts:
        i = min(np.searchsorted(T, t, side="right") - 1, n - 2); h = T[i + 1] - T[i]; s = (t - T[i]) / h
        h00, h10, h01, h11 = 2*s**3 - 3*s**2 + 1, s**3 - 2*s**2 + s, -2*s**3 + 3*s**2, s**3 - s**2
        out.append(h00 * P[i] + h10 * h * V[i] + h01 * P[i + 1] + h11 * h * V[i + 1])
    return ts, np.array(out)

def replay(name, ts, Q, fps=30):
    spec, m = arena.build(); d = mujoco.MjData(m); arena.set_pose(m, d, Q[0], REST); d.qvel[:] = 0
    r = mujoco.Renderer(m, 544, 960); cam = arena.make_camera(view="iso"); cam.distance = 0.9; cam.lookat[:] = [0.15, 0, 0.18]; cam.azimuth = 135; cam.elevation = -20
    opt = arena.render_opts(); frames = []; DT = m.opt.timestep; nf = 0; T = ts[-1] + 0.5
    qi = lambda tt: np.array([np.interp(tt, ts, Q[:, k]) for k in range(6)])
    for i in range(int(T / DT)):
        tt = i * DT; d.ctrl[:6] = arena.q_to_model("A", qi(tt)); d.ctrl[6:] = arena.q_to_model("B", REST); mujoco.mj_step(m, d)
        if tt >= nf / fps: r.update_scene(d, cam, opt); frames.append(r.render().copy()); nf += 1
    imageio.mimwrite(f"out/tuned_{name}.mp4", frames, fps=fps, codec="libx264", quality=8, macro_block_size=1)
    idx = np.linspace(0, len(frames) - 1, 8).astype(int)
    strip = np.concatenate([np.concatenate([frames[i] for i in idx[:4]], axis=1), np.concatenate([frames[i] for i in idx[4:]], axis=1)], axis=0)
    imageio.imwrite(f"out/tuned_{name}_strip.png", strip[::2, ::2])

def generate(name, render=True):
    print(f"== {name}")
    rec = recipe(name); keys = [enforce_floor(k, f"{name} key {i}") for i, (k, _) in enumerate(rec)]; times = np.cumsum([t for _, t in rec])
    for k, T in zip(keys, times): print(f"  key @ {T:.2f}s  {np.round(k, 0).astype(int).tolist()}")
    ts, Q = catmull_rom(keys, times); Q[:, 5] = np.clip(Q[:, 5], 0, 100)
    zmin = min(wrist_z(q) for q in Q[::3])
    if zmin < WRIST_Z_MIN - 0.005: print(f"    FLOOR WARNING: trajectory dips to wrist z {zmin:.3f} m between keys (limit {WRIST_Z_MIN})")
    peak = np.abs(np.gradient(Q, ts, axis=0)).max(0); over = [JOINTS[k] for k in range(5) if peak[k] > SERVO_CAP_DPS]
    print("  peak deg/s:", dict(zip(JOINTS, np.round(peak).astype(int).tolist())), ("OVER CAP: " + str(over)) if over else "")
    import fcntl; lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX)
    tuned = json.load(open(OUT)) if os.path.exists(OUT) else {}
    Qr = Q.copy(); Qr[:, 4] += ROLL_OFFSET; keys_r = [np.array(k) + np.array([0, 0, 0, 0, ROLL_OFFSET, 0]) for k in keys]
    tuned[name] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in row] for row in Qr], "roll_offset": ROLL_OFFSET,
                   "joints": JOINTS, "keys": [[round(float(x), 1) for x in k] for k in keys_r], "key_times": [round(float(x), 2) for x in times], "params": PARAMS[name]}
    json.dump(tuned, open(OUT, "w")); fcntl.flock(lock, fcntl.LOCK_UN); print(f"  saved {name}: {ts[-1]:.2f}s")
    if render: replay(name, ts, Q)

if __name__ == "__main__":
    names = list(PARAMS) if sys.argv[1:] in (["ALL"], ["REST"]) else sys.argv[1:]   # changing REST regenerates everything
    for n in names: generate(n)
