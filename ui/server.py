"""Joust move studio: a small local web UI to tweak parameters, simulate, run on the arm, and send feedback to
tuning agents.   Start:  cd ~/game && .venv/bin/python ui/server.py   ->  http://localhost:8765"""
import json, os, sys, time, threading, subprocess, uuid, shutil, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM, ARM, UI = os.path.join(ROOT, "sim"), os.path.join(ROOT, "arm"), os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(ROOT, ".venv", "bin", "python"); OUT = os.path.join(SIM, "out"); PARAMS = os.path.join(SIM, "params"); JOBS = os.path.join(UI, "jobs")
def pdir(arm): return PARAMS if arm == "A" else os.path.join(SIM, f"params_{arm}")
CLAUDE = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
jobs = {}; jobs_lock = threading.Lock(); arm_lock = threading.Lock(); gen_lock = threading.Lock()

import urllib.request
ARM_PY = os.path.expanduser("~/so-arm/.venv/bin/python"); daemon_proc = None
def strike_segment(arm, move):
    """That arm's real-coordinate trajectory for `move` and its strike segment (START key -> last key), as (t, Q, t0, t1)."""
    import numpy as np
    T = json.load(open(os.path.join(ARM, "motions_tuned.json"))); M = T.get(f"{move}@{arm}") or T[move]
    t = np.array(M["t"]); Q = np.array(M["q"]); kt = M["key_times"]; si = 1 + (1 if move in ("ATTACK_HIGH", "FEINT_HIGH") else 0)
    if M.get("arm", "A") != arm:
        c = json.load(open(os.path.join(ARM, "arms.json"))); Q = Q.copy(); Q[:, 4] = Q[:, 4] - c["A"]["roll_offset"] + c[arm]["roll_offset"]
    return t, Q, kt[si], kt[-1]
def strike_pose(arm, move, frac):
    import numpy as np
    t, Q, t0, t1 = strike_segment(arm, move); tt = t0 + frac * (t1 - t0); return [round(float(np.interp(tt, t, Q[:, k])), 1) for k in range(6)]
def strike_frac(arm, move, pose):
    """Fraction along the strike segment whose pose is nearest (first five joints) to a live pose."""
    import numpy as np
    t, Q, t0, t1 = strike_segment(arm, move); fr = np.linspace(0, 1, 201); p = np.array(pose[:5])
    d = [np.linalg.norm(np.array([np.interp(t0 + f * (t1 - t0), t, Q[:, k]) for k in range(5)]) - p) for f in fr]; return float(fr[int(np.argmin(d))])
def daemon(path, body, timeout=10):
    req = urllib.request.Request("http://127.0.0.1:8766" + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=timeout))
def daemon_status():
    try: return json.load(urllib.request.urlopen("http://127.0.0.1:8766/status", timeout=2))
    except Exception: return {"offline": True}
def ensure_daemon():
    global daemon_proc
    if not daemon_status().get("offline"): return
    daemon_proc = subprocess.Popen([ARM_PY, os.path.join(ARM, "arm_daemon.py")], stdout=open(os.path.join(JOBS, "arm_daemon.log"), "a"), stderr=subprocess.STDOUT, start_new_session=True)   # survives studio restarts
    for _ in range(100):
        time.sleep(0.2)
        if not daemon_status().get("offline"): return
    raise RuntimeError("arm daemon did not start; see ui/jobs/arm_daemon.log")

def moves():
    tuned = json.load(open(os.path.join(ARM, "motions_tuned.json"))) if os.path.exists(os.path.join(ARM, "motions_tuned.json")) else {}
    out = {}
    for n in sorted(k for k in tuned if k.startswith("CHAIN")):
        t = tuned[n]; vid = os.path.join(OUT, f"tuned_{n}.mp4")
        out[n] = {"params": {"_doc": "chain: " + " > ".join(t["chain"]) + "  (beats: " + ", ".join(f"{b['move']} {b.get('connector', b.get('transition', ''))}" for b in t["beats"]) + ")", "moves": " ".join(t["chain"])},
                  "duration": round(t["t"][-1], 2), "end": [round(x) for x in t["keys"][-1]], "video": f"/video/{os.path.basename(vid)}?v={int(os.path.getmtime(vid))}" if os.path.exists(vid) else None, "chain": True}
    for n in sorted(k for k in tuned if k.startswith("KF_") and not k.endswith("@B")):   # hand-posed keyframe motions (Keyframes tab)
        t = tuned[n]; tB = tuned.get(n + "@B")
        out[n] = {"params": {"_doc": f"keyframes '{t.get('keyframes', n[3:])}' (Keyframes tab): {len(t['keys'])} keys on A" + (f", {len(tB['keys'])} on B" if tB else ", none on B")},
                  "duration": round(t["t"][-1], 2), "duration_B": round(tB["t"][-1], 2) if tB else None, "end": [round(x) for x in t["keys"][-1]], "video": None, "keyframes": True}
    for f in sorted(os.listdir(PARAMS)):
        if not f.endswith(".json"): continue
        n = f[:-5]; p = json.load(open(os.path.join(PARAMS, f))); t = tuned.get(n); vid = os.path.join(OUT, f"tuned_{n}.mp4")
        fb = os.path.join(pdir("B"), f); pB = json.load(open(fb)) if os.path.exists(fb) else None; tB = tuned.get(f"{n}@B"); vidB = os.path.join(OUT, f"tuned_{n}@B.mp4")
        out[n] = {"params": p, "params_B": pB, "duration": round(t["t"][-1], 2) if t else None, "duration_B": round(tB["t"][-1], 2) if tB else None,
                  "end": [round(x) for x in t["keys"][-1]] if t else None,
                  "video": f"/video/tuned_{n}.mp4?v={int(os.path.getmtime(vid))}" if os.path.exists(vid) else None,
                  "video_B": f"/video/tuned_{n}@B.mp4?v={int(os.path.getmtime(vidB))}" if os.path.exists(vidB) else None}
    return out

def start_job(kind, label, cmd, cwd, lock=None, env=None, jid=None, stream=False):
    jid = jid or uuid.uuid4().hex[:8]; log = os.path.join(JOBS, f"{jid}.log")
    job = {"id": jid, "kind": kind, "label": label, "status": "queued", "started": time.time(), "log": log, "result": None, "progress": []}
    with jobs_lock: jobs[jid] = job
    def run():
        with (lock or threading.Lock()):
            job["status"] = "running"
            with open(log, "w") as lf:
                lf.write("$ " + " ".join(cmd if isinstance(cmd, list) else [cmd])[:3000] + "\n\n"); lf.flush()
                p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, shell=isinstance(cmd, str), stdin=subprocess.DEVNULL, text=True)
                job["proc"] = p
                for line in p.stdout:
                    if stream: progress_from_stream(job, line, lf)
                    else: lf.write(line); lf.flush()
                p.wait(); rc = p.returncode
            job["status"] = "stopped" if job.get("stopped") else ("done" if rc == 0 else "failed"); job["ended"] = time.time(); job.pop("proc", None)
            res = log.replace(".log", ".result.md")
            if os.path.exists(res): job["result"] = open(res).read()
    threading.Thread(target=run, daemon=True).start(); return job

def progress_from_stream(job, line, lf):
    """Parse one line of `claude -p --output-format stream-json` into a short progress entry."""
    try: ev = json.loads(line)
    except Exception: lf.write(line); lf.flush(); return
    t = ev.get("type"); note = None
    if t == "assistant":
        for c in ev.get("message", {}).get("content", []):
            if c.get("type") == "text" and c.get("text", "").strip(): note = "💬 " + c["text"].strip().replace("\n", " ")[:220]
            elif c.get("type") == "tool_use":
                i = c.get("input", {}); arg = i.get("command") or i.get("file_path") or i.get("pattern") or i.get("description") or ""
                note = f"🔧 {c.get('name')}: {str(arg)[:160]}"
            if note: job["progress"].append(note); lf.write(note + "\n")
    elif t == "result":
        note = "✅ finished: " + str(ev.get("result", ""))[:300].replace("\n", " "); job["progress"].append(note); lf.write(note + "\n")
    lf.flush()

def agent_prompt(move, feedback, jid, arm="A"):
    folder = "sim/params" if arm == "A" else f"sim/params_{arm}"
    return f"""You are tuning moves of a robot-arm sword game in simulation. Work in this directory (~/game/sim).
The user was looking at move {move} on ARM {arm} and wrote: "{feedback}"
IMPORTANT: each arm has its OWN parameter folder and nothing is shared. Arm A = sim/params/, arm B = sim/params_B/.
You are working on arm {arm}: edit files under {folder} only, and regenerate with `../.venv/bin/python tune.py <MOVE> --arm {arm}`
(clips/filmstrips for arm B are named tuned_<MOVE>@B.*).

How things work:
- Every move is generated from sim/params/<MOVE>.json (read sim/params/README.md for conventions; each file has _help notes per key;
  read sim/tune.py to see how parameters become key poses). REST.json is the rest pose all moves start from. A "captured" entry
  {{"start": [...], "end": [...]}} (real-arm degrees) overrides the computed start/end pose of a move.
- Edit whichever params files the feedback calls for: usually the one move, but it may be several moves, or REST.json
  (then regenerate everything). Mirrors/feints reference another move ("mirror_of", "like"); edit the referenced file when needed.
- Regenerate with: ../.venv/bin/python tune.py <MOVE> [<MOVE> ...]   or   ../.venv/bin/python tune.py ALL   (prints key poses, peak joint
  speeds, warnings). Look at out/tuned_<MOVE>_strip.png (8-frame filmstrip: yellow arm = this arm, black = opponent at rest).
  Two-arm check: ../.venv/bin/python pair.py <OUR_MOVE> <THEIR_MOVE> (closest blade distance + out/pair_*_strip.png).
  Chains: ../.venv/bin/python chain.py pair M1 M2 M3 -- N1 N2 N3.  Helpers: ik.fk(q) -> hilt/tip/pitch; ik.solve(x, z, pitch, pan, roll).
- NEVER run anything under ~/game/arm (that is the real robot) and do not edit tune.py/chain.py/arena.py.
- Constraints: HARD RULE: shoulder_lift never below -89 deg (LIFT_MIN in tune.py; leaning further back puts the upper arm on the board). tune.py enforces it on key poses and warns on trajectories. Also: hand <= 0.27 m forward of the base, nothing below z=0, joint speeds under ~300 deg/s (somewhat over on the wrist or the
  jaw slam is fine), roll within -180..+100 in sim convention (real = sim + 76; the real wrist roll must not cross +/-180).
- Iterate up to ~8 times. When done, write a short markdown summary (which files changed, numbers before/after, what you could not
  achieve) to ~/game/ui/jobs/{jid}.result.md and finish."""

def api(handler, path, body):
    if path == "/api/moves": return moves()
    if path == "/api/jobs":
        with jobs_lock: js = sorted(jobs.values(), key=lambda j: -j["started"])
        outl = []
        for j in js:
            tail = ""
            try: tail = open(j["log"]).read()[-4000:]
            except Exception: pass
            outl.append({k: v for k, v in j.items() if k not in ("log", "proc")} | {"tail": tail})
        return outl
    if path == "/api/params":     # save this ARM's params then regenerate this arm's version
        move, params, arm = body["move"], body["params"], body.get("arm", "A")
        json.dump(params, open(os.path.join(pdir(arm), f"{move}.json"), "w"), indent=1)
        return start_job("gen", f"regenerate {move} (arm {arm})", [PY, "tune.py", move, "--arm", arm], SIM, lock=gen_lock)
    if path == "/api/gen": arm = body.get("arm", "A"); return start_job("gen", f"regenerate {body['move']} (arm {arm})", [PY, "tune.py", body["move"], "--arm", arm], SIM, lock=gen_lock)
    if path == "/api/pair": return start_job("pair", f"pair {body['a']} vs {body['b']}", [PY, "pair.py", body["a"], body["b"]], SIM, lock=gen_lock)
    if path == "/api/run":
        ensure_daemon(); arm = body.get("arm", "A")
        def go():
            j = start_job("arm", f"ARM {arm} {body['move']} x{body.get('scale', 1)}", ["true"], ARM)   # placeholder job card
            try:
                r = daemon("/play", {"arm": arm, "move": body["move"], "scale": body.get("scale", 1.0), "repeat": body.get("repeat", 1)}, timeout=120)
                open(j["log"], "a").write(json.dumps(r) + "\n"); j["status"] = "done" if "error" not in r else "failed"
            except Exception as e:
                open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/chain":
        ours = [m.strip() for m in body["ours"].replace(",", " ").split() if m.strip()]; theirs = [m.strip() for m in body.get("theirs", "").replace(",", " ").split() if m.strip()]
        cmd = [PY, "chain.py", "pair", *ours, "--", *theirs] if theirs else [PY, "chain.py", "CHAIN_A", *ours]
        return start_job("chain", f"chain {' '.join(ours)}" + (f"  vs  {' '.join(theirs)}" if theirs else ""), cmd, SIM, lock=gen_lock)
    if path == "/api/stop":
        j = jobs.get(body["id"]); p = j and j.get("proc")
        if p: j["stopped"] = True; p.terminate(); return {"ok": True}
        return {"error": "not running"}
    if path == "/api/abort": return daemon("/abort", {"arm": body.get("arm", "A")}, timeout=5)
    if path == "/api/run_both":
        ensure_daemon()
        def go():
            j = start_job("arm", f"BOTH  A:{body['moveA']}  B:{body['moveB']}  x{body.get('scale', 0.5)}", ["true"], ARM)
            try:
                r = daemon("/play_both", {"moveA": body["moveA"], "moveB": body["moveB"], "scale": body.get("scale", 0.5)}, timeout=180)
                open(j["log"], "a").write(json.dumps(r) + "\n"); j["status"] = "done" if r.get("ok") else "failed"
            except Exception as e:
                open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/connect": ensure_daemon(); return daemon("/connect", {"arm": body.get("arm", "B")}, timeout=60)
    if path == "/api/gantry":
        ensure_daemon(); return daemon("/gantry/" + body["op"], {k: v for k, v in body.items() if k != "op"}, timeout=400)
    if path == "/api/chain2":    # step-by-step chain for one arm: compile + render CHAIN_<arm>
        arm = body.get("arm", "A"); steps = body["steps"]; seed = int(body.get("seed", 0))
        return start_job("chain", f"chain {arm}: {' > '.join(steps)}", [PY, "chain.py", f"CHAIN_{arm}", *steps, "--arm", arm, "--seed", str(seed)], SIM, lock=gen_lock)
    if path == "/api/feasible":
        arm = body.get("arm", "A"); f = os.path.join(OUT, f"feasible_{arm}.json")
        if body.get("refresh") or not os.path.exists(f): subprocess.run([PY, "matrices.py", "feasible"], cwd=SIM, capture_output=True)
        return json.load(open(f))
    if path == "/api/profile":   # the turn profile (arm/turn_profile.json): GET returns it, POST with {"set": {...}} updates keys
        f = os.path.join(ARM, "turn_profile.json"); P = json.load(open(f))
        if body.get("set"):
            for k, v in body["set"].items():
                if k in P and not k.startswith("_"): P[k] = (type(P[k])(v) if not isinstance(P[k], bool) else (v in (True, "true", "on", 1, "1")))
            json.dump(P, open(f + ".tmp", "w"), indent=1); os.replace(f + ".tmp", f)
        return P
    if path == "/api/turn":
        ensure_daemon()
        def go():
            j = start_job("arm", f"TURN  A:{body.get('moveA','CHAIN_A')}  B:{body.get('moveB','CHAIN_B')}  x{body.get('scale', 0.5)}", ["true"], ARM)
            try:
                r = daemon("/turn", body, timeout=600); open(j["log"], "a").write(json.dumps(r) + "\n"); j["status"] = "done" if r.get("ok") else "failed"
            except Exception as e: open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/calibrate":
        ensure_daemon()
        def go():
            j = start_job("arm", f"CALIBRATE {body['attacker']}:{body['attack']} vs {body['defender_move']} at {body.get('speed', 0.12)}", ["true"], ARM)
            try:
                r = daemon("/calibrate", body, timeout=900); open(j["log"], "a").write(json.dumps(r) + "\n"); j["status"] = "done" if r.get("ok") else "failed"
            except Exception as e: open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/hold_pose":   # ease the arm to a move's START (strike-ready) or END pose and hold it there
        ensure_daemon(); arm, move, which = body.get("arm", "A"), body["move"], body.get("which", "end")
        T = json.load(open(os.path.join(ARM, "motions_tuned.json"))); M = T.get(f"{move}@{arm}") or T[move]
        i = (1 + (1 if move in ("ATTACK_HIGH", "FEINT_HIGH") else 0)) if which == "start" else -1
        q = M["keys"][i]
        if M.get("arm", "A") != arm:   # entry is in arm A's coordinates: re-base the roll to this arm
            c = json.load(open(os.path.join(ARM, "arms.json"))); q = list(q); q[4] = q[4] - c["A"]["roll_offset"] + c[arm]["roll_offset"]
        return daemon("/goto", {"arm": arm, "q": q, "speed": 80}, timeout=60)
    if path == "/api/calib_delete":
        f = os.path.join(SIM, "contact_stops.json"); S = json.load(open(f)); S.pop(body["key"], None); json.dump(S, open(f, "w"), indent=1); return {"ok": True}
    if path == "/api/calib_backoff":   # change a pair's back-off: recompute the stop pose(s) from the press point on the strike
        f = os.path.join(SIM, "contact_stops.json"); S = json.load(open(f)); r = S[body["key"]]; nb = float(body["backoff"])
        press = r.get("press_frac", r["stop_frac"] + r.get("backoff", 0.03)); stop = max(0.0, press - nb)
        r.update({"press_frac": round(press, 3), "backoff": nb, "stop_frac": round(stop, 3), "stop_pose_real": strike_pose(r["attacker"], r["attack"], stop)})
        if r.get("mode") == "clash": r["stop_pose_real_B"] = strike_pose("B", r["defender_move"], stop)
        json.dump(S, open(f, "w"), indent=1); return {"ok": True, "record": r}
    if path == "/api/calibrate_clash":   # both arms creep together; STOP freezes both
        ensure_daemon()
        def go():
            j = start_job("arm", f"CLASH A:{body['moveA']} vs B:{body['moveB']} at {body.get('speed', 0.12)}", ["true"], ARM)
            try:
                r = daemon("/calibrate_clash", body, timeout=900); open(j["log"], "a").write(json.dumps(r) + "\n"); j["status"] = "done" if r.get("ok") else "failed"
            except Exception as e: open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/calib_capture_clash":   # the clash keyframe as posed by hand: both arms' live poses become the stop poses
        ensure_daemon(); st = daemon_status().get("arms", {}); pa, pb = st.get("A", {}).get("pose"), st.get("B", {}).get("pose")
        if not (pa and pb): return {"error": "need live poses from both arms"}
        fa, fb = strike_frac("A", body["moveA"], pa), strike_frac("B", body["moveB"], pb); stop = round((fa + fb) / 2, 3)
        f = os.path.join(SIM, "contact_stops.json"); S = json.load(open(f)) if os.path.exists(f) else {}
        S[f"A:{body['moveA']}|B:{body['moveB']}"] = {"mode": "clash", "source": "hand-posed", "attacker": "A", "attack": body["moveA"], "defender": "B", "defender_move": body["moveB"], "stopped": True,
            "stop_frac": stop, "press_frac": stop, "backoff": 0.0, "frac_A": round(fa, 3), "frac_B": round(fb, 3), "stop_pose_real": [round(x, 1) for x in pa], "stop_pose_real_B": [round(x, 1) for x in pb], "when": time.strftime("%Y-%m-%d %H:%M")}
        json.dump(S, open(f, "w"), indent=1); return {"ok": True, "frac_A": fa, "frac_B": fb}
    if path == "/api/calib_test":      # compile the 1-beat pair with the stop applied and play both arms
        ensure_daemon(); r = json.load(open(os.path.join(SIM, "contact_stops.json")))[body["key"]]
        ours, theirs = ([r["attack"]], [r["defender_move"]]) if r["attacker"] == "A" else ([r["defender_move"]], [r["attack"]])
        subprocess.run([PY, "chain.py", "pair", *ours, "--", *theirs], cwd=SIM, capture_output=True)
        def go():
            j = start_job("arm", f"TEST PAIR {body['key']} x{body.get('scale', 0.3)}", ["true"], ARM)
            try: rr = daemon("/play_both", {"moveA": "CHAIN_A", "moveB": "CHAIN_B", "scale": body.get("scale", 0.3)}, timeout=180); open(j["log"], "a").write(json.dumps(rr) + "\n"); j["status"] = "done" if rr.get("ok") else "failed"
            except Exception as e: open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/calib_charge":    # carriages apart -> charge in -> the calibrated 1-beat pair, arms starting as the charge begins
        ensure_daemon(); r = json.load(open(os.path.join(SIM, "contact_stops.json")))[body["key"]]
        ours, theirs = ([r["attack"]], [r["defender_move"]]) if r["attacker"] == "A" else ([r["defender_move"]], [r["attack"]])
        subprocess.run([PY, "chain.py", "pair", *ours, "--", *theirs], cwd=SIM, capture_output=True)
        def go():
            j = start_job("arm", f"CHARGE + PAIR {body['key']} x{body.get('scale', 0.5)}", ["true"], ARM)
            try: rr = daemon("/turn", {"moveA": "CHAIN_A", "moveB": "CHAIN_B", "scale": body.get("scale", 0.5), "apart_after": False}, timeout=300)   # the rest comes from arm/turn_profile.json; open(j["log"], "a").write(json.dumps(rr) + "\n"); j["status"] = "done" if rr.get("ok") else "failed"
            except Exception as e: open(j["log"], "a").write(str(e) + "\n"); j["status"] = "failed"
            j["ended"] = time.time()
        threading.Thread(target=go, daemon=True).start(); return {"ok": True}
    if path == "/api/home_arms":   # both arms slowly to their own rest poses
        ensure_daemon(); return daemon("/calibrate_retreat", {}, timeout=120)
    if path == "/api/calibrate_retreat": ensure_daemon(); return daemon("/calibrate_retreat", {}, timeout=120)
    if path == "/api/calib_status":
        stops = json.load(open(os.path.join(SIM, "contact_stops.json"))) if os.path.exists(os.path.join(SIM, "contact_stops.json")) else {}
        intent = json.load(open(os.path.join(SIM, "collision_intent.json")))
        # every cell, contact expected or not: the document's guess is a hint, the metal decides. Attack-vs-attack and
        # feint pairs the document calls a miss stay hidden (nothing to calibrate there), guards are always shown.
        pairs = [{"A": k.split("|")[0], "B": k.split("|")[1], "outcome": v["outcome"], "touch": v.get("touch")} for k, v in intent.items()
                 if not k.startswith("_") and (v["outcome"] != "miss" or (("BLOCK" in k) and ("ATTACK" in k)))]
        pairs.sort(key=lambda p: (p["outcome"] == "miss", p["A"], p["B"]))
        return {"stops": stops, "pairs": pairs}
    if path == "/api/arm": return daemon_status()
    if path == "/api/hold": ensure_daemon(); return daemon("/hold", {"arm": body.get("arm", "A")}, timeout=30)
    # ---- keyframe motions (Keyframes tab): sim/keyframes/<name>.json -> KF_<name> / KF_<name>@B via sim/keyframes.py ----
    if path == "/api/kf_list":
        d = os.path.join(SIM, "keyframes"); return {"names": sorted(f[:-5] for f in os.listdir(d) if f.endswith(".json"))} if os.path.isdir(d) else {"names": []}
    if path == "/api/kf_load":
        f = os.path.join(SIM, "keyframes", body["name"] + ".json"); return json.load(open(f)) if os.path.exists(f) else {"A": [], "B": []}
    if path == "/api/kf_save":
        name = "".join(c for c in body["name"] if c.isalnum() or c in "_-")
        if not name: return {"error": "give the keyframe motion a name"}
        os.makedirs(os.path.join(SIM, "keyframes"), exist_ok=True)
        json.dump({"A": body.get("A", []), "B": body.get("B", []), "_doc": "keyframes in each arm's REAL degrees; built into KF_<name> / KF_<name>@B by sim/keyframes.py"},
                  open(os.path.join(SIM, "keyframes", name + ".json"), "w"), indent=1)
        r = subprocess.run([PY, "keyframes.py", name], cwd=SIM, capture_output=True, text=True)
        return {"ok": r.returncode == 0, "name": name, "out": r.stdout.strip(), "err": r.stderr[-400:]}
    if path == "/api/kf_goto": ensure_daemon(); return daemon("/goto", {"arm": body["arm"], "q": body["q"], "speed": body.get("speed", 60)}, timeout=60)
    if path == "/api/nudge": ensure_daemon(); return daemon("/nudge", body, timeout=60)
    if path == "/api/capture":
        ensure_daemon(); arm = body.get("arm", "A"); st = daemon_status().get("arms", {}).get(arm, {}); pose = st.get("pose")
        if not pose: return {"error": "no pose"}
        f = os.path.join(pdir(arm), f"{body['move']}.json"); p = json.load(open(f))
        if body["move"] == "REST": p["joints"] = dict(zip(["pan", "lift", "elbow", "wrist", "roll", "jaw"], pose))
        else:
            p.setdefault("captured", {})[body["which"]] = pose
            p.setdefault("_help", {})[f"captured.{body['which']}"] = f"pose captured from arm {arm} (real degrees). Delete the entry to go back to the computed pose."
        json.dump(p, open(f, "w"), indent=1)
        return start_job("gen", f"regenerate {body['move']} (arm {arm}, captured {body['which']})", [PY, "tune.py", body["move"], "--arm", arm], SIM, lock=gen_lock)
    if path == "/api/release": ensure_daemon(); return daemon("/release", {"arm": body.get("arm", "A")}, timeout=30)
    if path == "/api/feedback":
        jid = uuid.uuid4().hex[:8]; text = body["text"]
        if body.get("attach_pose"):
            st = daemon_status().get("arms", {}).get(body.get("arm", "A"), {}); pose = st.get("pose")
            if pose:
                sim = list(pose); sim[4] = round(sim[4] - 76.0, 1)
                text += (f"\n\nATTACHED ARM POSE: the user physically posed the real arm while writing this. Its joints are {pose} in real-arm degrees "
                         f"[pan, lift, elbow, wrist_flex, wrist_roll, jaw], which is {sim} in the sim convention (roll - 76). Treat this as the pose the "
                         f"feedback refers to (usually the desired END pose of the move, or the START if the text says so). The cleanest way to use it is to set "
                         f"\"captured\": {{\"end\": {pose}}} (real degrees) in the move's params file, which overrides the computed pose; then regenerate and check the filmstrip.")
        prompt = agent_prompt(body["move"], text, jid, body.get("arm", "A"))
        cmd = [CLAUDE, "-p", prompt, "--allowedTools", "Read,Edit,Write,Bash", "--max-turns", "60", "--output-format", "stream-json", "--verbose"]
        return start_job("agent", f"agent: {body['move']}: {body['text'][:60]}", cmd, SIM, jid=jid, stream=True)
    return {"error": "unknown"}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, ctype, data):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/": return self._send(200, "text/html", open(os.path.join(UI, "index.html"), "rb").read())
        if u.path.startswith("/api/"): return self._send(200, "application/json", json.dumps(api(self, u.path, {}), default=str).encode())
        if u.path.startswith("/video/") or u.path.startswith("/img/"):
            f = os.path.join(OUT, os.path.basename(u.path))
            if not os.path.exists(f): return self._send(404, "text/plain", b"no file")
            data = open(f, "rb").read(); ctype = "video/mp4" if f.endswith(".mp4") else "image/png"
            rng = self.headers.get("Range")
            if rng:   # byte ranges so the video can seek
                m = re.match(r"bytes=(\d+)-(\d*)", rng); s = int(m.group(1)); e = int(m.group(2) or len(data) - 1)
                self.send_response(206); self.send_header("Content-Type", ctype); self.send_header("Content-Range", f"bytes {s}-{e}/{len(data)}")
                self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(e - s + 1)); self.end_headers(); self.wfile.write(data[s:e + 1]); return
            self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        self._send(404, "text/plain", b"not found")
    def do_POST(self):
        u = urlparse(self.path); n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        self._send(200, "application/json", json.dumps(api(self, u.path, body), default=str).encode())

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"joust studio on http://localhost:{port}  (claude cli: {CLAUDE})"); ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
