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
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gantry"))
import serial
from grbl_manual import XYController
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
        if move == "REST": Q = np.tile(rest, (len(t), 1))   # REST always means THIS arm's own rest pose
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

class Gantry:
    """GRBL two-axis gantry: X carries arm A, Y carries arm B. Referenced once per session (home), then absolute mm moves."""
    def __init__(self):
        self.cfg = json.load(open(CFG))["gantry"]; self.lock = threading.RLock(); self.cnc = None; self.last = ""; self.homed = False
    def connect(self):
        if self.cnc: return
        conn = serial.Serial(self.cfg["port"], 115200, timeout=0.2, write_timeout=2); time.sleep(2); conn.reset_input_buffer()
        self.cnc = XYController(conn); self.cnc.preflight(); self.last = "connected (not referenced)"
    def home(self):
        self.connect(); state, pins, _ = self.cnc.status()
        if state == "Alarm":                     # clear a previous hard-limit alarm before referencing again
            self.cnc.reset(); self.cnc.send("$X"); state, pins, _ = self.cnc.status()
        if pins in (1, 2): self.cnc.release_axis("X" if pins == 1 else "Y")   # a carriage parked on its switch
        self.cnc.home(); self.homed = True; self.last = "referenced: X=0 Y=0"
    def status(self):
        if not self.cnc: return {"connected": False, "homed": False}
        if not self.lock.acquire(blocking=False): return {"connected": True, "homed": self.homed, "busy": True, "last": self.last or "moving / referencing"}
        try:
            state, pins, coords = self.cnc.status()
            return {"connected": True, "homed": self.homed, "state": state, "pins": pins, "x": coords[0], "y": coords[1], "last": self.last}
        except Exception as e: return {"connected": True, "homed": self.homed, "error": str(e)[:100], "last": self.last}
        finally: self.lock.release()
    def move(self, x=None, y=None, feed=None):
        if not self.homed: raise RuntimeError("gantry not referenced: home it first")
        axes = {}
        if x is not None: axes["X"] = float(x)
        if y is not None: axes["Y"] = float(y)
        with self.lock:
            cur = self.cnc.ready(); dx = abs(axes.get("X", cur[0]) - cur[0]); dy = abs(axes.get("Y", cur[1]) - cur[1])
            f = float(feed or self.cfg["charge_feed"])
            if dx > 0 and dy > 0: f = f * (dx * dx + dy * dy) ** 0.5 / max(dx, dy)   # path feed so the faster axis runs at `feed`
            self.cnc.move(axes, min(f, self.cnc.max_feed))
        self.last = f"at X={axes.get('X', cur[0]):.0f} Y={axes.get('Y', cur[1]):.0f}"
    def abort(self):
        if self.cnc:
            try: self.cnc.reset()
            except Exception: pass
        self.homed = False; self.last = "ABORTED (reset; re-home before moving)"

gantry = Gantry()
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
        self._json({"arms": out, "gantry": gantry.status()})
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}"); name = body.get("arm", "A")
        if self.path == "/connect":   # (re)connect one arm without restarting the daemon
            a = Arm(name)
            if a.robot: arms[name] = a; return self._json({"ok": True, "last": "connected"})
            return self._json({"error": a.last}, 500)
        if self.path.startswith("/gantry/"):
            try:
                op = self.path.split("/")[-1]
                if op == "abort": gantry.abort(); return self._json({"ok": True, "last": gantry.last})
                if op == "unlock": gantry.lock = threading.RLock(); gantry.last = "lock cleared"; return self._json({"ok": True, "last": gantry.last})
                if not gantry.lock.acquire(blocking=False): return self._json({"error": "gantry busy"}, 409)
                try:
                    if op == "home": gantry.home()
                    elif op == "move": gantry.move(body.get("x"), body.get("y"), body.get("feed"))
                    elif op == "together": gantry.move(gantry.cfg["together"]["X"], gantry.cfg["together"]["Y"], body.get("feed"))
                    elif op == "apart": gantry.move(gantry.cfg["apart"]["X"], gantry.cfg["apart"]["Y"], body.get("feed"))
                    else: return self._json({"error": "unknown gantry op"}, 404)
                finally: gantry.lock.release()
                return self._json({"ok": True, "last": gantry.last})
            except Exception as e:
                gantry.last = f"error: {e}"; return self._json({"error": str(e)}, 500)
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
