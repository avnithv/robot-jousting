"""Two-arm joust arena in MuJoCo: A = SO101 (faces +x), B = SO100 (faces -x).
Poses are always given in SO101 new-calib convention (degrees, zero = upright upper arm,
forearm horizontal forward). B's URDF joints are mapped via q100 = SIGN*q + OFFSET."""
import mujoco, numpy as np

import os
_SO_ARM = os.environ.get("SO_ARM_DIR", os.path.expanduser("~/so-arm/SO-ARM100"))   # clone of github.com/TheRobotStudio/SO-ARM100
SO101 = os.path.join(_SO_ARM, "Simulation/SO101/so101_new_calib.xml")
SO100 = os.path.join(_SO_ARM, "Simulation/SO100/so100.urdf")
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
SWORD_LEN = 0.18   # metres of blade past the jaw tip (plastic knife)
SWORD_ON_JAW = True  # sword on the moving finger; False = fixed along the gripper
SHIELD = False       # no shield in v1
BASE_GAP = 0.61    # metres between the two shoulder_pan axes at the clash (2 ft gantry stop)
B_OFFSET_DEG = np.array([0.0, 102.77, -90.0, -31.94, 0.0, 0.0])
B_SIGN = np.array([-1.0, 1.0, 1.0, 1.0, 1.0, 1.0])   # pan: +ve = each arm's OWN right (B mirrors A)

def q_to_model(arm, q_deg):
    q = np.radians(np.asarray(q_deg, float))
    if arm == "A":
        return q
    return np.radians(B_SIGN * np.asarray(q_deg, float) + B_OFFSET_DEG)

def _add_sword(spec, prefix, body_name, pos, quat, rgba, sword_len):
    body = spec.body(prefix + body_name)
    blade = body.add_body(name=prefix + "sword", pos=pos, quat=quat)
    blade.add_geom(name=prefix + "blade", type=mujoco.mjtGeom.mjGEOM_CAPSULE,
                   size=[0.012, sword_len / 2, 0], pos=[0, 0, sword_len / 2],
                   rgba=rgba, mass=0.03, contype=1, conaffinity=1)
    blade.add_site(name=prefix + "tip", pos=[0, 0, sword_len], size=[0.008, 0, 0], rgba=[1, 1, 1, 1])
    blade.add_site(name=prefix + "hilt", pos=[0, 0, 0], size=[0.006, 0, 0], rgba=[1, 1, 1, 1])

def _blade_quat_local(R, forward_world):
    """Quaternion (wxyz) that rotates local +z onto the given world direction, expressed in a body with rotation R."""
    local = R.T @ np.asarray(forward_world, float); local /= np.linalg.norm(local)
    z = np.array([0, 0, 1.0]); v = np.cross(z, local); c = float(z @ local)
    if np.linalg.norm(v) < 1e-9: return [1, 0, 0, 0] if c > 0 else [0, 1, 0, 0]
    q = np.array([1 + c, *v]); return list(q / np.linalg.norm(q))

def _arm_with_sword(path, q_zero_rad, forward_in_arm_frame, hilt_dist_from_pan, pan_axis_xy, rgba, sword_len):
    """Load one arm spec and add a sword to its gripper. Everything is computed in the arm's own frame at the
    canonical zero pose (arm extended horizontally along `forward_in_arm_frame`)."""
    child = mujoco.MjSpec.from_file(path); child.compiler.discardvisual = False
    m0 = child.compile(); d0 = mujoco.MjData(m0); d0.qpos[:] = q_zero_rad; mujoco.mj_forward(m0, d0)
    g = d0.body("gripper"); R = g.xmat.reshape(3, 3); fwd = np.asarray(forward_in_arm_frame, float)
    # distance already covered from the pan axis to the gripper origin, along the forward direction
    covered = float((g.xpos - np.array([*pan_axis_xy, 0])) @ fwd)
    pos_local = R.T @ (fwd * (hilt_dist_from_pan - covered))
    if SWORD_ON_JAW:
        # Sword rides on the MOVING jaw (the finger the gripper joint swings). At gripper=closed the jaw lies along the
        # fixed jaw, so the sword direction is pivot -> fixed-jaw tip; opening the gripper cocks the sword up and back.
        jaw_name = next(b.name for b in child.bodies if "jaw" in b.name and b.name != "gripper")
        jaw = d0.body(jaw_name); Rj = jaw.xmat.reshape(3, 3)
        tip_world = g.xpos + fwd * (hilt_dist_from_pan - covered)      # where the fixed jaw ends (old hilt point)
        dir_world = tip_world - jaw.xpos; dir_world /= np.linalg.norm(dir_world)
        dir_local = Rj.T @ dir_world
        start_local = dir_local * float(np.linalg.norm(tip_world - jaw.xpos))   # hilt at the jaw tip
        _add_sword(child, "", jaw_name, list(start_local), _blade_quat_local(Rj, dir_world), rgba, sword_len)
    else:
        _add_sword(child, "", "gripper", list(pos_local), _blade_quat_local(R, fwd), rgba, sword_len)
    if SHIELD:   # optional shield plate on the outside of the fixed finger (not used in v1)
        # Shield plate on the OUTSIDE of the fixed finger: the side facing away from the moving jaw. At the canonical
        # zero pose the jaw sits above the finger, so the plate faces down; rolling the wrist 180 deg brings it face up.
        jaw0 = d0.body(next(b.name for b in child.bodies if "jaw" in b.name and b.name != "gripper"))
        axis = d0.jnt("gripper").xaxis; away = np.cross(fwd, axis); away /= np.linalg.norm(away)   # perpendicular to forward and to the jaw hinge
        if away @ (g.xpos + fwd * 0.05 - jaw0.xpos) < 0: away = -away                                   # pointing away from the jaw
        centre_world = g.xpos + fwd * (hilt_dist_from_pan - covered - 0.05) + away * 0.02
        n_local = R.T @ away; f_local = R.T @ fwd; s_local = np.cross(n_local, f_local)
        quat = np.zeros(4); mujoco.mju_mat2Quat(quat, np.column_stack([f_local, s_local, n_local]).flatten())
        g_spec = child.body("gripper")
        g_spec.add_geom(name="shield", type=mujoco.mjtGeom.mjGEOM_BOX, size=[0.05, 0.04, 0.004], pos=list(R.T @ (centre_world - g.xpos)), quat=list(quat),
                        rgba=[0.85, 0.75, 0.2, 1], mass=0.02, contype=1, conaffinity=1)
    if any(b.name == "jaw" for b in child.bodies):   # SO100 URDF: base mesh overlaps the shoulder mesh, gripper has no collision geom
        for b in child.bodies:
            if b.name in ("world", "base"):
                for g in b.geoms: g.contype = 0; g.conaffinity = 0
        grip = child.body("gripper")
        half = np.linalg.norm(pos_local) / 2; axis = pos_local / np.linalg.norm(pos_local)
        z = np.array([0, 0, 1.0]); v = np.cross(z, axis); c = float(z @ axis); q = np.array([1 + c, *v]); q /= np.linalg.norm(q)
        grip.add_geom(name="gripper_col", type=mujoco.mjtGeom.mjGEOM_CAPSULE, size=[0.02, half, 0], pos=list(pos_local / 2), quat=list(q),
                      rgba=[0.15, 0.15, 0.15, 1], contype=1, conaffinity=1)
    return child

def build(base_gap=BASE_GAP, sword_len=SWORD_LEN, hilt_reach=0.353):
    spec = mujoco.MjSpec()
    spec.compiler.discardvisual = False
    spec.option.timestep = 0.002
    spec.visual.global_.offwidth = 1280
    spec.visual.global_.offheight = 720
    spec.worldbody.add_light(pos=[0, 0, 3], dir=[0, 0, -1], type=mujoco.mjtLightType.mjLIGHT_DIRECTIONAL)
    spec.worldbody.add_light(pos=[base_gap / 2, -1.0, 1.2], dir=[0, 0.6, -0.8])
    spec.worldbody.add_geom(name="floor", type=mujoco.mjtGeom.mjGEOM_PLANE, size=[2, 2, 0.05],
                            rgba=[0.25, 0.25, 0.28, 1], contype=0, conaffinity=0)
    # A: SO101, extends along +x in its own frame, pan axis at (0.0388, 0)
    a = _arm_with_sword(SO101, np.zeros(6), [1, 0, 0], hilt_reach, (0.0388353, 0), [0.9, 0.2, 0.2, 1], sword_len)
    # B: SO100 URDF, extends along -y in its own frame, pan axis at (0, -0.0452)
    b = _arm_with_sword(SO100, np.radians(B_OFFSET_DEG), [0, -1, 0], hilt_reach, (0, -0.0452), [0.2, 0.4, 0.9, 1], sword_len)
    fa = spec.worldbody.add_frame(pos=[-0.0388353, 0, 0], quat=[1, 0, 0, 0])
    fb = spec.worldbody.add_frame(pos=[base_gap + 0.0452, 0, 0], quat=[0.7071068, 0, 0, -0.7071068])
    fa.attach_body(a.worldbody, "A_", "")
    fb.attach_body(b.worldbody, "B_", "")
    for j in JOINTS:  # B actuators (URDF has none): copy A's servo model
        jn = spec.joint("B_" + j); ref = spec.actuator("A_" + j)
        act = spec.add_actuator(name="B_" + j, target="B_" + j, trntype=mujoco.mjtTrn.mjTRN_JOINT)
        act.gainprm[:] = ref.gainprm; act.biasprm[:] = ref.biasprm
        act.gaintype = mujoco.mjtGain.mjGAIN_FIXED; act.biastype = mujoco.mjtBias.mjBIAS_AFFINE
        act.forcerange = list(ref.forcerange); act.ctrlrange = list(jn.range); act.ctrllimited = True
    model = spec.compile()
    for jn in ("A_wrist_roll", "B_wrist_roll"):   # real roll is a full turn; let the sim reach +/-185 so roll -180 renders
        j = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, jn); u = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, jn)
        model.jnt_range[j] = [np.radians(-185), np.radians(185)]; model.actuator_ctrlrange[u] = [np.radians(-185), np.radians(185)]
    # URDF joints import with no damping/armature; give B the SO101 (STS3215) joint dynamics
    for j in range(model.njnt):
        if mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, j).startswith("B_"):
            a = model.jnt_dofadr[j]; model.dof_damping[a] = 0.60; model.dof_armature[a] = 0.028; model.dof_frictionloss[a] = 0.052
    return spec, model

def set_pose(m, d, qA_deg, qB_deg):
    d.qpos[:6] = q_to_model("A", qA_deg); d.qpos[6:12] = q_to_model("B", qB_deg)
    d.ctrl[:6] = d.qpos[:6]; d.ctrl[6:12] = d.qpos[6:12]
    mujoco.mj_forward(m, d)

def make_camera(base_gap=BASE_GAP, view="side"):
    cam = mujoco.MjvCamera(); cam.lookat[:] = [base_gap / 2, 0, 0.18]
    if view == "side": cam.distance = 1.25; cam.azimuth = 90; cam.elevation = -12
    elif view == "iso": cam.distance = 1.35; cam.azimuth = 125; cam.elevation = -28
    elif view == "top": cam.distance = 1.2; cam.azimuth = 90; cam.elevation = -89
    return cam

def render_opts():
    opt = mujoco.MjvOption(); opt.geomgroup[:] = 1; opt.sitegroup[:] = 1; return opt

if __name__ == "__main__":
    import imageio
    spec, m = build(); d = mujoco.MjData(m)
    set_pose(m, d, np.zeros(6), np.zeros(6))
    for s in ["A_hilt", "A_tip", "B_hilt", "B_tip"]: print(s, np.round(d.site(s).xpos, 3))
    # sign check: +15deg on each joint of A vs each sign on B, compare mirrored wrist anchor (x -> gap-x)
    def wrist(arm):
        return d.jnt(arm + "_wrist_roll").xanchor.copy()
    for k, name in enumerate(JOINTS[:5]):
        qa = np.zeros(6); qa[k] = 15; set_pose(m, d, qa, np.zeros(6)); wa = wrist("A")
        res = {}
        for s in (+1, -1):
            B_SIGN[k] = s; set_pose(m, d, np.zeros(6), qa); wb = wrist("B"); wb[0] = BASE_GAP - wb[0]
            if k in (0,):  # pan: mirrored arm should move the opposite way in y for the same +angle? no - a joust mirror: A pans left (+y), B pans to its own left (-y)
                pass
            res[s] = float(np.linalg.norm(wa - wb))
        best = min(res, key=res.get); B_SIGN[k] = best
        print(f"{name}: sign {best:+d}  (err + {res[1]:.4f}, err - {res[-1]:.4f})")
    print("B_SIGN", B_SIGN.tolist())
    set_pose(m, d, np.zeros(6), np.zeros(6))
    r = mujoco.Renderer(m, 720, 1280)
    for view in ["side", "iso", "top"]:
        r.update_scene(d, make_camera(view=view), render_opts()); imageio.imwrite(f"out/arena_zero_{view}.png", r.render())
    print("rendered")
