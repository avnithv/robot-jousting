import mujoco, numpy as np, imageio
from arena import build, set_pose, make_camera, render_opts, JOINTS
spec, m = build(); d = mujoco.MjData(m); r = mujoco.Renderer(m, 360, 640)
tiles = []
for k in range(5):
    row = []
    for ang in (-45, 0, 45):
        qa = np.zeros(6); qa[k] = ang
        set_pose(m, d, qa, qa)
        r.update_scene(d, make_camera(view="side"), render_opts()); img = r.render().copy()
        tipA = d.site("A_tip").xpos; tipB = d.site("B_tip").xpos
        print(f"{JOINTS[k]:14s} {ang:+d}: A_tip {np.round(tipA,3)}  B_tip {np.round(tipB,3)}")
        row.append(img)
    tiles.append(np.concatenate(row, axis=1))
imageio.imwrite("out/probe_joints.png", np.concatenate(tiles, axis=0))
