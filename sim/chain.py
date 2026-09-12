"""Chain compiler: stitch moves so each starts where the previous ended, on a fixed beat, with transitions.
    ../.venv/bin/python chain.py CHAIN_A ATTACK_HIGH BLOCK_LEFT ATTACK_LOW_RL          # build + render (opponent at rest)
    ../.venv/bin/python chain.py pair ATTACK_HIGH BLOCK_LEFT -- BLOCK_HIGH ATTACK_LOW_LR   # build CHAIN_A and CHAIN_B, render the pair
Beat model (BEAT s per move): attacks and feints have their last key (impact / pull-back) pinned at IMPACT s into the beat,
blocks have their guard key pinned at GUARD s; the arm then holds until the beat ends. The transition from the previous
end pose to the move's first key fills the time before the windup; it is a direct blend when the straight joint path is
safe, otherwise it routes through hub poses (hubs.json) per transitions.json, or READY_MID by default."""
import sys, os, json, numpy as np, mujoco, imageio
import arena, ik, tune
from tune import PARAMS, REST, ROLL_OFFSET, JOINTS, OUT, catmull_rom, recipe
BEAT, IMPACT, GUARD = 1.4, 1.0, 0.55
TIP_MIN = -0.08             # blade tip floor (m). The real board sits below the sim base plane; the captured left guard reaches -0.07 without touching.
BLEND_RATE = 200.0          # deg/s used to size transitions (Catmull-Rom peaks ~1.5x the mean, so this keeps peaks < 300)
HERE = os.path.dirname(os.path.abspath(__file__))
HUBS = {k: np.array(v, float) for k, v in json.load(open(os.path.join(HERE, "hubs.json"))).items() if not k.startswith("_")}
ROUTES = {k: v for k, v in json.load(open(os.path.join(HERE, "transitions.json"))).items() if not k.startswith("_")}

def pin_of(move):
    if move.startswith("BLOCK"): return "first", GUARD
    return "last", IMPACT

def path_ok(a, b, n=12):
    """Straight joint-space path from a to b: hand reach <= 0.30, blade and hand above the table, roll inside the wrap."""
    for s in np.linspace(0, 1, n):
        q = a + s * (b - a); h, t, p = ik.fk(q)
        if np.hypot(h[0], h[1]) > 0.30 or h[2] < 0.04 or t[2] < TIP_MIN or not (-185 <= q[4] <= 100) or q[1] < -89: return False
    return True

def route(prev_move, prev_pose, move, first):
    key = f"{prev_move}->{move}"; r = ROUTES.get(key) or ROUTES.get(f"*->{move}") or ROUTES.get(f"{prev_move}->*")
    if r: return [HUBS[h] for h in r["via"]], f"route {r['via']}"
    if path_ok(prev_pose, first): return [], "direct"
    return [HUBS["READY_MID"]], "auto via READY_MID (direct path unsafe)"

def seg_time(a, b): return max(float(np.max(np.abs(b[:5] - a[:5])) / BLEND_RATE), 0.15)

def compile_chain(moves, name, start_pose=None, verbose=True, beat_extra=None, save=True):
    """beat_extra: optional per-beat extra seconds (used to keep two arms' beats aligned). Returns (ts, Q, beats, stretches)."""
    stretches = []
    keys = [start_pose if start_pose is not None else REST.copy()]; times = [0.0]; beats = []; prev_move = "REST"; t_beat = 0.0
    for move in moves:
        rec = [(np.array(k, float), float(d)) for k, d in recipe(move)][1:]   # drop the leading REST key
        pin_which, pin_t = pin_of(move); pin_i = 0 if pin_which == "first" else len(rec) - 1
        windup = sum(d for _, d in rec[1:pin_i + 1])                          # time from first key to the pinned key
        via, how = route(prev_move, keys[-1], move, rec[0][0])
        path = via + [rec[0][0]]; need = sum(seg_time(a, b) for a, b in zip([keys[-1]] + path[:-1], path))
        avail = pin_t - windup; t_tr = max(avail, need); stretch = t_tr - avail
        if beat_extra is not None: stretch = max(stretch, beat_extra[len(beats)]); t_tr = avail + stretch
        stretches.append(stretch)
        if verbose: print(f"  {move:14s} transition {how}: {t_tr:.2f}s (needs {need:.2f}, budget {avail:.2f}){'  ** beat stretched by %.2fs' % stretch if stretch > 1e-3 else ''}")
        # distribute the transition time over its segments proportionally to what each needs
        segs = list(zip([keys[-1]] + path[:-1], path)); w = np.array([seg_time(a, b) for a, b in segs]); w = w / w.sum() * t_tr
        t = t_beat
        for (a, b), dt in zip(segs, w): t += dt; keys.append(b); times.append(t)
        for k, d in rec[1:]: t += d; keys.append(k); times.append(t)
        beat_end = max(t_beat + BEAT + stretch, t + 0.05)
        keys.append(keys[-1].copy()); times.append(beat_end)                  # hold to the end of the beat
        beats.append({"move": move, "start": round(t_beat, 3), "pinned_at": round(t_beat + t_tr + windup, 3), "end": round(beat_end, 3), "transition": how})
        prev_move = move; t_beat = beat_end
    ts, Q = catmull_rom(keys, times); Q[:, 5] = np.clip(Q[:, 5], 0, 100)
    peak = np.abs(np.gradient(Q, ts, axis=0)).max(0); over = [JOINTS[k] for k in range(5) if peak[k] > tune.SERVO_CAP_DPS]
    if verbose: print(f"  total {ts[-1]:.2f}s; peak deg/s {dict(zip(JOINTS, np.round(peak).astype(int).tolist()))}" + (f"  OVER CAP: {over}" if over else ""))
    if not save: return ts, Q, beats, stretches
    # save in real-arm coordinates, same format as single moves
    import fcntl; lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX)
    tuned = json.load(open(OUT)) if os.path.exists(OUT) else {}
    Qr = Q.copy(); Qr[:, 4] += ROLL_OFFSET; keys_r = [np.array(k) + np.array([0, 0, 0, 0, ROLL_OFFSET, 0]) for k in keys]
    tuned[name] = {"t": [round(float(x), 4) for x in ts], "q": [[round(float(x), 2) for x in r] for r in Qr], "roll_offset": ROLL_OFFSET, "joints": JOINTS,
                   "keys": [[round(float(x), 1) for x in k] for k in keys_r], "key_times": [round(float(x), 2) for x in times], "chain": moves, "beats": beats}
    json.dump(tuned, open(OUT, "w")); fcntl.flock(lock, fcntl.LOCK_UN)
    return ts, Q, beats, stretches

if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "pair":
        i = a.index("--"); ours, theirs = a[1:i], a[i + 1:]
        # pass 1: how much each arm would stretch each beat; pass 2: both use the max so the beats stay aligned
        sA = compile_chain(ours, "CHAIN_A", verbose=False, save=False)[3]; sB = compile_chain(theirs, "CHAIN_B", verbose=False, save=False)[3]
        n = max(len(sA), len(sB)); extra = [max((sA + [0] * n)[i], (sB + [0] * n)[i]) for i in range(n)]
        print("beat lengths:", [round(BEAT + e, 2) for e in extra])
        print("== CHAIN_A", ours); compile_chain(ours, "CHAIN_A", beat_extra=extra)
        print("== CHAIN_B", theirs); compile_chain(theirs, "CHAIN_B", beat_extra=extra)
        import pair; pair.run("CHAIN_A", "CHAIN_B")
    else:
        name, moves = a[0], a[1:]; print("==", name, moves); ts, Q, beats, _ = compile_chain(moves, name); tune.replay(name, ts, Q)
