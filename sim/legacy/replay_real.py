"""Replay a recorded real-arm motion (arm/motions_real.json) on arm A in the MuJoCo arena.
Outputs: out/real_<name>.mp4, out/real_<name>_strip.png (filmstrip), out/real_<name>_joints.png (joint plot with segments)."""
import sys, json, numpy as np, mujoco, imageio
import arena
name = sys.argv[1] if len(sys.argv) > 1 else "ATTACK_HIGH"
ALL = json.load(open("../arm/motions_real.json")); M = ALL[name]; t = np.array(M["t"]); q = np.array(M["q"])
if name != "REST":   # always start from the rest pose: 1 s ease-in prepended
    t = np.concatenate([[0.0], t + 1.0]); q = np.vstack([ALL["REST"]["q"][0], q])
# segments: split where all joints are slow for >= 0.4 s
v = np.max(np.abs(np.gradient(q[:, :5], t, axis=0)), axis=1); moving = v > 10
segs, i = [], 0
while i < len(t):
    if moving[i]:
        j = i
        while j < len(t) and (moving[j] or (t[min(j + 1, len(t) - 1)] - t[j] < 0.4 and np.any(moving[j:min(j + int(0.4 * 40), len(t))]))): j += 1
        segs.append((i, j)); i = j
    else: i += 1
print("segments (s):", [(round(float(t[a]), 2), round(float(t[min(b, len(t) - 1)]), 2)) for a, b in segs])
# joint plot
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(11, 4.5))
for k, jn in enumerate(M["joints"]): ax.plot(t, q[:, k], label=jn)
for a, b in segs: ax.axvspan(t[a], t[min(b, len(t) - 1)], color="k", alpha=0.07)
ax.set_xlabel("s"); ax.set_ylabel("deg"); ax.set_title(f"{name}: recorded joints (shaded = moving)"); ax.legend(ncol=6, fontsize=8); fig.tight_layout(); fig.savefig(f"out/real_{name}_joints.png", dpi=110)
# sim replay: A follows the recording (position targets), B holds a rest pose
spec, m = arena.build(); d = mujoco.MjData(m)
rest = np.array([0, -60, 60, 0, 0, 0], float)
arena.set_pose(m, d, q[0], rest); d.qvel[:] = 0
r = mujoco.Renderer(m, 544, 960); cam = arena.make_camera(view="iso"); cam.distance = 0.9; cam.lookat[:] = [0.15, 0, 0.18]; cam.azimuth = 135; cam.elevation = -20
opt = arena.render_opts(); frames = []; FPS = 30; DT = m.opt.timestep
qi = lambda tt: np.array([np.interp(tt, t, q[:, k]) for k in range(6)])
n = int(t[-1] / DT); nf = 0
for i in range(n):
    tt = i * DT; d.ctrl[:6] = arena.q_to_model("A", qi(tt)); d.ctrl[6:] = arena.q_to_model("B", rest); mujoco.mj_step(m, d)
    if tt >= nf / FPS:
        r.update_scene(d, cam, opt); frames.append(r.render().copy()); nf += 1
imageio.mimwrite(f"out/real_{name}.mp4", frames, fps=FPS, codec="libx264", quality=8, macro_block_size=1)
idx = np.linspace(0, len(frames) - 1, 8).astype(int)
strip = np.concatenate([np.concatenate([frames[i] for i in idx[:4]], axis=1), np.concatenate([frames[i] for i in idx[4:]], axis=1)], axis=0)
imageio.imwrite(f"out/real_{name}_strip.png", strip[::2, ::2])
print("wrote", f"out/real_{name}.mp4", len(frames), "frames; strip times:", [round(float(i / FPS), 1) for i in idx])
