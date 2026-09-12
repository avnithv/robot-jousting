"""Joust move studio: a small local web UI to tweak parameters, simulate, run on the arm, and send feedback to
tuning agents.   Start:  cd ~/game && .venv/bin/python ui/server.py   ->  http://localhost:8765"""
import json, os, sys, time, threading, subprocess, uuid, shutil, re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM, ARM, UI = os.path.join(ROOT, "sim"), os.path.join(ROOT, "arm"), os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(ROOT, ".venv", "bin", "python"); OUT = os.path.join(SIM, "out"); PARAMS = os.path.join(SIM, "params"); JOBS = os.path.join(UI, "jobs")
CLAUDE = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
jobs = {}; jobs_lock = threading.Lock(); arm_lock = threading.Lock(); gen_lock = threading.Lock()

import urllib.request
ARM_PY = os.path.expanduser("~/so-arm/.venv/bin/python"); daemon_proc = None
def daemon(path, body, timeout=10):
    req = urllib.request.Request("http://127.0.0.1:8766" + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=timeout))
def daemon_status():
    try: return json.load(urllib.request.urlopen("http://127.0.0.1:8766/status", timeout=2))
    except Exception: return {"offline": True}
def ensure_daemon():
    global daemon_proc
    if not daemon_status().get("offline"): return
    daemon_proc = subprocess.Popen([ARM_PY, os.path.join(ARM, "arm_daemon.py")], stdout=open(os.path.join(JOBS, "arm_daemon.log"), "a"), stderr=subprocess.STDOUT)
    for _ in range(100):
        time.sleep(0.2)
        if not daemon_status().get("offline"): return
    raise RuntimeError("arm daemon did not start; see ui/jobs/arm_daemon.log")

def moves():
    tuned = json.load(open(os.path.join(ARM, "motions_tuned.json"))) if os.path.exists(os.path.join(ARM, "motions_tuned.json")) else {}
    out = {}
    for n in sorted(k for k in tuned if k.startswith("CHAIN")):
        t = tuned[n]; vid = os.path.join(OUT, f"tuned_{n}.mp4" if n == "CHAIN_A" and not os.path.exists(os.path.join(OUT, "pair_CHAIN_A_vs_CHAIN_B.mp4")) else "pair_CHAIN_A_vs_CHAIN_B.mp4")
        out[n] = {"params": {"_doc": "chain: " + " > ".join(t["chain"]) + "  (beats: " + ", ".join(f"{b['move']} {b['transition']}" for b in t["beats"]) + ")", "moves": " ".join(t["chain"])},
                  "duration": round(t["t"][-1], 2), "end": [round(x) for x in t["keys"][-1]], "video": f"/video/{os.path.basename(vid)}?v={int(os.path.getmtime(vid))}" if os.path.exists(vid) else None, "chain": True}
    for f in sorted(os.listdir(PARAMS)):
        if not f.endswith(".json"): continue
        n = f[:-5]; p = json.load(open(os.path.join(PARAMS, f))); t = tuned.get(n); vid = os.path.join(OUT, f"tuned_{n}.mp4")
        out[n] = {"params": p, "duration": round(t["t"][-1], 2) if t else None, "end": [round(x) for x in t["keys"][-1]] if t else None,
                  "video": f"/video/tuned_{n}.mp4?v={int(os.path.getmtime(vid))}" if os.path.exists(vid) else None}
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

def agent_prompt(move, feedback, jid):
    return f"""You are tuning moves of a robot-arm sword game in simulation. Work in this directory (~/game/sim).
The user was looking at move {move} and wrote: "{feedback}"

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
- Constraints: HARD RULE: the wrist pitch joint anchor never goes below z = 0.120 m and the wrist roll joint anchor never below 0.092 m in the sim, or the arm hits the board (tune.py enforces it on key poses and warns on trajectories; check `wrist_z(q)` in tune.py). Also: hand <= 0.27 m forward of the base, nothing below z=0, joint speeds under ~300 deg/s (somewhat over on the wrist or the
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
    if path == "/api/params":     # save params then regenerate
        move, params = body["move"], body["params"]
        json.dump(params, open(os.path.join(PARAMS, f"{move}.json"), "w"), indent=1)
        return start_job("gen", f"regenerate {move}", [PY, "tune.py", move], SIM, lock=gen_lock)
    if path == "/api/gen": return start_job("gen", f"regenerate {body['move']}", [PY, "tune.py", body["move"]], SIM, lock=gen_lock)
    if path == "/api/pair": return start_job("pair", f"pair {body['a']} vs {body['b']}", [PY, "pair.py", body["a"], body["b"]], SIM, lock=gen_lock)
    if path == "/api/run":
        ensure_daemon()
        def go():
            j = start_job("arm", f"ARM {body['move']} x{body.get('scale', 1)}", ["true"], ARM)   # placeholder job card
            try:
                r = daemon("/play", {"move": body["move"], "scale": body.get("scale", 1.0), "repeat": body.get("repeat", 1)}, timeout=120)
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
    if path == "/api/arm": return daemon_status()
    if path == "/api/hold": ensure_daemon(); return daemon("/hold", {}, timeout=30)
    if path == "/api/capture":
        ensure_daemon(); st = daemon_status(); pose = st.get("pose")
        if not pose: return {"error": "no pose"}
        f = os.path.join(PARAMS, f"{body['move']}.json"); p = json.load(open(f))
        p.setdefault("captured", {})[body["which"]] = pose
        p.setdefault("_help", {})[f"captured.{body['which']}"] = "pose captured from the arm (real degrees). Delete the entry to go back to the computed pose."
        json.dump(p, open(f, "w"), indent=1)
        return start_job("gen", f"regenerate {body['move']} (captured {body['which']})", [PY, "tune.py", body["move"]], SIM, lock=gen_lock)
    if path == "/api/release": ensure_daemon(); return daemon("/release", {}, timeout=30)
    if path == "/api/feedback":
        jid = uuid.uuid4().hex[:8]; text = body["text"]
        if body.get("attach_pose"):
            st = daemon_status(); pose = st.get("pose")
            if pose:
                sim = list(pose); sim[4] = round(sim[4] - 76.0, 1)
                text += (f"\n\nATTACHED ARM POSE: the user physically posed the real arm while writing this. Its joints are {pose} in real-arm degrees "
                         f"[pan, lift, elbow, wrist_flex, wrist_roll, jaw], which is {sim} in the sim convention (roll - 76). Treat this as the pose the "
                         f"feedback refers to (usually the desired END pose of the move, or the START if the text says so). The cleanest way to use it is to set "
                         f"\"captured\": {{\"end\": {pose}}} (real degrees) in the move's params file, which overrides the computed pose; then regenerate and check the filmstrip.")
        prompt = agent_prompt(body["move"], text, jid)
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
