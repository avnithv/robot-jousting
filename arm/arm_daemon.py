"""Persistent two-arm server: connects to every arm it can find, holds poses with torque on, plays tuned moves on request.
    ~/so-arm/.venv/bin/python ~/game/arm/arm_daemon.py         ->  http://127.0.0.1:8766
  GET  /status                                   both arms: busy, torque, pose, last message
  POST /play    {"arm":"A","move":NAME,"scale":1.0,"repeat":1}
  POST /rest    {"arm":"A"}      POST /hold {"arm":"A"}      POST /release {"arm":"A"}   (torque off: move by hand)
  POST /nudge   {"arm":"A","joint":"wrist_flex","deg":15,"oneway":false}
  POST /goto    {"arm":"A","q":[...6 real degrees...],"speed":60}    ease to a pose and hold
Arm A = SO-100 (moves were tuned on it). Arm B = SO-101; its trajectories are re-based to its own roll offset (arms.json)."""
import json, os, sys, time, threading
import numpy as np
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, read_pose, JOINTS, ARMS
HERE = os.path.dirname(os.path.abspath(__file__)); RATE = 50.0; EASE_SPEED = 150.0
HOLD_END = 1.5; RETURN_SPEED = 60.0   # hold the final pose, then return to rest slowly (the return is not part of the move)
CFG = os.path.join(HERE, "arms.json"); TUNED = os.path.join(HERE, "motions_tuned.json")

class Arm:
    def __init__(self, name):
        self.name = name; self.io = threading.Lock(); self.busy = threading.Lock(); self.last = ""; self.torque = True; self.abort = False
        self.robot = None
        for attempt in range(3):
            try: self.robot = connect(arm=name, hold_on_disconnect=True); break
            except Exception as e: self.last = f"connect failed: {str(e)[:80]}"; time.sleep(1)
        if self.robot: self.send(np.array(self.pose())); print(f"arm {name} connected, holding current pose", flush=True)
        else: print(f"arm {name} NOT connected: {self.last}", flush=True)
    def cfg(self): return json.load(open(CFG))[self.name]
    def pose(self):
        with self.io: return read_pose(self.robot)
    def send(self, q):
        with self.io: self.robot.send_action({f"{j}.pos": float(q[k]) for k, j in enumerate(JOINTS)})
    def set_torque(self, on):
        with self.io: (self.robot.bus.enable_torque() if on else self.robot.bus.disable_torque())
        self.torque = on
    def ease_to(self, target, max_speed=EASE_SPEED, min_t=0.15):
        if not self.torque: self.set_torque(True)
        cur = np.array(self.pose()); tgt = np.array(target, float); T = max(float(np.max(np.abs(tgt[:5] - cur[:5])) / max_speed), min_t); n = max(int(T * RATE), 1)
        for i in range(1, n + 1):
            if self.abort: return
            a = 0.5 - 0.5 * np.cos(np.pi * i / n); self.send(cur + a * (tgt - cur)); time.sleep(1 / RATE)
    def rest_pose(self):
        r = self.cfg().get("rest")
        return np.array(r if r else json.load(open(TUNED))["REST"]["q"][0], float)
    def rebase(self, Q):
        """Tuned trajectories are in arm A's real coordinates. For another arm, move the roll to that arm's offset."""
        c = self.cfg(); Q = np.array(Q, float)
        if self.name != "A":
            if c.get("roll_offset") is None: raise RuntimeError(f"arm {self.name}: roll_offset not set in arms.json (find the sword-on-top roll first)")
            Q[:, 4] = np.clip(Q[:, 4] - ARMS["A"]["roll_offset"] + c["roll_offset"], -175, 175)   # never touch the +/-180 wrap
        return Q
    def prepare(self, move):
        T = json.load(open(TUNED)); M = T.get(f"{move}@{self.name}") or T[move]; t = np.array(M["t"]); Q = self.rebase(M["q"]); rest = self.rest_pose()
        self.abort = False; self.ease_to(rest); self.ease_to(Q[0]); time.sleep(0.1)
        return t, Q, rest
    def play(self, move, scale, repeat, barrier=None):
        t, Q, rest = self.prepare(move)
        if barrier is not None: barrier.wait(timeout=30)   # start together with the other arm
        for i in range(repeat):
            if self.abort: break
            if i: self.ease_to(Q[0]); time.sleep(0.1)
            T = t[-1] / scale; t0 = time.perf_counter()
            while not self.abort:
                now = time.perf_counter() - t0
                if now > T: self.send(Q[-1]); break
                self.send(np.array([np.interp(now * scale, t, Q[:, k]) for k in range(6)])); time.sleep(1 / RATE)
            time.sleep(HOLD_END)
        if self.abort:
            self.send(np.array(self.pose())); self.last = f"{move} ABORTED, holding where it stopped"; self.abort = False; return
        self.ease_to(rest, max_speed=RETURN_SPEED)
        self.last = f"{move} x{scale} done, end err {np.abs(np.array(self.pose())[:5] - rest[:5]).max():.1f} deg"

arms = {n: Arm(n) for n in ARMS}
arms = {n: a for n, a in arms.items() if a.robot}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        out = {}
        for n, a in arms.items():
            try: out[n] = {"busy": a.busy.locked(), "last": a.last, "torque": a.torque, "pose": [round(x, 1) for x in a.pose()], "model": ARMS[n]["model"]}
            except Exception as e: out[n] = {"error": str(e)[:100]}
        self._json({"arms": out})
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}"); name = body.get("arm", "A")
        a = arms.get(name) if name != "both" else next(iter(arms.values()), None)
        if a is None: return self._json({"error": f"arm {name} not connected"}, 404)
        if self.path == "/abort":   # handled outside the busy lock: stops whatever is running on that arm (or both)
            for x in (arms.values() if name == "both" else [a]): x.abort = True
            return self._json({"ok": True})
        if self.path == "/play_both":   # two arms, two moves, synchronized start
            A, B = arms.get("A"), arms.get("B")
            if not (A and B): return self._json({"error": "both arms must be connected"}, 404)
            if not (A.busy.acquire(blocking=False)): return self._json({"error": "A busy"}, 409)
            if not (B.busy.acquire(blocking=False)): A.busy.release(); return self._json({"error": "B busy"}, 409)
            try:
                bar = threading.Barrier(2); scale = float(body.get("scale", 0.5)); errs = {}
                def run(arm, move):
                    try: arm.play(move, scale, 1, barrier=bar)
                    except Exception as e: arm.last = f"error: {e}"; errs[arm.name] = str(e)
                ta = threading.Thread(target=run, args=(A, body["moveA"])); tb = threading.Thread(target=run, args=(B, body["moveB"])); ta.start(); tb.start(); ta.join(); tb.join()
                self._json({"ok": not errs, "A": A.last, "B": B.last, "errors": errs})
            finally: A.busy.release(); B.busy.release()
            return
        if not a.busy.acquire(blocking=False): return self._json({"error": "busy"}, 409)
        try:
            if self.path == "/play": a.play(body["move"], float(body.get("scale", 1.0)), int(body.get("repeat", 1)))
            elif self.path == "/rest": a.ease_to(a.rest_pose()); a.last = "at rest"
            elif self.path == "/hold": a.ease_to(np.array(a.pose()), min_t=0.05); a.last = "holding current pose"
            elif self.path == "/release": a.set_torque(False); a.last = "torque off: move the arm by hand"
            elif self.path == "/goto": a.ease_to(np.array(body["q"], float), max_speed=float(body.get("speed", 60))); a.last = "holding requested pose"
            elif self.path == "/nudge":
                j = JOINTS.index(body["joint"]); deg = float(body.get("deg", 15)); q0 = np.array(a.pose()); a.ease_to(q0, min_t=0.05); time.sleep(0.3)
                for target in ((deg, 0.0) if body.get("oneway") else (deg, -deg, 0.0)):
                    q1 = q0.copy(); q1[j] += target; a.ease_to(q1, max_speed=40.0); time.sleep(0.4)
                a.last = f"nudged {body['joint']} by {deg} deg"
            self._json({"ok": True, "last": a.last})
        except Exception as e:
            a.last = f"error: {e}"; self._json({"error": str(e)}, 500)
        finally: a.busy.release()

if __name__ == "__main__":
    try: ThreadingHTTPServer(("127.0.0.1", 8766), H).serve_forever()
    finally:
        for a in arms.values(): a.robot.disconnect()
