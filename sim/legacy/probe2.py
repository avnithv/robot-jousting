import mujoco, numpy as np, imageio
SO100 = "/Users/avnith/so-arm/SO-ARM100/Simulation/SO100/so100.urdf"
spec = mujoco.MjSpec.from_file(SO100)
m = spec.compile(); d = mujoco.MjData(m); mujoco.mj_forward(m, d)
for g in range(m.ngeom):
    print("geom", mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g), m.geom_type[g], "body", mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, m.geom_bodyid[g]), "group", m.geom_group[g], "contype", m.geom_contype[g])
r = mujoco.Renderer(m, 480, 640)
cam = mujoco.MjvCamera(); cam.lookat[:] = [0,0,0.15]; cam.distance = 0.9; cam.azimuth = 135; cam.elevation = -20
opt = mujoco.MjvOption(); opt.geomgroup[:] = 1
r.update_scene(d, cam, opt); imageio.imwrite("out/probe_so100_zero.png", r.render())
print("ok")
