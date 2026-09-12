"""Find per-joint (sign, offset) so that SO100 URDF joints reproduce the SO101 new-calib zero pose geometry.
Compares the chain of joint-anchor positions (relative to shoulder_pan anchor) for the pitch joints."""
import mujoco, numpy as np, itertools
SO101 = "/Users/avnith/so-arm/SO-ARM100/Simulation/SO101/so101_new_calib.xml"
SO100 = "/Users/avnith/so-arm/SO-ARM100/Simulation/SO100/so100.urdf"
def load(p):
    s = mujoco.MjSpec.from_file(p); m = s.compile(); return m, mujoco.MjData(m)
mA, dA = load(SO101); mB, dB = load(SO100)
def anchors(m, d, q):
    d.qpos[:] = q; mujoco.mj_forward(m, d)
    names = ["shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"]
    P = np.array([d.jnt(n).xanchor for n in names])
    return P - P[0]   # relative to shoulder_lift anchor
target = anchors(mA, dA, np.zeros(6))
print("SO101 zero-pose anchors (rel shoulder_lift):\n", np.round(target, 4))
print("link lengths SO101:", np.round(np.linalg.norm(np.diff(target, axis=0), axis=1), 4))
tB = anchors(mB, dB, np.zeros(6))
print("link lengths SO100:", np.round(np.linalg.norm(np.diff(tB, axis=0), axis=1), 4))
# grid search over shoulder_lift, elbow_flex, wrist_flex of SO100 (pan=0, roll=0)
rng = [mB.jnt_range[1], mB.jnt_range[2], mB.jnt_range[3]]
best = (1e9, None)
grids = [np.linspace(r[0], r[1], 81) for r in rng]
for sl in grids[0]:
    for el in grids[1]:
        q = np.zeros(6); q[1] = sl; q[2] = el
        a = anchors(mB, dB, q)
        # compare first three anchors (wrist_flex position) only, ignore lateral offsets (y) by comparing x/z in plane
        err = np.linalg.norm((a[:3] - target[:3])[:, [0, 2]])
        if err < best[0]: best = (err, (sl, el))
print("best shoulder/elbow", np.degrees(best[1]), "err", best[0])
sl, el = best[1]
best2 = (1e9, None)
for wf in grids[2]:
    q = np.zeros(6); q[1] = sl; q[2] = el; q[3] = wf
    a = anchors(mB, dB, q)
    err = np.linalg.norm((a - target)[:, [0, 2]])
    if err < best2[0]: best2 = (err, wf)
print("best wrist_flex", np.degrees(best2[1]), "err", best2[0])
q0 = np.zeros(6); q0[1] = sl; q0[2] = el; q0[3] = best2[1]
print("SO100 anchors at mapped zero:\n", np.round(anchors(mB, dB, q0), 4))
# signs: perturb each SO101 joint by +10deg and each SO100 joint by +/-10deg, see which matches
for k, name in [(1, "shoulder_lift"), (2, "elbow_flex"), (3, "wrist_flex")]:
    qa = np.zeros(6); qa[k] = np.radians(10); ta = anchors(mA, dA, qa)
    for s in (+1, -1):
        qb = q0.copy(); qb[k] += s * np.radians(10); tb = anchors(mB, dB, qb)
        print(name, "sign", s, "err", round(float(np.linalg.norm((ta - tb)[:, [0, 2]])), 4))
# pan and roll: check axis directions in world at mapped zero
for name in ["shoulder_pan", "wrist_roll"]:
    dA.qpos[:] = 0; mujoco.mj_forward(mA, dA); dB.qpos[:] = q0; mujoco.mj_forward(mB, dB)
    print(name, "axis SO101", np.round(dA.jnt(name).xaxis, 3), "axis SO100", np.round(dB.jnt(name).xaxis, 3))
print("OFFSETS_DEG", np.round(np.degrees(q0), 2).tolist())
