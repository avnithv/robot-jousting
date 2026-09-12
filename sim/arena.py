"""Two-arm joust arena in MuJoCo: A = SO101 (faces +x), B = SO100 (faces -x).
Poses are always given in SO101 new-calib convention (degrees, zero = upright upper arm,
forearm horizontal forward). B's URDF joints are mapped via q100 = SIGN*q + OFFSET."""
import mujoco, numpy as np

import os
_SO_ARM = os.environ.get("SO_ARM_DIR", os.path.expanduser("~/so-arm/SO-ARM100"))   # clone of github.com/TheRobotStudio/SO-ARM100
SO101 = os.path.join(_SO_ARM, "Simulation/SO101/so101_new_calib.xml")
SO100 = os.path.join(_SO_ARM, "Simulation/SO100/so100.urdf")
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
# ---- the sword: the printed fencing gripper (arm_cad/fencing_gripper). The moving jaw is replaced by Sword_Holder_SO101,
# whose blade socket runs along the jaw's finger axis (moving-jaw local -y) with its mouth SOCKET_MOUTH from the jaw pivot;
# a Sword_Blade_<style> (real STL mesh, copied into assets/blades/) sits in it with TANG inside and SWORD_LEN showing.
SWORD_LEN = 0.2032   # metres of blade past the socket mouth: the 8 in family (6 in = 0.1524). Tip = SOCKET_MOUTH + SWORD_LEN from the pivot
SOCKET_MOUTH = 0.056 # jaw pivot -> socket mouth along the holder's finger axis (Sword_Holder_SO101: MOUTH_Y = -56 mm)
TANG = 0.036         # blade tang inside the socket (blade STL x = 0 is the tang's inner end, x = TANG the mouth)
BLADE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "blades")
BLADE_STYLE = {"A": os.environ.get("JOUST_BLADE_A") or os.environ.get("JOUST_BLADE", "8in_fang"),
               "B": os.environ.get("JOUST_BLADE_B") or os.environ.get("JOUST_BLADE", "8in_fang")}   # "none" = the old capsule baton
SWORD_ON_JAW = True  # sword on the moving finger; False = fixed along the gripper
SHIELD = False       # no shield in v1
BASE_GAP = 0.61    # metres between the two shoulder_pan axes at the clash (2 ft gantry stop); the default build() spacing
# ---- the stepper gantry (gantry/README.md, arm/arms.json "gantry") -----------------------------------------
# Each arm sits on a GRBL-driven carriage: X carries A, Y carries B, work coordinate 0..200 mm, 0 = fully charged in.
# PLATE_FRONT measured off the base meshes in this model (max +x extent of A_base / -x of B's base over the plate
# band z = -5..20 mm, relative to that arm's shoulder_pan axis): 25.80 mm on both arms.
PLATE_FRONT = 0.0258          # m from the pan axis to the base plate tip, each arm
CHARGE_TIP_GAP = 0.4953       # m (19.5 in, measured on the real rig): plate tip to plate tip, fully charged in
CHARGED_GAP = CHARGE_TIP_GAP + 2 * PLATE_FRONT       # 0.5469 m between the pan axes at the charge-in stop = the MINIMUM
GANTRY_TRAVEL = 0.200         # m of travel per carriage (GRBL 0..200 mm; arms.json apart = X200 Y200)
GANTRY_MAX_MPS = 24000 / 60 / 1000.0                 # 0.4 m/s from the 24000 mm/min feed ceiling
GANTRY_APART = CHARGED_GAP + 2 * GANTRY_TRAVEL       # 0.9469 m: both carriages at the daemon's "apart"
def gantry_gap(gA=0.0, gB=0.0):
    """Pan-axis spacing (m) for carriage retractions gA, gB (m from the charge-in stop, 0 .. GANTRY_TRAVEL)."""
    return CHARGED_GAP + float(gA) + float(gB)
B_OFFSET_DEG = np.array([0.0, 102.77, -90.0, -31.94, 0.0, 0.0])
B_SIGN = np.array([-1.0, 1.0, 1.0, 1.0, 1.0, 1.0])   # pan: +ve = each arm's OWN right (B mirrors A)

def q_to_model(arm, q_deg):
    q = np.radians(np.asarray(q_deg, float))
    if arm == "A":
        return q
    return np.radians(B_SIGN * np.asarray(q_deg, float) + B_OFFSET_DEG)

def load_stl(path, decimals=4):
    """Binary STL -> (unique vertices [n,3] in the file's units, faces [m,3]); no trimesh in this venv."""
    import struct
    with open(path, "rb") as f:
        f.read(80); n = struct.unpack("<I", f.read(4))[0]
        rec = np.frombuffer(f.read(n * 50), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    tri = rec["v"].reshape(-1, 3).astype(np.float64)
    verts, inv = np.unique(np.round(tri, decimals), axis=0, return_inverse=True)
    return verts, inv.reshape(-1, 3)

_BLADE_CACHE = {}
def blade_mesh(style):
    """(vertices in metres, faces) of assets/blades/Sword_Blade_<style>.stl, or None when the style is 'none' or missing."""
    if not style or style == "none": return None
    if style not in _BLADE_CACHE:
        path = os.path.join(BLADE_DIR, f"Sword_Blade_{style}.stl")
        if not os.path.exists(path):
            print(f"arena: no blade mesh {path}; using the capsule baton"); _BLADE_CACHE[style] = None
        else:
            v, f = load_stl(path); _BLADE_CACHE[style] = (v * 0.001, f)
    return _BLADE_CACHE[style]

def _add_blade(spec, jaw_name, hinge_local, finger_local, plane_z, hilt_local, style, rgba, sword_len):
    """The real blade on the moving jaw. Frame: the sword body's z runs along the holder's finger axis from the socket
    mouth, x is the jaw hinge (the blade's thickness), y the blade's width. The mesh (blade STL: length +X, width Y,
    thickness +Z with the spine up) is rotated into that frame with its socket-mouth section (x = TANG) at the body origin.
    `hilt` stays at the old reference point (the stock fixed-finger tip) so the move library's hand x/z are unchanged;
    `mouth` marks the socket mouth and `tip` the real blade tip."""
    body = spec.body(jaw_name)
    zb = np.asarray(finger_local, float); xb = np.asarray(hinge_local, float); yb = np.cross(zb, xb)
    quat = np.zeros(4); mujoco.mju_mat2Quat(quat, np.column_stack([xb, yb, zb]).flatten())
    pos = zb * SOCKET_MOUTH + xb * plane_z
    blade = body.add_body(name="sword", pos=list(pos), quat=list(quat))
    verts, faces = blade_mesh(style)
    mesh = spec.add_mesh(name=f"blade_{style}"); mesh.uservert = verts.flatten().tolist(); mesh.userface = faces.flatten().tolist()
    gq = np.zeros(4); mujoco.mju_mat2Quat(gq, np.column_stack([[0, 0, 1], [0, -1, 0], [1, 0, 0]]).astype(float).flatten())   # mesh X->z, Y->-y, Z->x
    blade.add_geom(name="blade", type=mujoco.mjtGeom.mjGEOM_MESH, meshname=f"blade_{style}", pos=[-0.0015, 0, -TANG], quat=list(gq),
                   rgba=rgba, mass=0.02, contype=1, conaffinity=1)
    blade.add_site(name="tip", pos=[0, 0, sword_len], size=[0.008, 0, 0], rgba=[1, 1, 1, 1])
    blade.add_site(name="mouth", pos=[0, 0, 0], size=[0.005, 0, 0], rgba=[1, 1, 0.5, 1])
    body.add_site(name="hilt", pos=list(hilt_local), size=[0.006, 0, 0], rgba=[1, 1, 1, 1])

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

def _arm_with_sword(path, q_zero_rad, forward_in_arm_frame, hilt_dist_from_pan, pan_axis_xy, rgba, sword_len, blade=None):
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
        if blade_mesh(blade) is not None:
            # The printed holder: its socket runs along the moving jaw's finger axis (local -y), in the plane of the stock
            # fixed finger (the fixed-finger tip's offset along the hinge gives that plane: 18.9 mm on the SO101 mesh, 0 on the SO100).
            hinge = np.asarray(child.joint("gripper").axis, float); hinge /= np.linalg.norm(hinge)
            finger = np.array([0, -1.0, 0]); finger -= (finger @ hinge) * hinge; finger /= np.linalg.norm(finger)
            _add_blade(child, jaw_name, hinge, finger, float(start_local @ hinge), start_local, blade, rgba, sword_len)
        else:
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
                      rgba=[0.15, 0.15, 0.15, 0], group=3, contype=1, conaffinity=1)   # collision only: alpha 0 keeps it out of every render
        _dress_urdf_arm(child, os.path.join(os.path.dirname(path), "assets"))
    return child

# The URDF importer keeps only each link's <collision> mesh (one near-black shell per link: no servos, no jaws), so the
# SO100 rendered as a silhouette that ended in the collision capsule with the blade floating off it. These are the
# URDF's <visual> meshes per link (all at the link origin), added as mass-less, non-colliding geoms.
URDF_VISUALS = {"world": ["Base", "Base_Motor"], "shoulder": ["Rotation_Pitch", "Rotation_Pitch_Motor"],
                "upper_arm": ["Upper_Arm", "Upper_Arm_Motor"], "lower_arm": ["Lower_Arm", "Lower_Arm_Motor"],
                "wrist": ["Wrist_Pitch_Roll", "Wrist_Pitch_Roll_Motor"], "gripper": ["Fixed_Jaw", "Fixed_Jaw_Motor"], "jaw": ["Moving_Jaw"]}
URDF_PLASTIC = [0.15, 0.15, 0.16, 1]   # the printed parts: charcoal, so "the black arm" keeps its identity but reads in the light
URDF_MOTOR = [0.34, 0.34, 0.36, 1]     # the STS3215 servos: graphite

def _dress_urdf_arm(child, asset_dir):
    """Give a URDF-imported arm its visual meshes (printed parts + servos + both jaws) and hide the collision shells,
    which are the same STLs and would z-fight with them. Physics is untouched: the visuals have mass 0 and no contacts."""
    for link, meshes in URDF_VISUALS.items():
        body = child.worldbody if link == "world" else child.body(link)
        for g in body.geoms:
            if g.name.startswith("vis_"): continue
            g.rgba = [g.rgba[0], g.rgba[1], g.rgba[2], 0.0]; g.group = 3
        for mn in meshes:
            p = os.path.join(asset_dir, f"{mn}.stl")
            if not os.path.exists(p): print(f"arena: no visual mesh {p}"); continue
            v, f = load_stl(p)   # these STLs are in metres already
            ms = child.add_mesh(name=f"vis_{mn}"); ms.uservert = v.flatten().tolist(); ms.userface = f.flatten().tolist()
            body.add_geom(name=f"vis_{link}_{mn}", type=mujoco.mjtGeom.mjGEOM_MESH, meshname=f"vis_{mn}", contype=0, conaffinity=0, mass=0,
                          rgba=URDF_MOTOR if mn.endswith("Motor") else URDF_PLASTIC)

def _add_carriage(spec, name, x0, quat, gap_for_rail):
    """A gantry carriage body at x0 with a slide joint `<name>_gantry` along the arena x axis. The joint reads the
    GRBL work coordinate of that axis: 0 = charged in (the hard stop), +GANTRY_TRAVEL = apart, so the axis points
    away from the opponent. Returns the frame to attach the arm to."""
    sgn = -1.0 if name == "A" else 1.0          # +q must move the arm AWAY from the opponent
    car = spec.worldbody.add_body(name=f"{name}_carriage", pos=[x0, 0, 0])
    j = car.add_joint(name=f"{name}_gantry", type=mujoco.mjtJoint.mjJNT_SLIDE, axis=[sgn, 0, 0], range=[0, GANTRY_TRAVEL])
    j.limited = mujoco.mjtLimited.mjLIMITED_TRUE; j.damping = [60.0, 0, 0]; j.armature = 2.0
    rgba = [0.62, 0.64, 0.68, 1]
    for s in (-1, 1):                            # two blocks riding the rails, flanking the base plate
        car.add_geom(name=f"{name}_carriage_{'lr'[s > 0]}", type=mujoco.mjtGeom.mjGEOM_BOX, size=[0.055, 0.016, 0.011],
                     pos=[0.0388353 if name == "A" else -0.0388353, s * 0.078, 0.011], rgba=rgba, mass=0.3, contype=0, conaffinity=0)
    return car.add_frame(pos=[0, 0, 0], quat=quat)

def build(base_gap=None, sword_len=SWORD_LEN, hilt_reach=0.353, blades=None, gantry=False):
    """blades: {"A": style, "B": style} of assets/blades/Sword_Blade_<style>.stl (default BLADE_STYLE; "none" = capsule baton).
    gantry=False (default): the arms are bolted to the world at `base_gap` (default BASE_GAP = 0.61 m) exactly as before.
    gantry=True: each arm rides a carriage with a slide joint A_gantry / B_gantry, and `base_gap` defaults to CHARGED_GAP,
    i.e. the carriages read 0 = the 19.5 in charge-in stop and drive out to GANTRY_TRAVEL. No actuators are added for
    them (d.ctrl stays 12 long); drive them with set_pose(..., gA=, gB=) or set_gantry()."""
    base_gap = (CHARGED_GAP if gantry else BASE_GAP) if base_gap is None else base_gap
    blades = {**BLADE_STYLE, **(blades or {})}
    spec = mujoco.MjSpec()
    spec.compiler.discardvisual = False
    spec.option.timestep = 0.002
    spec.visual.global_.offwidth = 1280
    spec.visual.global_.offheight = 720
    spec.worldbody.add_light(pos=[0, 0, 3], dir=[0, 0, -1], type=mujoco.mjtLightType.mjLIGHT_DIRECTIONAL)
    spec.worldbody.add_light(pos=[base_gap / 2, -1.0, 1.2], dir=[0, 0.6, -0.8])
    # Fill from the far side: arm B's meshes are near black and used to sink into the background on the iso
    # camera, which made a fall or a collapse unreadable. Lighting only -- no geometry or joint change.
    spec.worldbody.add_light(pos=[base_gap / 2, 1.1, 1.0], dir=[0, -0.6, -0.8], diffuse=[0.45, 0.45, 0.5])
    spec.worldbody.add_geom(name="floor", type=mujoco.mjtGeom.mjGEOM_PLANE, size=[2, 2, 0.05],
                            rgba=[0.25, 0.25, 0.28, 1], contype=0, conaffinity=0)
    # A: SO101, extends along +x in its own frame, pan axis at (0.0388, 0)
    a = _arm_with_sword(SO101, np.zeros(6), [1, 0, 0], hilt_reach, (0.0388353, 0), [0.9, 0.2, 0.2, 1], sword_len, blades["A"])
    # B: SO100 URDF, extends along -y in its own frame, pan axis at (0, -0.0452)
    b = _arm_with_sword(SO100, np.radians(B_OFFSET_DEG), [0, -1, 0], hilt_reach, (0, -0.0452), [0.2, 0.4, 0.9, 1], sword_len, blades["B"])
    if gantry:
        lo, hi = -GANTRY_TRAVEL - 0.12, base_gap + GANTRY_TRAVEL + 0.12
        for s in (-1, 1):   # the fixed rails the carriages ride on
            spec.worldbody.add_geom(name=f"rail_{'lr'[s > 0]}", type=mujoco.mjtGeom.mjGEOM_BOX, size=[(hi - lo) / 2, 0.013, 0.006],
                                    pos=[(lo + hi) / 2, s * 0.078, 0.006], rgba=[0.16, 0.17, 0.19, 1], contype=0, conaffinity=0)
        fa = _add_carriage(spec, "A", -0.0388353, [1, 0, 0, 0], base_gap)
        fb = _add_carriage(spec, "B", base_gap + 0.0452, [0.7071068, 0, 0, -0.7071068], base_gap)
    else:
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
    finish_model(model)
    return spec, model

def finish_model(model):
    """The post-compile patches every arena model needs. Anyone who edits the spec build() returns and RECOMPILES it
    (video/render/shot_common.py does, for 1080p) must call this on the new model: MjSpec.compile() starts from the
    spec, so these patches are lost, and without them arm B runs undamped with the SO101 servo gains and its wrist and
    jaw chatter visibly. (Kept as model patches rather than spec attributes on purpose: setting the armature on the
    spec changes the solver weights MuJoCo precomputes at compile time and shifts the simulated exchanges by a few
    millimetres; this keeps every trajectory bit-identical to what the move library was tuned against.)"""
    for jn in ("A_wrist_roll", "B_wrist_roll"):   # real roll is a full turn; let the sim reach +/-185 so roll -180 renders
        j = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, jn); u = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, jn)
        model.jnt_range[j] = [np.radians(-185), np.radians(185)]; model.actuator_ctrlrange[u] = [np.radians(-185), np.radians(185)]
    # URDF joints import with no damping/armature; give B the SO101 (STS3215) joint dynamics
    for j in range(model.njnt):
        nm = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, j)
        if nm.startswith("B_") and not nm.endswith("_gantry"):
            a = model.jnt_dofadr[j]; model.dof_damping[a] = 0.60; model.dof_armature[a] = 0.028; model.dof_frictionloss[a] = 0.052
    return model

_ADR = {}
def addr(m):
    """Cached qpos/dof addresses by joint name: {"A": [6 qpos adr], "B": [...], "gA"/"gB": (qpos adr, dof adr) or None}.
    Everything indexes by NAME so a model with the gantry carriages (which shift the qpos layout) works unchanged."""
    key = id(m)
    if key not in _ADR:
        jid = lambda n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)
        a = {arm: [m.jnt_qposadr[jid(f"{arm}_{j}")] for j in JOINTS] for arm in ("A", "B")}
        for arm in ("A", "B"):
            i = jid(f"{arm}_gantry"); a["g" + arm] = (m.jnt_qposadr[i], m.jnt_dofadr[i]) if i >= 0 else None
        a["u"] = {arm: [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, f"{arm}_{j}") for j in JOINTS] for arm in ("A", "B")}
        _ADR[key] = a
    return _ADR[key]

def set_gantry(m, d, gA=None, gB=None):
    """Park the carriages at gA / gB metres of retraction from the charge-in stop (0 .. GANTRY_TRAVEL). Unactuated
    slide joints: the position is written straight into qpos (and the velocity zeroed) the way a stepper holds."""
    ad = addr(m)
    for g, key in ((gA, "gA"), (gB, "gB")):
        if g is None or ad[key] is None: continue
        qa, da = ad[key]; d.qpos[qa] = float(np.clip(g, 0.0, GANTRY_TRAVEL)); d.qvel[da] = 0.0

def set_pose(m, d, qA_deg, qB_deg, gA=None, gB=None):
    ad = addr(m)
    d.qpos[ad["A"]] = q_to_model("A", qA_deg); d.qpos[ad["B"]] = q_to_model("B", qB_deg)
    d.ctrl[ad["u"]["A"]] = d.qpos[ad["A"]]; d.ctrl[ad["u"]["B"]] = d.qpos[ad["B"]]
    set_gantry(m, d, gA, gB)
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
