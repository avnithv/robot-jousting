"""Brute-force pose search: enumerate (lift, elbow, wrist) on a grid for fixed pan/roll, keep configs that satisfy
geometric constraints on the hilt/tip, and pick the one closest (in joint space) to a reference pose."""
import numpy as np, ik

def find(hilt_x=(0, 1), hilt_z=(0, 1), pitch=(-180, 180), tip_z_min=0.03, pan=0.0, roll=0.0, near=None, step=4.0, weights=(1, 1, 1)):
    LO, HI = ik.LO, ik.HI
    best = None; count = 0
    for l in np.arange(LO[1] + 2, HI[1] - 1, step):
        for e in np.arange(LO[2] + 2, HI[2] - 1, step):
            for w in np.arange(LO[3] + 2, HI[3] - 1, step):
                q = np.array([pan, l, e, w, roll, 0.0]); h, t, p = ik.fk(q)
                r = np.hypot(h[0], h[1]) * np.sign(h[0])
                if not (hilt_x[0] <= r <= hilt_x[1] and hilt_z[0] <= h[2] <= hilt_z[1] and pitch[0] <= p <= pitch[1] and t[2] >= tip_z_min): continue
                count += 1
                cost = 0.0 if near is None else float(np.sum(np.asarray(weights) * np.abs(q[1:4] - np.asarray(near)[1:4])))
                if best is None or cost < best[0]: best = (cost, q, h, t, p)
    return best, count

if __name__ == "__main__":
    nominal = np.array([5, -45, 60, -20, 0, 0], float)   # a comfortable mid configuration to stay near
    res = {}
    for name, kw in {
        "STANCE_HIGH": dict(hilt_x=(0.17, 0.21), hilt_z=(0.25, 0.29), pitch=(10, 30), pan=5, near=nominal),
        "STANCE_LOW":  dict(hilt_x=(0.17, 0.21), hilt_z=(0.13, 0.17), pitch=(-25, -5), pan=5, near=nominal),
    }.items():
        best, n = find(**kw); res[name] = best
        print(f"{name:12s} candidates {n:5d} -> q {np.round(best[1][:4]).astype(int).tolist()} hilt ({best[2][0]:.2f},{best[2][2]:.2f}) tip z {best[3][2]:.2f} pitch {best[4]:.0f}")
    for name, kw in {
        "BLOCK_HIGH": dict(hilt_x=(0.18, 0.27), hilt_z=(0.20, 0.30), pitch=(75, 95), near=res["STANCE_HIGH"][1], roll=90),
        "BLOCK_LOW":  dict(hilt_x=(0.18, 0.27), hilt_z=(0.16, 0.26), pitch=(-60, -35), tip_z_min=0.04, near=res["STANCE_LOW"][1], roll=90),
        "WINDUP_HIGH": dict(hilt_x=(0.02, 0.14), hilt_z=(0.32, 0.45), pitch=(60, 90), near=res["STANCE_HIGH"][1]),
        "STRIKE_HIGH": dict(hilt_x=(0.24, 0.27), hilt_z=(0.27, 0.32), pitch=(-20, 0), near=res["STANCE_HIGH"][1]),
        "WINDUP_LOW":  dict(hilt_x=(0.19, 0.24), hilt_z=(0.10, 0.14), pitch=(-20, 0), pan=45, near=res["STANCE_LOW"][1]),
        "STRIKE_LOW":  dict(hilt_x=(0.24, 0.27), hilt_z=(0.09, 0.13), pitch=(-20, 0), pan=-25, near=res["STANCE_LOW"][1]),
    }.items():
        best, n = find(**kw); res[name] = best
        print(f"{name:12s} candidates {n:5d} -> q {np.round(best[1][:4]).astype(int).tolist()} hilt ({best[2][0]:.2f},{best[2][2]:.2f}) tip z {best[3][2]:.2f} pitch {best[4]:.0f}")
    import json; json.dump({k: v[1].tolist() for k, v in res.items()}, open("search_result.json", "w"), indent=1)
