"""Persistent two-arm server: connects to every arm it can find, holds poses with torque on, plays tuned moves on request.
    ~/so-arm/.venv/bin/python ~/game/arm/arm_daemon.py         ->  http://127.0.0.1:8766
  GET  /status                                   both arms: busy, torque, pose, last message
  POST /play    {"arm":"A","move":NAME,"scale":1.0,"repeat":1}
  POST /rest    {"arm":"A"}      POST /hold {"arm":"A"}      POST /release {"arm":"A"}   (torque off: move by hand)
  POST /nudge   {"arm":"A","joint":"wrist_flex","deg":15,"oneway":false}
  POST /goto    {"arm":"A","q":[...6 real degrees...],"speed":60}    ease to a pose and hold
A motion that carries `gantry_axis` + `gantry_mm` (the emote scenes do) also streams its carriage track on the
GRBL gantry while it plays -- see GantryStream. Every other motion behaves exactly as it always has.
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
STREAM_DT = 0.25      # gantry channel: one merged G1 per this many seconds of the trajectory (see GantryStream)
STREAM_DEADBAND_MM = 0.2   # below this the carriage is not really moving: skip the block rather than creep

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
        T = json.load(open(TUNED)); key = "REST" if self.name == "A" else f"REST@{self.name}"
        if key in T: return np.array(T[key]["q"][0], float)          # this arm's own REST (from its own params folder)
        r = self.cfg().get("rest"); return np.array(r if r else T["REST"]["q"][0], float)
    def rebase(self, Q):
        """Tuned trajectories are in arm A's real coordinates. For another arm, move the roll to that arm's offset."""
        c = self.cfg(); Q = np.array(Q, float)
        if getattr(self, "_entry_arm", None) == self.name: return Q      # generated for this arm already (its own coordinates)
        if self.name != "A":
            if c.get("roll_offset") is None: raise RuntimeError(f"arm {self.name}: roll_offset not set in arms.json (find the sword-on-top roll first)")
            Q[:, 4] = np.clip(Q[:, 4] - ARMS["A"]["roll_offset"] + c["roll_offset"], -175, 175)   # never touch the +/-180 wrap
        return Q
    def prepare(self, move):
        T = json.load(open(TUNED)); M = T.get(f"{move}@{self.name}") or T[move]; t = np.array(M["t"]); self._entry_arm = M.get("arm", "A"); Q = self.rebase(M["q"]); rest = self.rest_pose()
        self._gantry = (M.get("gantry_axis"), M.get("gantry_mm"))   # ADDITIVE: an emote's carriage channel, or (None, None)
        if move == "REST": Q = np.tile(rest, (len(t), 1))   # REST always means THIS arm's own rest pose
        self.abort = False; self.ease_to(rest); self.ease_to(Q[0]); time.sleep(0.1)
        return t, Q, rest
    def play(self, move, scale, repeat, barrier=None):
        t, Q, rest = self.prepare(move)
        # ADDITIVE: if this motion carries a gantry channel (the emote scenes do), park the carriage where the
        # scene starts while the arm is still easing in, then stream the channel alongside the arm samples.
        gax, gmm = getattr(self, "_gantry", (None, None)); streaming = gstream.usable(gax, gmm)
        if streaming: gstream.preposition(gax, gmm[0])
        if barrier is not None: barrier.wait(timeout=30)   # start together with the other arm
        for i in range(repeat):
            if self.abort: break
            if i: self.ease_to(Q[0]); time.sleep(0.1)
            T = t[-1] / scale; t0 = time.perf_counter()
            if streaming: gstream.add(gax, t, gmm, t0, scale)     # ADDITIVE: carriage follows the same clock
            try:
                while not self.abort:
                    now = time.perf_counter() - t0
                    if now > T: self.send(Q[-1]); break
                    self.send(np.array([np.interp(now * scale, t, Q[:, k]) for k in range(6)])); time.sleep(1 / RATE)
            finally:
                if streaming: gstream.remove(gax)                 # ADDITIVE: never stream through the hold/return
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
    def reconnect(self):
        """Close and reopen the serial port (resets GRBL, clears a jammed alarm state); reference is lost until home()."""
        try:
            if self.cnc: self.cnc.port.close()
        except Exception: pass
        self.cnc = None; self.homed = False; self.connect(); self.last = "reconnected (not referenced)"
    def home(self):
        self.connect()
        try: state, pins, _ = self.cnc.status()
        except Exception: self.reconnect(); state, pins, _ = self.cnc.status()   # jammed after an alarm: fresh connection
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

class GantryStream:
    """ADDITIVE: the carriage channel an emote scene carries, streamed in time with the arm samples.

    motions_tuned.json stores the emote scenes (EN_GARDE_OPENER / SAMURAI_FINISH and their @B and _SWAP
    variants) with two extra fields next to `t` and `q`: `gantry_axis` ("X" for the arm-A part, "Y" for the
    arm-B part) and `gantry_mm`, one carriage position per trajectory sample. Playing only the joints throws
    half of the choreography away -- the opener IS the two carriages charging in from the apart stop while the
    arms fold to keep the tips on target. So while such a motion runs, this streams its carriage track.

    Deliberately conservative, because this is the one part of the daemon that has never met the hardware:
      * it does nothing unless the motion really carries a channel AND the gantry is connected AND referenced,
        so every existing /play, /play_both and /turn behaves exactly as it did before;
      * it never calls Gantry.move() / XYController.move(): those demand an Idle machine and dwell until the
        segment has finished, which would stall the 50 Hz arm loop. It queues plain G1 blocks into GRBL's
        planner instead (send() returns on the "ok", i.e. once the block is accepted), which is ordinary
        G-code streaming and lets the planner blend consecutive segments into one smooth ride;
      * ONE merged move per STREAM_DT covering every registered axis, so a two-arm scene moves both carriages
        together instead of X and Y taking turns in the planner queue;
      * feed is the segment's distance / STREAM_DT, capped at the configured charge_feed and at the
        controller's own max, and every target is clamped into [0, apart] -- the stream can never drive a
        carriage past the stop /gantry/apart parks it at, nor past the reference end;
      * it holds gantry.lock for the whole scene, so a /gantry/* request arriving mid-emote gets the usual
        409 "gantry busy" instead of two senders sharing one serial port;
      * any serial error ends the stream and lands in gantry.last. The arms keep dancing regardless.
    """
    def __init__(self, g):
        self.g = g; self.lock = threading.Lock(); self.channels = {}; self.thread = None; self.stop = False
    def limit(self):
        ap = self.g.cfg["apart"]; return float(max(ap["X"], ap["Y"]))
    def clamp(self, v): return max(0.0, min(self.limit(), float(v)))
    def usable(self, axis, mm):
        """True only when there is really something to stream and something referenced to stream it to."""
        return bool(axis in ("X", "Y") and mm is not None and len(mm) and self.g.cnc and self.g.homed)
    def preposition(self, axis, mm):
        """Park the carriage where the scene starts, while the arm is still easing in: the first streamed
        segment is then a small step instead of a 130 mm catch-up jump at full feed."""
        try:
            with self.g.lock: self.g.move(**{axis.lower(): self.clamp(mm)})
        except Exception as e: self.g.last = f"gantry preposition failed: {str(e)[:80]}"
    def add(self, axis, t, mm, t0, scale):
        with self.lock:
            self.channels[axis] = (np.array(t, float), np.array(mm, float), t0, float(scale))
            if self.thread is None or not self.thread.is_alive():
                self.stop = False; self.thread = threading.Thread(target=self._run, daemon=True); self.thread.start()
    def remove(self, axis):
        with self.lock: self.channels.pop(axis, None); done = not self.channels
        if done: self.stop = True
    def _run(self):
        if not self.g.lock.acquire(timeout=2.0):
            self.g.last = "gantry busy: emote carriage channel skipped"; self.stop = True; return
        cnc = self.g.cnc; feed_cap = float(self.g.cfg["charge_feed"]); last = {}
        try:
            cnc.motion_may_be_active = True; self.g.last = "streaming the scene's carriage channel"
            while not self.stop:
                time.sleep(STREAM_DT)
                with self.lock: chans = dict(self.channels)
                if not chans: break
                now = time.perf_counter(); moved = {}
                for axis, (t, mm, t0, scale) in chans.items():
                    target = self.clamp(np.interp((now - t0) * scale, t, mm))
                    prev = last.get(axis, self.clamp(mm[0]))     # prepositioned there, so this is where we are
                    if abs(target - prev) >= STREAM_DEADBAND_MM: moved[axis] = (prev, target)
                if not moved: continue
                dist = max(abs(b - a) for a, b in moved.values())
                feed = max(1.0, min(feed_cap, cnc.max_feed, dist / STREAM_DT * 60.0))
                words = " ".join(f"{ax}{v[1]:.3f}" for ax, v in sorted(moved.items()))
                cnc.send(f"G21 G90 G94 G54 G1 {words} F{feed:.3f}")
                for ax, v in moved.items(): last[ax] = v[1]
        except Exception as e:
            self.g.last = f"gantry stream stopped: {str(e)[:90]}"
        finally:
            try: cnc.send("G4 P0.01", timeout=60)    # let the queued blocks run out before anyone else moves
            except Exception: pass
            cnc.motion_may_be_active = False
            with self.lock: self.channels.clear()
            self.stop = True
            if last: self.g.last = f"scene ended at {', '.join(f'{k}={v:.0f}' for k, v in sorted(last.items()))}"
            self.g.lock.release()

gantry = Gantry()
gstream = GantryStream(gantry)
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
                    elif op == "reconnect": gantry.reconnect()
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
        if self.path == "/turn":   # a full turn: (move apart if needed) -> charge in -> both salute -> both play their chains -> (apart)
            A, B = arms.get("A"), arms.get("B")
            if not (A and B): return self._json({"error": "both arms must be connected"}, 404)
            if not gantry.homed: return self._json({"error": "gantry not referenced: press Home first"}, 409)
            if not (A.busy.acquire(blocking=False)): return self._json({"error": "A busy"}, 409)
            if not (B.busy.acquire(blocking=False)): A.busy.release(); return self._json({"error": "B busy"}, 409)
            try:
                scale = float(body.get("scale", 0.5)); feed = float(body.get("feed", gantry.cfg["charge_feed"])); log = []
                def both(mA, mB, sc):
                    bar = threading.Barrier(2); errs = {}
                    def run(arm, move):
                        try: arm.play(move, sc, 1, barrier=bar)
                        except Exception as e: arm.last = f"error: {e}"; errs[arm.name] = str(e)
                    ta = threading.Thread(target=run, args=(A, mA)); tb = threading.Thread(target=run, args=(B, mB)); ta.start(); tb.start(); ta.join(); tb.join()
                    if errs: raise RuntimeError(str(errs))
                for x in (A, B): x.ease_to(x.rest_pose())                       # arms at rest for the ride
                with gantry.lock:
                    st = gantry.status(); apart = gantry.cfg["apart"]
                    if abs(st.get("x", 0) - apart["X"]) > 2 or abs(st.get("y", 0) - apart["Y"]) > 2:
                        gantry.move(apart["X"], apart["Y"], feed); log.append("moved apart")
                    time.sleep(0.5); gantry.move(gantry.cfg["together"]["X"], gantry.cfg["together"]["Y"], feed); log.append("charged in")
                if body.get("salute", True): both("SALUTE", "SALUTE", 1.0); log.append("saluted")
                both(body.get("moveA", "CHAIN_A"), body.get("moveB", "CHAIN_B"), scale); log.append("played")
                if body.get("apart_after", True):
                    with gantry.lock: gantry.move(apart["X"], apart["Y"], feed); log.append("moved apart")
                self._json({"ok": True, "log": log, "A": A.last, "B": B.last})
            except Exception as e:
                self._json({"error": str(e)}, 500)
            finally: A.busy.release(); B.busy.release()
            return
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
