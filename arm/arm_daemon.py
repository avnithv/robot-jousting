"""Persistent arm server: connects once, holds REST with torque on, plays tuned moves on request with no reconnect delay.
    ~/so-arm/.venv/bin/python ~/game/arm/arm_daemon.py         ->  http://127.0.0.1:8766
  POST /play {"move": NAME, "scale": 1.0, "repeat": 1}     GET /status     POST /rest     POST /release (torque off)"""
import json, os, sys, time, threading
import numpy as np
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, read_pose, JOINTS
HERE = os.path.dirname(os.path.abspath(__file__)); RATE = 50.0; EASE_SPEED = 150.0   # deg/s for the ease in/out
state = {"busy": False, "last": "", "torque": True}; lock = threading.Lock()
robot = connect(); print("arm connected", flush=True)
rest = np.array(json.load(open(os.path.join(HERE, "motions_tuned.json")))["REST"]["q"][0])

def send(q): robot.send_action({f"{j}.pos": float(q[k]) for k, j in enumerate(JOINTS)})
def ease_to(target, max_speed=EASE_SPEED, min_t=0.15):
    cur = np.array(read_pose(robot)); tgt = np.array(target, float)
    T = max(float(np.max(np.abs(tgt[:5] - cur[:5])) / max_speed), min_t); n = max(int(T * RATE), 1)
    for i in range(1, n + 1):
        a = 0.5 - 0.5 * np.cos(np.pi * i / n); send(cur + a * (tgt - cur)); time.sleep(1 / RATE)
def play(t, Q, scale):
    T = t[-1] / scale; t0 = time.perf_counter()
    while True:
        now = time.perf_counter() - t0
        if now > T: send(Q[-1]); break
        send(np.array([np.interp(now * scale, t, Q[:, k]) for k in range(6)])); time.sleep(1 / RATE)
def do_play(move, scale, repeat):
    global rest
    T = json.load(open(os.path.join(HERE, "motions_tuned.json"))); rest = np.array(T["REST"]["q"][0]); M = T[move]; t = np.array(M["t"]); Q = np.array(M["q"])
    if not state["torque"]: robot.bus.enable_torque(); state["torque"] = True
    ease_to(rest); ease_to(Q[0]); time.sleep(0.1)
    for i in range(repeat):
        if i: ease_to(Q[0]); time.sleep(0.1)
        play(t, Q, scale); time.sleep(0.4)
    ease_to(rest); state["last"] = f"{move} x{scale} done, end err {np.abs(np.array(read_pose(robot))[:5] - rest[:5]).max():.1f} deg"
ease_to(rest); print("holding REST", flush=True)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        self._json({"busy": state["busy"], "last": state["last"], "torque": state["torque"], "pose": [round(x, 1) for x in read_pose(robot)]})
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        if not lock.acquire(blocking=False): return self._json({"error": "busy"}, 409)
        try:
            state["busy"] = True
            if self.path == "/play": do_play(body["move"], float(body.get("scale", 1.0)), int(body.get("repeat", 1)))
            elif self.path == "/rest":
                if not state["torque"]: robot.bus.enable_torque(); state["torque"] = True
                ease_to(rest)
            elif self.path == "/release": ease_to(rest); robot.bus.disable_torque(); state["torque"] = False; state["last"] = "torque off (arm limp at REST)"
            self._json({"ok": True, "last": state["last"]})
        except Exception as e:
            state["last"] = f"error: {e}"; self._json({"error": str(e)}, 500)
        finally:
            state["busy"] = False; lock.release()

if __name__ == "__main__":
    try: ThreadingHTTPServer(("127.0.0.1", 8766), H).serve_forever()
    finally: robot.disconnect()
