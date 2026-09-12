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
    for f in sorted(os.listdir(PARAMS)):
        if not f.endswith(".json"): continue
        n = f[:-5]; p = json.load(open(os.path.join(PARAMS, f))); t = tuned.get(n); vid = os.path.join(OUT, f"tuned_{n}.mp4")
        out[n] = {"params": p, "duration": round(t["t"][-1], 2) if t else None, "end": [round(x) for x in t["keys"][-1]] if t else None,
                  "video": f"/video/tuned_{n}.mp4?v={int(os.path.getmtime(vid))}" if os.path.exists(vid) else None}
    return out

def start_job(kind, label, cmd, cwd, lock=None, env=None, jid=None):
    jid = jid or uuid.uuid4().hex[:8]; log = os.path.join(JOBS, f"{jid}.log")
    job = {"id": jid, "kind": kind, "label": label, "status": "queued", "started": time.time(), "log": log, "result": None}
    with jobs_lock: jobs[jid] = job
    def run():
        with (lock or threading.Lock()):
            job["status"] = "running"
            with open(log, "w") as lf:
                lf.write("$ " + " ".join(cmd if isinstance(cmd, list) else [cmd]) + "\n"); lf.flush()
                r = subprocess.run(cmd, cwd=cwd, stdout=lf, stderr=subprocess.STDOUT, env=env, shell=isinstance(cmd, str))
            job["status"] = "done" if r.returncode == 0 else "failed"; job["ended"] = time.time()
            res = log.replace(".log", ".result.md")
            if os.path.exists(res): job["result"] = open(res).read()
    threading.Thread(target=run, daemon=True).start(); return job

def agent_prompt(move, feedback, jid):
    return f"""You are tuning ONE move of a robot-arm sword game in simulation. Work only in this directory (~/game/sim).
Move: {move}. The user's feedback on the current version: "{feedback}"

Rules:
- Edit ONLY sim/params/{move}.json (read sim/params/README.md for conventions; read sim/tune.py to see how the parameters become key poses).
  If the move is a mirror or a feint that references another move, you may edit that referenced move's file instead, but say so.
- Regenerate with: ../.venv/bin/python tune.py {move}   (prints key poses, peak joint speeds, warnings). Look at the result:
  out/tuned_{move}_strip.png is an 8-frame filmstrip of the sim render (arm A, yellow, is this arm; the black arm is the opponent at rest).
  For blocks you can also run: ../.venv/bin/python pair.py {move} <OPPONENT_ATTACK> which reports the closest blade distance and writes out/pair_*_strip.png.
  Useful helpers: ik.fk(q) gives hilt/tip/pitch for joint angles; ik.solve(x, z, pitch, pan, roll) solves hand placement.
- NEVER run anything under ~/game/arm (that is the real robot). Do not touch other moves' files or tune.py.
- Constraints: hand <= 0.27 m forward of the base, nothing below z=0, joint speeds under ~300 deg/s (a bit over on the wrist or jaw slam is acceptable), roll stays within -180..+100 (sim convention).
- Iterate at most ~6 times. When done, write a short markdown summary (what you changed, the numbers before/after, and anything you could not achieve) to ~/game/ui/jobs/{jid}.result.md and finish."""

def api(handler, path, body):
    if path == "/api/moves": return moves()
    if path == "/api/jobs":
        with jobs_lock: js = sorted(jobs.values(), key=lambda j: -j["started"])
        outl = []
        for j in js:
            tail = ""
            try: tail = open(j["log"]).read()[-4000:]
            except Exception: pass
            outl.append({k: v for k, v in j.items() if k != "log"} | {"tail": tail})
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
    if path == "/api/arm": return daemon_status()
    if path == "/api/release": ensure_daemon(); return daemon("/release", {}, timeout=30)
    if path == "/api/feedback":
        jid = uuid.uuid4().hex[:8]; prompt = agent_prompt(body["move"], body["text"], jid)
        cmd = [CLAUDE, "-p", prompt, "--allowedTools", "Read,Edit,Write,Bash", "--max-turns", "60"]
        return start_job("agent", f"agent: {body['move']}: {body['text'][:60]}", cmd, SIM, jid=jid)
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
