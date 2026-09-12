"""Open the interactive MuJoCo viewer on the two-arm arena and loop the version-1 moves.
    cd ~/game && .venv/bin/python sim/view.py            # both arms cycle through the 4 moves
    cd ~/game && .venv/bin/python sim/view.py attack_high block_high   # A does the first, B the second, on repeat
Drag to orbit, scroll to zoom, space to pause."""
import sys, time, itertools, numpy as np, mujoco, mujoco.viewer
import arena, moves_v1 as mv

spec, m = arena.build(); d = mujoco.MjData(m)
names = list(mv.MOVES)
seqA = [sys.argv[1]] if len(sys.argv) > 1 else names
seqB = [sys.argv[2]] if len(sys.argv) > 2 else names[::-1]

def track(frames, start):
    segs = mv.timed(frames, start); ts = np.cumsum([t for _, t in segs]); ps = [p for p, _ in segs]
    def f(t):
        pt, pp = 0.0, start
        for tt, p in zip(ts, ps):
            if t <= tt: return pp + (t - pt) / max(tt - pt, 1e-6) * (p - pp)
            pt, pp = tt, p
        return ps[-1]
    return f, float(ts[-1])

stanceA, stanceB = "high", "high"
arena.set_pose(m, d, mv.STANCES[stanceA], mv.STANCES[stanceB])
with mujoco.viewer.launch_passive(m, d) as v:
    v.cam.lookat[:] = [arena.BASE_GAP / 2, 0, 0.2]; v.cam.distance = 1.0; v.cam.azimuth = 90; v.cam.elevation = -15
    for ma, mb in itertools.cycle(zip(itertools.cycle(seqA), itertools.cycle(seqB))):
        fA, tA = track(mv.MOVES[ma]["frames"], mv.STANCES[stanceA]); fB, tB = track(mv.MOVES[mb]["frames"], mv.STANCES[stanceB])
        T = max(tA, tB) + 0.4; t0 = d.time
        while v.is_running() and d.time - t0 < T:
            t = d.time - t0
            d.ctrl[:6] = arena.q_to_model("A", fA(t)); d.ctrl[6:] = arena.q_to_model("B", fB(t))
            mujoco.mj_step(m, d); v.sync(); time.sleep(m.opt.timestep)
        if not v.is_running(): break
        stanceA, stanceB = mv.MOVES[ma]["ends"], mv.MOVES[mb]["ends"]
