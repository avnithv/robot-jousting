"""Generate two-arm emote scenes: emotes/<family>.py -> spline both arms -> checks -> two-arm MuJoCo clip + filmstrip
+ GIF + out/emotes/<NAME>.json, and the per-arm 50 Hz trajectories into arm/motions_tuned.json as NAME (arm A) and NAME@B.
    ../.venv/bin/python emote.py openers                 # every scene in emotes/openers.py
    ../.venv/bin/python emote.py openers SALUTE          # one scene
    ../.venv/bin/python emote.py ALL                     # every family
    ../.venv/bin/python emote.py openers --swap          # ... and render the mirror casting to <NAME>_swap.mp4/.gif
    ../.venv/bin/python emote.py manifest                # rebuild out/emotes/manifest.json from the per-scene json
    ../.venv/bin/python emote.py reel                    # out/emotes/reel_emotes.mp4 with title cards
    flags: --no-render (checks only), --no-gif, --swap
Checks (per arm, sim degrees): shoulder lift >= -89 (hard rule); no joint faster than the recorded move library
already moves it (JOINT_CAP_DPS, measured at import from arm/motions_tuned.json and clamped by the 300 deg/s servo
rule); hand reach <= 0.30 m from the own base, hand z >= 0.04, blade tip z >= 0.02 (unless allow_table, which may be
per arm), sim roll in [-180, 100], and the carriage inside 0..200 mm of gantry travel at no more than 0.40 m/s (the
24000 mm/min feed ceiling -- a datasheet number, since the library has no recorded carriage motion); and in the
two-arm sim: closest blade-to-blade distance and any blade/body or blade/blade contacts (reported as warnings;
collision handling is managed later).
Gantry: every keyframe carries a 7th channel, that arm's carriage position in metres back from the 19.5 in charge-in
stop (0 = charged in = the hard stop, 0.200 = the daemon's "apart"), which is the GRBL work coordinate of its axis
(A -> X, B -> Y). It defaults to 0, so scenes that never mention the gantry behave exactly as before. The clip is
rendered on arena.build(gantry=True) with the carriages driven from that channel, and each saved trajectory carries
`gantry_mm` and `gantry_axis` beside the six servo columns."""
import sys, os, json, glob, importlib, time, fcntl, numpy as np, mujoco, imageio
from PIL import Image, ImageDraw, ImageFont
import arena, ik, tune
from tune import REST, ROLL_OFFSET, JOINTS, OUT, catmull_rom, SERVO_CAP_DPS, LIFT_MIN
import emote_lib as L
HERE = os.path.dirname(os.path.abspath(__file__)); OUTDIR = os.path.join(HERE, "out", "emotes"); os.makedirs(OUTDIR, exist_ok=True)
REACH_MAX, HAND_Z_MIN, TIP_Z_MIN, ROLL_LO, ROLL_HI = 0.30, 0.04, 0.02, -180.0, 100.0
# Blade-length override for the geometry checks only (the clip still renders the real arena.SWORD_LEN).
# The physical blades are being lengthened, so re-run any family with e.g. EMOTE_SWORD_EXTRA_M=0.0508 to see
# which scenes would put the longer tip through the table.  Default 0 = the shipped blade, nothing changes.
SWORD_EXTRA = float(os.environ.get("EMOTE_SWORD_EXTRA_M", "0") or 0)
if SWORD_EXTRA:
    _sp, _mm = arena.build(sword_len=arena.SWORD_LEN + SWORD_EXTRA); ik._m, ik._d = _mm, mujoco.MjData(_mm)
    print(f"** blade override: sword_len {arena.SWORD_LEN:.4f} -> {arena.SWORD_LEN + SWORD_EXTRA:.4f} m (checks only, clips unchanged)")

# ---- speed ceiling: never move a joint faster than the recorded move library already does -------------------
# Measured at import with the same gradient method as arm_checks, over the real tuned moves in
# arm/motions_tuned.json (ATTACK_*, BLOCK_*, FEINT_*, REST and their @B variants). CHAIN_* and anything with an
# "emote" record is excluded, so generating emotes can never raise the ceiling on itself.
# The 300 deg/s servo rule stays an outer bound: the library's wrist (348), roll (318) and jaw (301) peaks come
# from single-move spline overshoots that are already over it, so for those three the rule binds instead.
LIB_FALLBACK = [146.2, 192.3, 165.0, 347.7, 318.0, 301.2]   # used only if motions_tuned.json is unreadable

def library_peaks(path=None):
    """(peak deg/s per joint, {joint: move that set it}) across the recorded move library."""
    try:
        T = json.load(open(path or OUT))
    except Exception as e:
        print(f"emote: cannot read the move library ({e}); using the recorded fallback peaks")
        return np.array(LIB_FALLBACK, float), {j: "fallback" for j in JOINTS}
    best = np.zeros(6); who = {j: "-" for j in JOINTS}
    for name, M in T.items():
        if M.get("emote") or name.startswith("CHAIN") or "t" not in M: continue
        ts = np.array(M["t"], float); Q = np.array(M["q"], float)
        if len(ts) < 3: continue
        p = np.abs(np.gradient(Q, ts, axis=0)).max(0)
        for k in range(6):
            if p[k] > best[k]: best[k] = p[k]; who[JOINTS[k]] = name
    if not best.any(): return np.array(LIB_FALLBACK, float), {j: "fallback" for j in JOINTS}
    return best, who

LIBRARY_PEAK_DPS, LIBRARY_PEAK_SET_BY = library_peaks()
JOINT_CAP_DPS = np.minimum(LIBRARY_PEAK_DPS, SERVO_CAP_DPS)     # what a scene is actually allowed to use
GANTRY_CAP_MPS = arena.GANTRY_MAX_MPS   # the library has no recorded carriage motion, so this stays the
                                        # 24000 mm/min datasheet ceiling rather than an observed peak

W, H, FPS = 960, 540, 30
GIF_W, GIF_H, GIF_FPS = 480, 270, 15      # the shareable clip: <= 8 MB, same camera, bigger relative type
MOOD_RGB = {"A": (235, 80, 70), "B": (90, 140, 240)}
GANTRY_AXIS = {"A": "X", "B": "Y"}        # arm/arms.json: the GRBL axis each carriage rides

def families():
    return sorted(os.path.splitext(os.path.basename(f))[0] for f in glob.glob(os.path.join(HERE, "emotes", "*.py")) if not f.endswith("__init__.py"))

def load(family):
    mod = importlib.import_module(f"emotes.{family}"); importlib.reload(mod); return mod.SCENES

def spline(track):
    """-> ts, Q (n x 6 joint degrees), G (n carriage metres from the charge-in stop), keys (n x 7), key times."""
    keys = [k for k, _ in track.keys]; times = np.cumsum([dt for _, dt in track.keys])
    ts, K = catmull_rom(keys, times)
    Q = np.clip(K[:, :6], L.LO, L.HI); Q[:, 5] = np.clip(Q[:, 5], 0, 100)
    Q[:, 1] = np.maximum(Q[:, 1], LIFT_MIN)   # Catmull-Rom overshoots past a key that sits on the hard limit: clamp instead of leaning on the board
    G = np.clip(K[:, 6], 0.0, arena.GANTRY_TRAVEL)   # ... and past the 19.5 in charge-in stop / the far end of the rail
    return ts, Q, G, keys, times

def arm_checks(ts, Q, G, keys, allow_table):
    """Geometry and speed checks for one arm's trajectory (own frame; valid for A and B alike)."""
    peak = np.abs(np.gradient(Q, ts, axis=0)).max(0)
    over = [JOINTS[k] for k in range(6) if peak[k] > JOINT_CAP_DPS[k] + 0.5]   # all six, against the library ceiling
    reach = hand_z = tip_z = tip_x = None; probs = []
    for q in Q[::2]:
        h, t, p = ik.fk(q); r = float(np.hypot(h[0], h[1])); tx = float(t[0])
        reach = r if reach is None else max(reach, r); hand_z = h[2] if hand_z is None else min(hand_z, h[2]); tip_z = t[2] if tip_z is None else min(tip_z, t[2]); tip_x = tx if tip_x is None else max(tip_x, tx)
    lift_min = float(Q[:, 1].min()); roll = (float(Q[:, 4].min()), float(Q[:, 4].max()))
    if lift_min < LIFT_MIN - 0.5: probs.append(f"lift {lift_min:.0f} < {LIFT_MIN:.0f} (hard rule)")
    if over: probs.append("faster than the recorded library: " + ", ".join(
        f"{j} {peak[JOINTS.index(j)]:.0f} > {JOINT_CAP_DPS[JOINTS.index(j)]:.0f} deg/s"
        f" ({'300 servo rule' if LIBRARY_PEAK_DPS[JOINTS.index(j)] > SERVO_CAP_DPS else LIBRARY_PEAK_SET_BY[j]})" for j in over))
    if reach > REACH_MAX + 0.005: probs.append(f"hand reach {reach:.2f} > {REACH_MAX} m")
    if hand_z < HAND_Z_MIN: probs.append(f"hand z {hand_z:.2f} < {HAND_Z_MIN} m (table)")
    if tip_z < TIP_Z_MIN and not allow_table: probs.append(f"blade tip z {tip_z:.2f} < {TIP_Z_MIN} m (table; set allow_table=True if a tap is intended)")
    if roll[0] < ROLL_LO or roll[1] > ROLL_HI: probs.append(f"roll {roll[0]:.0f}..{roll[1]:.0f} outside [{ROLL_LO:.0f}, {ROLL_HI:.0f}]")
    # gantry: the carriage may not outrun the 24000 mm/min feed ceiling, and may not ask to pass the charge-in stop
    gpk = float(np.abs(np.gradient(G, ts)).max()) if len(G) > 2 else 0.0
    gkey = np.array([k[6] for k in keys], float)
    if gpk > GANTRY_CAP_MPS + 1e-3: probs.append(f"gantry {gpk:.3f} m/s > {GANTRY_CAP_MPS:.2f} m/s (24000 mm/min datasheet ceiling; the library has no recorded carriage motion)")
    if gkey.min() < -1e-6: probs.append(f"gantry key {gkey.min() * 1000:.0f} mm past the charge-in stop (0 is the hard limit)")
    if gkey.max() > arena.GANTRY_TRAVEL + 1e-6: probs.append(f"gantry key {gkey.max() * 1000:.0f} mm > {arena.GANTRY_TRAVEL * 1000:.0f} mm of travel")
    return {"peak_dps": dict(zip(JOINTS, np.round(peak).astype(int).tolist())), "over_cap": over, "reach_max": round(reach, 3), "tip_x_max": round(float(tip_x), 3),
            "hand_z_min": round(float(hand_z), 3), "tip_z_min": round(float(tip_z), 3), "lift_min": round(lift_min, 1),
            "roll_range": [round(roll[0]), round(roll[1])], "gantry_mm": [round(float(G.min()) * 1000, 1), round(float(G.max()) * 1000, 1)],
            "gantry_peak_mps": round(gpk, 3), "cap_dps": [round(float(v), 1) for v in JOINT_CAP_DPS], "problems": probs}

def seg_dist(p1, p2, q1, q2):
    best = 1e9
    for s in np.linspace(0, 1, 24):
        a = p1 + s * (p2 - p1); d = q2 - q1; tt = np.clip(((a - q1) @ d) / (d @ d), 0, 1); b = q1 + tt * d
        best = min(best, float(np.linalg.norm(a - b)))
    return best

def caption(im, sc, t, name=None, s=None, cast=None):
    """Burn in the scene name, both moods and the stage direction in force at time t. `s` scales the type
    (default: to the frame width) so the 480x270 GIF stays readable. `cast` maps each physical arm to the role
    it is playing -- {"A": "A", "B": "B"} normally, {"A": "B", "B": "A"} for the swapped casting -- so the
    labels stay on the arm they belong to (A is always the left/red arm in frame, B the right/blue one)."""
    w, h = im.size; s = (w / 960.0) if s is None else s
    cast = cast or {"A": "A", "B": "B"}
    d = ImageDraw.Draw(im, "RGBA"); f = ImageFont.load_default(size=max(11, int(22 * s))); fs = ImageFont.load_default(size=max(10, int(16 * s)))
    bar = int(46 * s); pad = int(16 * s)
    d.rectangle([0, h - bar, w, h], fill=(10, 8, 6, 200))
    la = f"A  {sc['moods'].get(cast['A'], '')}"; d.text((pad, h - bar + int(10 * s)), la, fill=MOOD_RGB["A"], font=f)
    tb = f"{sc['moods'].get(cast['B'], '')}  B"; wb = d.textlength(tb, font=f); d.text((w - pad - wb, h - bar + int(10 * s)), tb, fill=MOOD_RGB["B"], font=f)
    tt = name or sc["title"]; wt = d.textlength(tt, font=fs); d.text(((w - wt) / 2, h - bar + int(14 * s)), tt, fill=(230, 215, 180), font=fs)
    played_by = {role: arm for arm, role in cast.items()}     # which physical arm performs each role's track
    notes = [n for role in ("A", "B") for (tn, txt) in sc[role].notes for n in [(tn, role, txt)] if tn <= t + 1e-6]
    if notes:
        tn, role, txt = sorted(notes)[-1]; lab = played_by[role]
        col = (235, 225, 200) if txt.startswith("*") else MOOD_RGB[lab]          # "*..." = a scene-level stage direction
        txt = txt[1:].strip() if txt.startswith("*") else f"{lab}: {txt}"; ws = d.textlength(txt, font=fs)
        d.rectangle([int(12 * s), int(12 * s), int(12 * s) + ws + int(16 * s), int(40 * s)], fill=(10, 8, 6, 185))
        d.text((int(20 * s), int(16 * s)), txt, fill=col, font=fs)
    return im

def frame_camera(sc, GA, GB):
    """A fixed camera framing the whole carriage travel, so the gantry motion reads against a still frame."""
    xl = -float(GA.max()) - 0.26; xr = arena.CHARGED_GAP + float(GB.max()) + 0.26
    cam = arena.make_camera(view="side"); cam.lookat[:] = [(xl + xr) / 2, 0, 0.27]
    cam.azimuth, cam.elevation = 90, -12
    if sc.get("camera") == "iso": cam.azimuth, cam.elevation = 112, -22
    cam.distance = max(1.15, (xr - xl) / 1.47 * 1.05)    # 1.47 = 2*tan(fovy/2)*16/9 at the default 45 deg fovy
    if sc.get("cam"): cam.azimuth, cam.elevation, cam.distance = [sc["cam"].get(k, v) for k, v in
                                                                  (("azimuth", cam.azimuth), ("elevation", cam.elevation), ("distance", cam.distance))]
    return cam

def write_gif(path, frames, fps=GIF_FPS, budget_mb=8.0):
    """Palette-quantised GIF, shrinking the palette until it fits the budget. GIF frame delays are whole
    centiseconds, so 15 fps sampling is written as the nearest representable delay (7 cs)."""
    delay = max(20, int(round(1000.0 / fps / 10.0)) * 10)
    for colors in (128, 96, 64, 48, 32):
        pal = [Image.fromarray(f).convert("P", palette=Image.ADAPTIVE, colors=colors) for f in frames]
        pal[0].save(path, save_all=True, append_images=pal[1:], duration=delay, loop=0, optimize=True, disposal=2)
        mb = os.path.getsize(path) / 1e6
        if mb <= budget_mb: return mb, colors
    return os.path.getsize(path) / 1e6, colors

def render_pair(sc, tA, QA, GA, tB, QB, GB, name, render=True, gif=True, swap=False):
    """Step both arms (and both carriages) through the scene. swap=True plays the A track on arm B and vice versa,
    which is what the game does when the other player's arm takes the A role; the poses are written in the shared
    convention, so the scene simply mirrors."""
    T = max(tA[-1], tB[-1]) + 0.4
    if swap: tA, QA, GA, tB, QB, GB = tB, QB, GB, tA, QA, GA
    spec, m = arena.build(gantry=True); d = mujoco.MjData(m)
    arena.set_pose(m, d, QA[0], QB[0], gA=GA[0], gB=GB[0]); d.qvel[:] = 0
    qi = lambda tt, t, Q: np.array([np.interp(tt, t, Q[:, k]) for k in range(6)])
    r = mujoco.Renderer(m, H, W) if render else None
    cam = frame_camera(sc, GA, GB)
    cast = {"A": "B", "B": "A"} if swap else {"A": "A", "B": "B"}   # physical arm -> the role it plays
    body_of = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[g]) or ""
    name_of = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or body_of(g)
    frames = []; gframes = []; nf = 0; ng = 0; DT = m.opt.timestep; dist_log = []; body_hits = 0; blade_hits = 0; first_hit = None
    for i in range(int(T / DT)):
        tt = i * DT
        d.ctrl[:6] = arena.q_to_model("A", qi(tt, tA, QA)); d.ctrl[6:] = arena.q_to_model("B", qi(tt, tB, QB))
        arena.set_gantry(m, d, float(np.interp(tt, tA, GA)), float(np.interp(tt, tB, GB)))
        mujoco.mj_step(m, d)
        if i % 10 == 0:
            dist_log.append((tt, seg_dist(d.site("A_hilt").xpos, d.site("A_tip").xpos, d.site("B_hilt").xpos, d.site("B_tip").xpos)))
            for c in d.contact[:d.ncon]:
                b1, b2 = body_of(c.geom1), body_of(c.geom2)
                if b1[:2] != b2[:2] and b1[:2] in ("A_", "B_") and b2[:2] in ("A_", "B_"):
                    if name_of(c.geom1).endswith("blade") and name_of(c.geom2).endswith("blade"): blade_hits += 1
                    else: body_hits += 1; first_hit = first_hit or (round(tt, 2), name_of(c.geom1), name_of(c.geom2))
        if render and tt >= nf / FPS:
            r.update_scene(d, cam, arena.render_opts()); raw = r.render().copy()
            frames.append(np.asarray(caption(Image.fromarray(raw), sc, tt, name=name, cast=cast))); nf += 1
            if gif and tt >= ng / GIF_FPS:
                small = Image.fromarray(raw).resize((GIF_W, GIF_H), Image.LANCZOS)
                gframes.append(np.asarray(caption(small, sc, tt, name=name, s=0.78, cast=cast))); ng += 1
    dist_log = np.array(dist_log); k = int(np.argmin(dist_log[:, 1]))
    pair = {"min_blade_cm": round(float(dist_log[k, 1] * 100), 1), "min_blade_at": round(float(dist_log[k, 0]), 2), "body_contacts": body_hits, "blade_contacts": blade_hits, "first_body_contact": first_hit}
    if render:
        imageio.mimwrite(os.path.join(OUTDIR, f"{name}.mp4"), frames, fps=FPS, codec="libx264", quality=8, macro_block_size=1)
        idx = np.linspace(0, len(frames) - 1, 8).astype(int)
        strip = np.concatenate([np.concatenate([frames[i] for i in idx[:4]], axis=1), np.concatenate([frames[i] for i in idx[4:]], axis=1)], axis=0)
        imageio.imwrite(os.path.join(OUTDIR, f"{name}_strip.png"), strip[::2, ::2])
        if gif:
            mb, colors = write_gif(os.path.join(OUTDIR, f"{name}.gif"), gframes)
            pair["gif_mb"] = round(mb, 2); pair["gif_colors"] = colors
            print(f"  gif: {GIF_W}x{GIF_H} @ {GIF_FPS} fps, {len(gframes)} frames, {mb:.2f} MB ({colors} colours)")
    return pair

def save_tuned(label, ts, Q, G, keys, times, sc, arm, on_arm):
    """One arm's 50 Hz trajectory into arm/motions_tuned.json. `q` stays the six servo columns the daemon and
    play_motion read; the carriage rides alongside in `gantry_mm` (the GRBL work coordinate of `gantry_axis`)."""
    lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX)
    tuned = json.load(open(OUT)) if os.path.exists(OUT) else {}
    Qr = Q.copy(); Qr[:, 4] += ROLL_OFFSET
    tuned[label] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in row] for row in Qr], "roll_offset": ROLL_OFFSET, "joints": JOINTS,
                    "gantry_mm": [round(float(x) * 1000, 2) for x in G], "gantry_axis": GANTRY_AXIS[on_arm],
                    "keys": [[round(float(x), 1) for x in (np.array(k[:6]) + np.array([0, 0, 0, 0, ROLL_OFFSET, 0]))] for k in keys], "key_times": [round(float(x), 2) for x in times],
                    "emote": {"title": sc["title"], "family": sc["family"], "mood": sc["moods"].get(arm, ""), "role": arm, "arm": on_arm}}
    json.dump(tuned, open(OUT, "w")); fcntl.flock(lock, fcntl.LOCK_UN)

def generate(family, name, fn, render=True, gif=True, swap=False):
    print(f"== {name}  ({family})"); sc = fn(); A, B = sc["A"], sc["B"]
    T = max(A.t, B.t); A.until(T); B.until(T)                      # pad the shorter track with a hold
    family = sc.get("family") or family     # the scene declares its family; the module name is only where it lives
    table = sc["allow_table"] if isinstance(sc["allow_table"], dict) else {"A": sc["allow_table"], "B": sc["allow_table"]}
    out = {"name": name, "family": family, "title": sc["title"], "moods": sc["moods"], "blurb": sc["blurb"], "tags": sc["tags"], "duration": round(T, 2),
           "allow_table": table, "allow_touch": sc["allow_touch"], "swap": sc.get("swap", True), "arms": {}, "notes": [],
           "video": f"{name}.mp4", "strip": f"{name}_strip.png", "gif": f"{name}.gif" if gif else None,
           "charged_gap_m": round(arena.CHARGED_GAP, 4)}
    tr = {}
    for arm, track in (("A", A), ("B", B)):
        ts, Q, G, keys, times = spline(track); tr[arm] = (ts, Q, G, keys, times)
        chk = arm_checks(ts, Q, G, keys, table.get(arm, False))
        out["arms"][arm] = {"checks": chk, "motion": name if arm == "A" else f"{name}@B",
                            "keys": [[round(float(t), 2)] + np.round(k[:6], 1).tolist() + [round(float(k[6]) * 1000, 1)] for k, t in zip(keys, times)]}
        out["notes"] += [{"t": t, "arm": arm, "text": txt} for t, txt in track.notes]
        print(f"  {arm}: {len(keys)} keys, {ts[-1]:.2f}s, peak deg/s {chk['peak_dps']}, hand reach {chk['reach_max']:.2f}, tip x {chk['tip_x_max']:.2f}, hand z {chk['hand_z_min']:.2f}, tip z {chk['tip_z_min']:.2f}, lift min {chk['lift_min']:.0f}, gantry {chk['gantry_mm'][0]:.0f}..{chk['gantry_mm'][1]:.0f} mm at up to {chk['gantry_peak_mps']:.2f} m/s")
        for p in chk["problems"]: print(f"    PROBLEM {arm}: {p}")
        save_tuned(name if arm == "A" else f"{name}@B", ts, Q, G, keys, times, sc, arm, arm)
    if sc.get("swap", True):
        # The mirror casting, saved under its own name so the game can ask for it: <NAME>_SWAP puts the A role on
        # arm B. The daemon resolves "<move>@<arm>" first, so playing "<NAME>_SWAP" on both arms casts arm A as the
        # B role and arm B as the A role. No new choreography -- the poses are already in the shared convention.
        for arm in ("A", "B"):
            ts, Q, G, keys, times = tr[arm]
            on = "B" if arm == "A" else "A"
            save_tuned(f"{name}_SWAP@B" if on == "B" else f"{name}_SWAP", ts, Q, G, keys, times, sc, arm, on)
        out["swap_motion"] = f"{name}_SWAP"
    out["notes"].sort(key=lambda n: n["t"])
    ab = (*tr["A"][:3], *tr["B"][:3])
    pair = render_pair(sc, *ab, name, render=render, gif=gif); out["pair"] = pair
    if swap and render:
        out["swap_render"] = {"video": f"{name}_swap.mp4", "strip": f"{name}_swap_strip.png", "gif": f"{name}_swap.gif"}
        out["pair_swapped"] = render_pair(sc, *ab, f"{name}_swap", render=True, gif=gif, swap=True)
    probs = [f"{a}: {p}" for a in ("A", "B") for p in out["arms"][a]["checks"]["problems"]]; warns = []
    if pair["body_contacts"]: warns.append(f"blade/body contact between the arms at t={pair['first_body_contact'][0]}s ({pair['first_body_contact'][1]} vs {pair['first_body_contact'][2]}); collision handling is managed later")
    if pair["blade_contacts"] and not sc["allow_touch"]: warns.append(f"blades touch ({pair['blade_contacts']} contact samples)")
    out["problems"] = probs; out["warnings"] = warns; out["ok"] = not probs; out["generated"] = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"  pair: closest blades {pair['min_blade_cm']} cm at t={pair['min_blade_at']}s; body contacts {pair['body_contacts']}, blade contacts {pair['blade_contacts']}")
    for p in probs: print(f"    PROBLEM {p}")
    for w in warns: print(f"    warning: {w}")
    print(f"  {'OK' if out['ok'] else 'NOT OK'}  ->  out/emotes/{name}.mp4  ({T:.2f}s)")
    json.dump(out, open(os.path.join(OUTDIR, f"{name}.json"), "w"), indent=1)
    return out

def manifest():
    """out/emotes/manifest.json: the full per-scene records plus a flat `menu` the game populates its
    "opening pose" / "finishing pose" pickers from (family, name, title, blurb, duration, swap, media).
    Every scene is optional and stands alone: nothing in the game or the daemon has to play any of them."""
    scenes = []
    for f in sorted(glob.glob(os.path.join(OUTDIR, "*.json"))):
        if os.path.basename(f) == "manifest.json": continue
        scenes.append(json.load(open(f)))
    order = {"openers": 0, "hits": 1, "after_hit": 2, "finale": 3, "finales": 3, "idle": 4}
    scenes.sort(key=lambda s: (order.get(s["family"], 9), s["name"]))
    menu = [{"name": s["name"], "family": s["family"], "title": s["title"], "blurb": s["blurb"], "duration": s["duration"],
             "moods": s.get("moods", {}), "tags": s.get("tags", []), "optional": True,
             "motions": {"A": s.get("arms", {}).get("A", {}).get("motion", s["name"]), "B": s.get("arms", {}).get("B", {}).get("motion", s["name"] + "@B")},
             "swap": s.get("swap", True), "swap_motion": s.get("swap_motion"),
             "video": s.get("video"), "gif": s.get("gif"), "strip": s.get("strip"), "ok": s.get("ok")} for s in scenes]
    man = {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "families": sorted({s["family"] for s in scenes}),
           "charged_gap_m": round(arena.CHARGED_GAP, 4), "gantry_travel_m": arena.GANTRY_TRAVEL, "menu": menu, "scenes": scenes}
    json.dump(man, open(os.path.join(OUTDIR, "manifest.json"), "w"), indent=1)
    print(f"manifest: {len(scenes)} scenes, {len(man['families'])} families ({', '.join(man['families'])})")
    for s in menu: print(f"  {s['family']:9s} {s['name']:18s} {s['duration']:5.2f}s  swap={'yes' if s['swap'] else 'no'}  {s['title']}")
    return man

def reel():
    man = manifest(); frames = []; f = ImageFont.load_default(size=40); fs = ImageFont.load_default(size=24)
    for s in man["scenes"]:
        card = Image.new("RGB", (W, H), (14, 10, 8)); d = ImageDraw.Draw(card)
        d.text(((W - d.textlength(s["title"], font=f)) / 2, H / 2 - 50), s["title"], fill=(240, 220, 160), font=f)
        sub = f"A {s['moods'].get('A','')}   vs   B {s['moods'].get('B','')}"; d.text(((W - d.textlength(sub, font=fs)) / 2, H / 2 + 10), sub, fill=(180, 170, 150), font=fs)
        frames += [np.asarray(card)] * (FPS * 1)
        for fr in imageio.get_reader(os.path.join(OUTDIR, s["video"])): frames.append(fr)
        frames += [frames[-1]] * (FPS // 2)
    imageio.mimwrite(os.path.join(OUTDIR, "reel_emotes.mp4"), frames, fps=FPS, codec="libx264", quality=8, macro_block_size=1); print("reel:", len(frames), "frames")

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; render = "--no-render" not in sys.argv
    gif = render and "--no-gif" not in sys.argv; swap = "--swap" in sys.argv    # --swap also renders the mirror casting
    if not args or args[0] == "manifest": manifest(); sys.exit()
    if args[0] == "reel": reel(); sys.exit()
    fams = families() if args[0] == "ALL" else [args[0]]; only = set(args[1:])
    for fam in fams:
        for name, fn in load(fam).items():
            if only and name not in only: continue
            generate(fam, name, fn, render=render, gif=gif, swap=swap)
    manifest()
