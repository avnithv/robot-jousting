"""Planar IK for arm A in the arena: solve (lift, elbow, wrist_flex) so the sword hilt sits at a
given (x, z) in the sagittal plane with a given blade pitch (deg, positive = tip up), for fixed pan/roll.
Poses found for A are valid for B by construction (B mirrors A through the joint mapping)."""
import mujoco, numpy as np
import arena

_spec, _m = arena.build(); _d = mujoco.MjData(_m)
LO = np.degrees(_m.jnt_range[:6, 0]); HI = np.degrees(_m.jnt_range[:6, 1])

def fk(q):
    arena.set_pose(_m, _d, q, np.zeros(6))
    hilt = _d.site("A_hilt").xpos.copy(); tip = _d.site("A_tip").xpos.copy()
    v = tip - hilt; pitch = np.degrees(np.arctan2(v[2], np.hypot(v[0], v[1])))
    return hilt, tip, pitch

def _solve_from(hilt_x, hilt_z, pitch_deg, pan, roll, init, iters=80):
    q = np.array(init, float); q[0] = pan; q[4] = roll; q[5] = 0
    def resid(q):
        h, t, p = fk(q); r = np.hypot(h[0], h[1]) * np.sign(h[0])
        dp = (p - pitch_deg + 180) % 360 - 180
        return np.array([r - hilt_x, h[2] - hilt_z, dp * 0.003])
    best_q, best_n = q.copy(), np.inf
    for _ in range(iters):
        r0 = resid(q)
        if np.linalg.norm(r0) < best_n: best_q, best_n = q.copy(), np.linalg.norm(r0)
        if np.linalg.norm(r0) < 2e-4: break
        J = np.zeros((3, 3)); eps = 0.5
        for k, j in enumerate((1, 2, 3)):
            qq = q.copy(); qq[j] += eps; J[:, k] = (resid(qq) - r0) / eps
        step, *_ = np.linalg.lstsq(J, -r0, rcond=None)
        q[1:4] += np.clip(step, -15, 15)
        q = np.clip(q, LO + 1, HI - 1)
    q = best_q; r = resid(q); h, t, p = fk(q)
    err = np.array([abs(r[0]), abs(r[1]), abs(r[2] / 0.003)])
    return q, err, h, t

def solve(hilt_x, hilt_z, pitch_deg, pan=0.0, roll=0.0, init=None):
    """Planar IK with a coarse grid initialisation followed by Newton refinement.
    Returns (q, err[m, m, deg], hilt, tip). Check err: a large one means the target is unreachable."""
    def score_of(q):
        h, t, p = fk(q); dp = (p - pitch_deg + 180) % 360 - 180
        return abs(np.hypot(h[0], h[1]) * np.sign(h[0]) - hilt_x) + abs(h[2] - hilt_z) + abs(dp) * 0.003
    cands = []
    for l in np.linspace(LO[1] + 2, HI[1] - 2, 13):
        for e in np.linspace(LO[2] + 2, HI[2] - 2, 13):
            for w in np.linspace(LO[3] + 2, HI[3] - 2, 13):
                q = np.array([pan, l, e, w, roll, 0.0]); cands.append((score_of(q), q))
    cands.sort(key=lambda c: c[0])
    inits = [c[1] for c in cands[:6]] + ([np.array(init, float)] if init is not None else [])
    best = None
    for i in inits:
        q, err, h, t = _solve_from(hilt_x, hilt_z, pitch_deg, pan, roll, i)
        s = err[0] + err[1] + err[2] * 0.003
        if best is None or s < best[0]: best = (s, q, err, h, t)
    return best[1:]

if __name__ == "__main__":
    tests = {"ready": (0.26, 0.20, 10), "thrust_ext": (0.36, 0.21, 0), "high_strike": (0.30, 0.32, -10), "high_strike2": (0.28, 0.30, -20),
             "low": (0.22, 0.10, -10), "guard_high": (0.25, 0.22, 90), "guard_high70": (0.22, 0.24, 70), "guard_low": (0.25, 0.25, -90),
             "guard_low70": (0.24, 0.24, -70), "windup": (0.10, 0.40, 80), "overhead": (0.05, 0.42, 60)}
    for n, s in tests.items():
        q, err, h, t = solve(*s)
        print(f"{n:13s} {s} -> q {np.round(q[:4],1)} err {np.round(err,3)} tip {np.round(t,3)}")
