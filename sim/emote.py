"""Generate two-arm emote scenes: emotes/<family>.py -> spline both arms -> checks -> two-arm MuJoCo clip + filmstrip
+ out/emotes/<NAME>.json, and the per-arm 50 Hz trajectories into arm/motions_tuned.json as NAME (arm A) and NAME@B.
    ../.venv/bin/python emote.py openers                 # every scene in emotes/openers.py
    ../.venv/bin/python emote.py openers SALUTE          # one scene
    ../.venv/bin/python emote.py ALL                     # every family
    ../.venv/bin/python emote.py manifest                # rebuild out/emotes/manifest.json from the per-scene json
    ../.venv/bin/python emote.py reel                    # out/emotes/reel_emotes.mp4 with title cards
Checks (per arm, sim degrees): shoulder lift >= -89 (hard rule), servo peak <= 300 deg/s, hand reach <= 0.30 m from the
own base, hand z >= 0.04, blade tip z >= 0.02 (unless allow_table), sim roll in [-180, 100]; and in the two-arm sim:
closest blade-to-blade distance and any blade/body or blade/blade contacts (reported as warnings; collision handling is managed later)."""
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
W, H, FPS = 960, 540, 30
MOOD_RGB = {"A": (235, 80, 70), "B": (90, 140, 240)}

def families():
    return sorted(os.path.splitext(os.path.basename(f))[0] for f in glob.glob(os.path.join(HERE, "emotes", "*.py")) if not f.endswith("__init__.py"))

def load(family):
    mod = importlib.import_module(f"emotes.{family}"); importlib.reload(mod); return mod.SCENES

def spline(track):
    keys = [k for k, _ in track.keys]; times = np.cumsum([dt for _, dt in track.keys])
    ts, Q = catmull_rom(keys, times); Q = np.clip(Q, L.LO, L.HI); Q[:, 5] = np.clip(Q[:, 5], 0, 100)
    Q[:, 1] = np.maximum(Q[:, 1], LIFT_MIN)   # Catmull-Rom overshoots past a key that sits on the hard limit: clamp instead of leaning on the board
    return ts, Q, keys, times

def arm_checks(ts, Q, allow_table):
    """Geometry and speed checks for one arm's trajectory (own frame; valid for A and B alike)."""
    peak = np.abs(np.gradient(Q, ts, axis=0)).max(0); over = [JOINTS[k] for k in range(5) if peak[k] > SERVO_CAP_DPS]
    reach = hand_z = tip_z = tip_x = None; probs = []
    for q in Q[::2]:
        h, t, p = ik.fk(q); r = float(np.hypot(h[0], h[1])); tx = float(t[0])
        reach = r if reach is None else max(reach, r); hand_z = h[2] if hand_z is None else min(hand_z, h[2]); tip_z = t[2] if tip_z is None else min(tip_z, t[2]); tip_x = tx if tip_x is None else max(tip_x, tx)
    lift_min = float(Q[:, 1].min()); roll = (float(Q[:, 4].min()), float(Q[:, 4].max()))
    if lift_min < LIFT_MIN - 0.5: probs.append(f"lift {lift_min:.0f} < {LIFT_MIN:.0f} (hard rule)")
    if over: probs.append("over 300 deg/s: " + ", ".join(f"{j} {peak[JOINTS.index(j)]:.0f}" for j in over))
    if reach > REACH_MAX + 0.005: probs.append(f"hand reach {reach:.2f} > {REACH_MAX} m")
    if hand_z < HAND_Z_MIN: probs.append(f"hand z {hand_z:.2f} < {HAND_Z_MIN} m (table)")
    if tip_z < TIP_Z_MIN and not allow_table: probs.append(f"blade tip z {tip_z:.2f} < {TIP_Z_MIN} m (table; set allow_table=True if a tap is intended)")
    if roll[0] < ROLL_LO or roll[1] > ROLL_HI: probs.append(f"roll {roll[0]:.0f}..{roll[1]:.0f} outside [{ROLL_LO:.0f}, {ROLL_HI:.0f}]")
    return {"peak_dps": dict(zip(JOINTS, np.round(peak).astype(int).tolist())), "over_cap": over, "reach_max": round(reach, 3), "tip_x_max": round(float(tip_x), 3),
            "hand_z_min": round(float(hand_z), 3), "tip_z_min": round(float(tip_z), 3), "lift_min": round(lift_min, 1),
            "roll_range": [round(roll[0]), round(roll[1])], "problems": probs}

def seg_dist(p1, p2, q1, q2):
    best = 1e9
    for s in np.linspace(0, 1, 24):
        a = p1 + s * (p2 - p1); d = q2 - q1; tt = np.clip(((a - q1) @ d) / (d @ d), 0, 1); b = q1 + tt * d
        best = min(best, float(np.linalg.norm(a - b)))
    return best

def caption(im, sc, t):
    d = ImageDraw.Draw(im, "RGBA"); f = ImageFont.load_default(size=22); fs = ImageFont.load_default(size=16)
    d.rectangle([0, H - 46, W, H], fill=(10, 8, 6, 190))
    d.text((16, H - 36), f"A  {sc['moods'].get('A', '')}", fill=MOOD_RGB["A"], font=f)
    tb = f"{sc['moods'].get('B', '')}  B"; wb = d.textlength(tb, font=f); d.text((W - 16 - wb, H - 36), tb, fill=MOOD_RGB["B"], font=f)
    tt = sc["title"]; wt = d.textlength(tt, font=fs); d.text(((W - wt) / 2, H - 32), tt, fill=(230, 215, 180), font=fs)
    notes = [n for arm in ("A", "B") for (tn, txt) in sc[arm].notes for n in [(tn, arm, txt)] if tn <= t + 1e-6]
    if notes:
        tn, arm, txt = sorted(notes)[-1]; s = f"{arm}: {txt}"; ws = d.textlength(s, font=fs)
        d.rectangle([12, 12, 12 + ws + 16, 40], fill=(10, 8, 6, 170)); d.text((20, 17), s, fill=MOOD_RGB[arm], font=fs)
    return im

def render_pair(sc, tA, QA, tB, QB, name, render=True):
    T = max(tA[-1], tB[-1]) + 0.4
    spec, m = arena.build(); d = mujoco.MjData(m); arena.set_pose(m, d, QA[0], QB[0]); d.qvel[:] = 0
    qi = lambda tt, t, Q: np.array([np.interp(tt, t, Q[:, k]) for k in range(6)])
    r = mujoco.Renderer(m, H, W) if render else None
    cam = arena.make_camera(view="side"); cam.distance = 1.2; cam.lookat[:] = [arena.BASE_GAP / 2, 0, 0.27]; cam.azimuth = 90; cam.elevation = -12
    if sc.get("camera") == "iso": cam.azimuth = 112; cam.elevation = -22; cam.distance = 1.3
    body_of = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[g]) or ""
    name_of = lambda g: mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or body_of(g)
    frames = []; nf = 0; DT = m.opt.timestep; dist_log = []; body_hits = 0; blade_hits = 0; first_hit = None
    for i in range(int(T / DT)):
        tt = i * DT; d.ctrl[:6] = arena.q_to_model("A", qi(tt, tA, QA)); d.ctrl[6:] = arena.q_to_model("B", qi(tt, tB, QB)); mujoco.mj_step(m, d)
        if i % 10 == 0:
            dist_log.append((tt, seg_dist(d.site("A_hilt").xpos, d.site("A_tip").xpos, d.site("B_hilt").xpos, d.site("B_tip").xpos)))
            for c in d.contact[:d.ncon]:
                b1, b2 = body_of(c.geom1), body_of(c.geom2)
                if b1[:2] != b2[:2] and b1[:2] in ("A_", "B_") and b2[:2] in ("A_", "B_"):
                    if name_of(c.geom1).endswith("blade") and name_of(c.geom2).endswith("blade"): blade_hits += 1
                    else: body_hits += 1; first_hit = first_hit or (round(tt, 2), name_of(c.geom1), name_of(c.geom2))
        if render and tt >= nf / FPS:
            r.update_scene(d, cam, arena.render_opts()); frames.append(np.asarray(caption(Image.fromarray(r.render().copy()), sc, tt))); nf += 1
    dist_log = np.array(dist_log); k = int(np.argmin(dist_log[:, 1]))
    pair = {"min_blade_cm": round(float(dist_log[k, 1] * 100), 1), "min_blade_at": round(float(dist_log[k, 0]), 2), "body_contacts": body_hits, "blade_contacts": blade_hits, "first_body_contact": first_hit}
    if render:
        imageio.mimwrite(os.path.join(OUTDIR, f"{name}.mp4"), frames, fps=FPS, codec="libx264", quality=8, macro_block_size=1)
        idx = np.linspace(0, len(frames) - 1, 8).astype(int)
        strip = np.concatenate([np.concatenate([frames[i] for i in idx[:4]], axis=1), np.concatenate([frames[i] for i in idx[4:]], axis=1)], axis=0)
        imageio.imwrite(os.path.join(OUTDIR, f"{name}_strip.png"), strip[::2, ::2])
    return pair

def save_tuned(name, ts, Q, keys, times, sc, arm):
    label = name if arm == "A" else f"{name}@B"
    lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX)
    tuned = json.load(open(OUT)) if os.path.exists(OUT) else {}
    Qr = Q.copy(); Qr[:, 4] += ROLL_OFFSET
    tuned[label] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in row] for row in Qr], "roll_offset": ROLL_OFFSET, "joints": JOINTS,
                    "keys": [[round(float(x), 1) for x in (np.array(k) + np.array([0, 0, 0, 0, ROLL_OFFSET, 0]))] for k in keys], "key_times": [round(float(x), 2) for x in times],
                    "emote": {"title": sc["title"], "family": sc["family"], "mood": sc["moods"].get(arm, ""), "arm": arm}}
    json.dump(tuned, open(OUT, "w")); fcntl.flock(lock, fcntl.LOCK_UN)

def generate(family, name, fn, render=True):
    print(f"== {name}  ({family})"); sc = fn(); A, B = sc["A"], sc["B"]
    T = max(A.t, B.t); A.until(T); B.until(T)                      # pad the shorter track with a hold
    family = sc.get("family") or family     # the scene declares its family; the module name is only where it lives
    out = {"name": name, "family": family, "title": sc["title"], "moods": sc["moods"], "blurb": sc["blurb"], "tags": sc["tags"], "duration": round(T, 2),
           "allow_table": sc["allow_table"], "allow_touch": sc["allow_touch"], "arms": {}, "notes": [], "video": f"{name}.mp4", "strip": f"{name}_strip.png"}
    tr = {}
    for arm, track in (("A", A), ("B", B)):
        ts, Q, keys, times = spline(track); tr[arm] = (ts, Q)
        chk = arm_checks(ts, Q, sc["allow_table"]); out["arms"][arm] = {"checks": chk, "keys": [[round(float(t), 2)] + np.round(k, 1).tolist() for k, t in zip(keys, times)]}
        out["notes"] += [{"t": t, "arm": arm, "text": txt} for t, txt in track.notes]
        print(f"  {arm}: {len(keys)} keys, {ts[-1]:.2f}s, peak deg/s {chk['peak_dps']}, hand reach {chk['reach_max']:.2f}, tip x {chk['tip_x_max']:.2f} (centre line 0.305), hand z {chk['hand_z_min']:.2f}, tip z {chk['tip_z_min']:.2f}, lift min {chk['lift_min']:.0f}")
        for p in chk["problems"]: print(f"    PROBLEM {arm}: {p}")
        save_tuned(name, ts, Q, keys, times, sc, arm)
    out["notes"].sort(key=lambda n: n["t"])
    pair = render_pair(sc, *tr["A"], *tr["B"], name, render=render); out["pair"] = pair
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
    scenes = []
    for f in sorted(glob.glob(os.path.join(OUTDIR, "*.json"))):
        if os.path.basename(f) == "manifest.json": continue
        scenes.append(json.load(open(f)))
    order = {"openers": 0, "hits": 1, "after_hit": 2, "finale": 3, "idle": 4}
    scenes.sort(key=lambda s: (order.get(s["family"], 9), s["name"]))
    man = {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "scenes": scenes}
    json.dump(man, open(os.path.join(OUTDIR, "manifest.json"), "w"), indent=1); print(f"manifest: {len(scenes)} scenes"); return man

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
    if not args or args[0] == "manifest": manifest(); sys.exit()
    if args[0] == "reel": reel(); sys.exit()
    fams = families() if args[0] == "ALL" else [args[0]]; only = set(args[1:])
    for fam in fams:
        for name, fn in load(fam).items():
            if only and name not in only: continue
            generate(fam, name, fn, render=render)
    manifest()
