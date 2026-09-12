import mujoco, numpy as np, os, sys
SO101 = "/Users/avnith/so-arm/SO-ARM100/Simulation/SO101/so101_new_calib.xml"
SO100 = "/Users/avnith/so-arm/SO-ARM100/Simulation/SO100/so100.urdf"

for path in (SO101, SO100):
    try:
        spec = mujoco.MjSpec.from_file(path)
        m = spec.compile()
        d = mujoco.MjData(m)
        print("LOADED", os.path.basename(path), "nq", m.nq, "nu", m.nu, "nbody", m.nbody, "ngeom", m.ngeom)
        for j in range(m.njnt):
            print("  joint", mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_JOINT, j), np.round(np.degrees(m.jnt_range[j]),1))
        mujoco.mj_forward(m, d)
        for b in range(m.nbody):
            print("  body", mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_BODY, b), np.round(d.xpos[b],3))
        for s in range(m.nsite):
            print("  site", mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_SITE, s), np.round(d.site_xpos[s],3))
    except Exception as e:
        print("FAILED", path, repr(e)[:500])

# rendering test
try:
    spec = mujoco.MjSpec.from_file(SO101)
    m = spec.compile(); d = mujoco.MjData(m); mujoco.mj_forward(m, d)
    r = mujoco.Renderer(m, 480, 640)
    cam = mujoco.MjvCamera(); cam.lookat[:] = [0,0,0.15]; cam.distance = 0.9; cam.azimuth = 135; cam.elevation = -20
    r.update_scene(d, cam); img = r.render()
    import imageio; imageio.imwrite("out/probe_so101_zero.png", img)
    print("RENDER OK", img.shape)
except Exception as e:
    print("RENDER FAILED", repr(e)[:500])
