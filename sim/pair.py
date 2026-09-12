"""Simulate two tuned moves at once: A does `nameA`, B (the SO100, mirrored) does `nameB`.
Reports the closest approach between the two blades over time and at the end, and renders out/pair_<A>_vs_<B>.mp4."""
import sys, json, numpy as np, mujoco, imageio
import arena
TUNED = json.load(open("../arm/motions_tuned.json")); ROLL = 76.0
def reload():
    global TUNED; TUNED = json.load(open("../arm/motions_tuned.json"))

def traj(name):
    M = TUNED[name]; t = np.array(M["t"]); q = np.array(M["q"]); q[:, 4] -= M.get("roll_offset", ROLL); return t, q

def seg_dist(p1, p2, q1, q2):
    """min distance between segments p1-p2 and q1-q2"""
    best = 1e9
    for s in np.linspace(0, 1, 40):
        a = p1 + s * (p2 - p1)
        d = q2 - q1; tt = np.clip(((a - q1) @ d) / (d @ d), 0, 1); b = q1 + tt * d
        best = min(best, float(np.linalg.norm(a - b)))
    return best

def run(nameA, nameB, render=True, fps=30):
    reload(); tA, QA = traj(nameA); tB, QB = traj(nameB); T = max(tA[-1], tB[-1]) + 0.6
    spec, m = arena.build(); d = mujoco.MjData(m)
    arena.set_pose(m, d, QA[0], QB[0]); d.qvel[:] = 0
    qi = lambda tt, t, Q: np.array([np.interp(tt, t, Q[:, k]) for k in range(6)])
    r = mujoco.Renderer(m, 544, 960) if render else None
    cam = arena.make_camera(view="side"); cam.distance = 0.95; cam.lookat[:] = [arena.BASE_GAP / 2, 0, 0.22]
    frames = []; nf = 0; DT = m.opt.timestep; log = []
    for i in range(int(T / DT)):
        tt = i * DT; d.ctrl[:6] = arena.q_to_model("A", qi(tt, tA, QA)); d.ctrl[6:] = arena.q_to_model("B", qi(tt, tB, QB)); mujoco.mj_step(m, d)
        if i % 10 == 0:
            dist = seg_dist(d.site("A_hilt").xpos, d.site("A_tip").xpos, d.site("B_hilt").xpos, d.site("B_tip").xpos); log.append((tt, dist))
        if render and tt >= nf / fps: r.update_scene(d, cam, arena.render_opts()); frames.append(r.render().copy()); nf += 1
    log = np.array(log); k = int(np.argmin(log[:, 1]))
    print(f"{nameA} vs {nameB}: closest blade-axis distance {log[k,1]*100:.1f} cm at t={log[k,0]:.2f}s; at end {log[-1,1]*100:.1f} cm (touching = 2.4 cm)")
    print("  A blade end:", np.round(d.site("A_hilt").xpos, 3), "->", np.round(d.site("A_tip").xpos, 3), "| B blade end:", np.round(d.site("B_hilt").xpos, 3), "->", np.round(d.site("B_tip").xpos, 3))
    if render:
        imageio.mimwrite(f"out/pair_{nameA}_vs_{nameB}.mp4", frames, fps=fps, codec="libx264", quality=8, macro_block_size=1)
        idx = np.linspace(0, len(frames) - 1, 8).astype(int)
        strip = np.concatenate([np.concatenate([frames[i] for i in idx[:4]], axis=1), np.concatenate([frames[i] for i in idx[4:]], axis=1)], axis=0)
        imageio.imwrite(f"out/pair_{nameA}_vs_{nameB}_strip.png", strip[::2, ::2])
    return log, d

if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
