"""Simulate sword moves on the two-arm arena and report viability.
- singles: each move alone (opponent holds READY): joint tracking, table clearance, self-collision, tip speed
- pairs:   every (moveA, moveB) simultaneously from READY: contact categories and blocked motion"""
import json, sys, itertools, numpy as np, mujoco, imageio
import arena, moves
from moves import MOVES, READY, timed

DT = 0.002; FPS = 30
spec, m = arena.build(); d = mujoco.MjData(m)
LO = np.degrees(m.jnt_range[:, 0]); HI = np.degrees(m.jnt_range[:, 1])

def body_name(gid): return mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[gid])
def geom_name(gid): return mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, gid) or ""
def classify(c):
    b1, b2 = body_name(c.geom1), body_name(c.geom2); g1, g2 = geom_name(c.geom1), geom_name(c.geom2)
    if b1 == "world" or b2 == "world": return "floor"
    s1, s2 = b1[:2], b2[:2]
    blade1, blade2 = g1.endswith("blade"), g2.endswith("blade")
    if s1 == s2: return "self_" + s1[0]
    if blade1 and blade2: return "blade_blade"
    if blade1: return f"blade{s1[0]}_arm{s2[0]}"
    if blade2: return f"blade{s2[0]}_arm{s1[0]}"
    return "ARM_ARM"

def track(keyframes, start, total):
    """Piecewise-linear joint target as a function of time; holds the last pose until `total`."""
    segs = timed(keyframes, start); times = np.cumsum([t for _, t in segs]); poses = [p for p, _ in segs]
    def f(t):
        prev_t, prev_p = 0.0, start
        for tt, p in zip(times, poses):
            if t <= tt: a = (t - prev_t) / max(tt - prev_t, 1e-6); return prev_p + a * (p - prev_p)
            prev_t, prev_p = tt, p
        return poses[-1]
    return f, float(times[-1])

def run(moveA, moveB, render=None, beat_len=None, startA=READY, startB=READY):
    fA, tA = track(MOVES[moveA], startA, None); fB, tB = track(MOVES[moveB], startB, None)
    T = beat_len or max(tA, tB) + 0.15
    arena.set_pose(m, d, startA, startB); d.qvel[:] = 0; d.time = 0
    log = dict(contacts={}, first_contact={}, max_err=np.zeros(12), min_tipz=[9, 9], max_tip_speed=[0, 0], tipA=[], tipB=[])
    prev_tip = [d.site("A_tip").xpos.copy(), d.site("B_tip").xpos.copy()]
    frames = []; next_frame = 0.0; n = int(T / DT)
    for i in range(n):
        t = i * DT
        d.ctrl[:6] = arena.q_to_model("A", fA(t)); d.ctrl[6:] = arena.q_to_model("B", fB(t))
        mujoco.mj_step(m, d)
        err = np.degrees(np.abs(d.qpos[:12] - d.ctrl[:12])); log["max_err"] = np.maximum(log["max_err"], err)
        for k in range(d.ncon):
            cat = classify(d.contact[k]); log["contacts"][cat] = log["contacts"].get(cat, 0) + 1
            log["first_contact"].setdefault(cat, round(t, 3))
        for j, s in enumerate(("A_tip", "B_tip")):
            p = d.site(s).xpos.copy(); log["min_tipz"][j] = min(log["min_tipz"][j], float(p[2]))
            log["max_tip_speed"][j] = max(log["max_tip_speed"][j], float(np.linalg.norm(p - prev_tip[j]) / DT)); prev_tip[j] = p
        if i % 10 == 0: log["tipA"].append(d.site("A_tip").xpos.copy()); log["tipB"].append(d.site("B_tip").xpos.copy())
        if render is not None and t >= next_frame:
            frames.append(render(d)); next_frame += 1.0 / FPS
    log["duration"] = T; log["moveA"] = moveA; log["moveB"] = moveB
    return log, frames

def make_renderer(w=960, h=544, view="side"):
    r = mujoco.Renderer(m, h, w); cam = arena.make_camera(view=view); cam.distance = 0.95; cam.lookat[2] = 0.2
    opt = arena.render_opts()
    def render(d):
        r.update_scene(d, cam, opt); return r.render().copy()
    return render

def summarize(log):
    c = log["contacts"]; steps = lambda k: round(c.get(k, 0) * DT, 2)
    return dict(moveA=log["moveA"], moveB=log["moveB"], duration=round(log["duration"], 2),
                max_track_err_deg_A=round(float(log["max_err"][:5].max()), 1), max_track_err_deg_B=round(float(log["max_err"][6:11].max()), 1),
                min_tipz_A=round(log["min_tipz"][0], 3), min_tipz_B=round(log["min_tipz"][1], 3),
                peak_tip_speed_A=round(log["max_tip_speed"][0], 2), peak_tip_speed_B=round(log["max_tip_speed"][1], 2),
                contact_seconds={k: steps(k) for k in sorted(c)}, first_contact=log["first_contact"])

if __name__ == "__main__":
    names = list(MOVES)
    render = make_renderer()
    singles = []
    print("== singles ==")
    for n in names:
        log, frames = run(n, "rest", render=render)
        s = summarize(log); singles.append(s)
        imageio.mimwrite(f"out/move_{n}.mp4", frames, fps=FPS, codec="libx264", quality=8)
        print(f"{n:11s} {s['duration']:.2f}s  trackErrA {s['max_track_err_deg_A']:5.1f}deg  minTipZ {s['min_tipz_A']:+.3f}  peakTip {s['peak_tip_speed_A']:.2f} m/s  contacts {s['contact_seconds']}")
    print("== pairs ==")
    pairs = {}
    for a, b in itertools.product(names, names):
        log, _ = run(a, b); s = summarize(log); pairs[f"{a}|{b}"] = s
    json.dump({"singles": singles, "pairs": pairs}, open("out/results.json", "w"), indent=1)
    # matrix views
    def cell(s):
        c = s["contact_seconds"]; tags = []
        if c.get("ARM_ARM"): tags.append("ARM!")
        if c.get("blade_blade"): tags.append("bb")
        if c.get("bladeA_armB"): tags.append("A>B")
        if c.get("bladeB_armA"): tags.append("B>A")
        if s["max_track_err_deg_A"] > 15 or s["max_track_err_deg_B"] > 15: tags.append("blk")
        return ",".join(tags) or "-"
    w = max(len(n) for n in names) + 1
    print(" " * w + "".join(f"{n[:10]:>11s}" for n in names))
    for a in names:
        print(f"{a:{w}s}" + "".join(f"{cell(pairs[f'{a}|{b}']):>11s}" for b in names))
    unsafe = [k for k, s in pairs.items() if s["contact_seconds"].get("ARM_ARM")]
    print("ARM_ARM pairs:", unsafe)
