"""Validate (and optionally render) a transition library file for both arms.
    ../.venv/bin/python validate_transition.py transitions/ATTACK_HIGH__BLOCK_LEFT.json [--render] [--arm A|B]"""
import sys, os, json, numpy as np, mujoco, imageio
import arena, ik, tune, chain
from chain import HUBS, path_ok, seg_time, recipe, resolve_via

def state_pose(name, which):
    """Pose of a state for the current arm: hub, REST, or a move's START ('start') / END ('end') pose."""
    if name in HUBS: return HUBS[name]
    if name == "REST": return tune.REST.copy()
    rec = [np.array(k, float) for k, _ in recipe(name)]
    return rec[1] if which == "start" else rec[-1]

def check_path(a, path, b, durations):
    pts = [a] + path + [b]; durs = list(durations) + [seg_time(path[-1] if path else a, b)]
    problems = []; keys = []; times = [0.0]
    for i, (p, q) in enumerate(zip(pts[:-1], pts[1:])):
        if not path_ok(p, q): problems.append(f"leg {i}: unsafe straight path (reach/table/roll/lift)")
        need = seg_time(p, q)
        if durs[i] < need * 0.75: problems.append(f"leg {i}: {durs[i]:.2f}s too fast (needs ~{need:.2f}s)")
        times.append(times[-1] + durs[i])
    ts, Q = chain.catmull_rom(pts, times); peak = np.abs(np.gradient(Q, ts, axis=0)).max(0)
    over = [chain.JOINTS[k] for k in range(5) if peak[k] > tune.SERVO_CAP_DPS * 1.15]
    if over: problems.append(f"over speed cap on {over} (peaks {np.round(peak).astype(int).tolist()})")
    return problems, ts, Q, times[-1]

def validate(fname, arms=("A", "B"), render=False):
    spec = json.load(open(fname)); ok_all = True
    for arm in arms:
        tune.use_arm(arm); a = state_pose(spec["from"], "end"); b = state_pose(spec["to"], "start")
        for p in spec["paths"]:
            probs, ts, Q, T = check_path(a, resolve_via(p.get("via", [])), b, p.get("durations", []))
            print(f"[{arm}] {spec['from']} -> {spec['to']} :: {p['name']:14s} {T:.2f}s  {'OK' if not probs else 'FAIL: ' + '; '.join(probs)}")
            ok_all &= not probs
            if render and not probs:
                m = arena.build()[1]; d = mujoco.MjData(m); arena.set_pose(m, d, Q[0], tune.REST); r = mujoco.Renderer(m, 360, 640); frames = []
                cam = arena.make_camera(view="iso"); cam.distance = 0.9; cam.lookat[:] = [0.15, 0, 0.2]; cam.azimuth = 135; cam.elevation = -20
                for i in np.linspace(0, len(ts) - 1, 8).astype(int):
                    arena.set_pose(m, d, Q[i], tune.REST); r.update_scene(d, cam, arena.render_opts()); frames.append(r.render().copy())
                strip = np.concatenate([np.concatenate(frames[:4], axis=1), np.concatenate(frames[4:], axis=1)], axis=0)
                out = f"out/tr_{spec['from']}__{spec['to']}__{p['name']}_{arm}.png"; imageio.imwrite(out, strip); print("   filmstrip:", out)
    return ok_all

if __name__ == "__main__":
    args = sys.argv[1:]; render = "--render" in args; arms = ("A", "B")
    if "--arm" in args: i = args.index("--arm"); arms = (args[i + 1],); args = args[:i] + args[i + 2:]
    files = [a for a in args if a.endswith(".json")]
    if not files: files = sorted(f"transitions/{f}" for f in os.listdir("transitions") if f.endswith(".json"))
    bad = [f for f in files if not validate(f, arms, render)]
    print(f"\n{len(files) - len(bad)} of {len(files)} files fully valid" + (f"; problems in: {bad}" if bad else ""))
