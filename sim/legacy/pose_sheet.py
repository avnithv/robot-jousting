import mujoco, numpy as np, imageio
from arena import build, set_pose, make_camera, render_opts
from moves import POSES, READY
spec, m = build(); d = mujoco.MjData(m); r = mujoco.Renderer(m, 360, 640)
names = ["READY","CHARGE","HOME","HIGH_WINDUP","HIGH_STRIKE","LOW_WINDUP","LOW_STRIKE","THRUST_COIL","THRUST_EXT","FEINT_HALF","GUARD_HIGH","GUARD_LOW","PARRY_HIGH","PARRY_LOW"]
tiles = []
def limits_ok(q):
    lo = np.degrees(m.jnt_range[:6, 0]); hi = np.degrees(m.jnt_range[:6, 1]); return bool(np.all(q >= lo) and np.all(q <= hi))
for n in names:
    q = POSES[n]; set_pose(m, d, q, READY)
    ncon_self = 0
    for i in range(d.ncon):
        c = d.contact[i]; b1 = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom1]); b2 = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[c.geom2])
        if b1.startswith("A_") and b2.startswith("A_"): ncon_self += 1
    tip = d.site("A_tip").xpos; hilt = d.site("A_hilt").xpos
    print(f"{n:12s} q={q[:5].astype(int).tolist()} limits_ok={limits_ok(q)} selfcontacts={ncon_self} hilt={np.round(hilt,2)} tip={np.round(tip,2)}")
    row = []
    for view in ("side", "iso"):
        r.update_scene(d, make_camera(view=view), render_opts()); row.append(r.render().copy())
    img = np.concatenate(row, axis=1)
    tiles.append(img)
sheet = np.concatenate(tiles, axis=0)
# split into two sheets to keep them readable
h = sheet.shape[0] // 2
imageio.imwrite("out/poses_1.png", sheet[:7*360]); imageio.imwrite("out/poses_2.png", sheet[7*360:])
print("sheets written")
