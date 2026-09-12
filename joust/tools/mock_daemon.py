#!/usr/bin/env python3
"""A faithful fake of robot-jousting/arm/arm_daemon.py, for rehearsing the game with no hardware attached.

    python3 tools/mock_daemon.py                      # -> http://127.0.0.1:8766
    python3 tools/mock_daemon.py --port 8799 --speed 6
    python3 tools/mock_daemon.py --fail B             # arm B never answers: the game must refuse to start live
    python3 tools/mock_daemon.py --log /tmp/mock.jsonl # every request, one JSON object per line

Why this exists
---------------
The real daemon opens three serial ports (two LeRobot arms and a GRBL gantry) and a real daemon with nothing
plugged in is nothing but connection errors. Everything the game does in live mode is therefore rehearsed
against this process instead: same port, same routes, same response shapes, same blocking behaviour, and
timing computed from the SAME motion file (robot-jousting/arm/motions_tuned.json) with the SAME constants
that arm_daemon.py uses, so `busy` is true for about as long as it would really be true.

What it models
--------------
  * Two arms, A (SO-100) and B (SO-101), each with a pose, a torque flag, a `last` message and a busy lock
    that is held for the WHOLE of a /play -- ease to rest, ease to the first key, the motion itself at the
    requested scale, HOLD_END on the last key, then the slow return. Exactly the daemon's own sequence.
  * Arm B's roll re-basing (arms.json roll_offset) and the `MOVE@B` / REST-is-this-arm's-own-rest rules.
  * A GRBL gantry: not connected until something homes it, Idle / Run / Home states, absolute mm positions,
    moves that take distance / feed (with the daemon's path-feed rule for a diagonal), a reference sweep that
    takes a few seconds, and an abort that throws the reference away.
  * The gantry channel on an emote: a motion carrying `gantry_mm` + `gantry_axis` streams its carriage along
    that channel IN TIME with the arm samples, decimated and clamped exactly like the daemon's GantryStream.
  * Failure injection (--fail) and a log of every request, so a test can assert what the game actually sent.

What it does NOT model
----------------------
  * Any physics. Poses are interpolated, never simulated; nothing can collide, stall or slip.
  * Serial reality: GRBL buffer depth, planner look-ahead, the "ok"-means-queued handshake, alarm recovery,
    switch bounce, USB resets. The real /gantry stream is the one part of this that is genuinely untested.
  * LeRobot connect/calibration, torque limits, and the daemon's /nudge joint indexing beyond the arithmetic.

Mock-only routes (namespaced so they can never be confused with a real daemon's):
  GET  /mock/log?since=N   -> {"n": total, "log": [...]}    every request in order, with its reply
  POST /mock/reset         -> clears the log
  GET  /mock/state         -> the whole internal state, for debugging a stuck rehearsal
"""
import argparse
import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ---- where the real repo lives ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
JOUST = os.path.dirname(HERE)
REPO = os.path.expanduser(os.environ.get("JOUST_REPO", "") or os.path.join(JOUST, "..") if os.path.exists(os.path.join(JOUST, "..", "arm", "motions_tuned.json")) else os.path.join(JOUST, "..", "robot-jousting"))   # joust/ lives inside the repo
ARM_DIR = os.path.join(REPO, "arm")

# ---- the daemon's own constants (arm_daemon.py). Keep these in step or the rehearsal lies. ----------------
RATE = 50.0             # sample rate of the arm loop
EASE_SPEED = 150.0      # deg/s for an ease_to
HOLD_END = 1.5          # the final pose is held this long before the return
RETURN_SPEED = 60.0     # deg/s for the return to rest
MIN_EASE = 0.15         # ease_to's min_t
# GantryStream (see arm_daemon.py): one merged G1 every STREAM_DT along the motion's gantry channel.
STREAM_DT = 0.25
STREAM_DEADBAND_MM = 0.2   # below this the carriage is not really moving: skip the block rather than creep
GANTRY_MAX_MM = 200.0   # grbl_manual.TRAVEL_MM

JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]

OPTS = argparse.Namespace(speed=1.0, fail=(), verbose=False, log=None)


def scaled(seconds):
    """Wall time for `seconds` of modelled motion. --speed 6 runs a rehearsal six times faster."""
    return max(0.0, float(seconds) / max(0.01, OPTS.speed))


# ---- request log -----------------------------------------------------------------------------------------
class Log:
    """Every request in order, plus the synthetic `gantry_stream` entries the emote channel produces.
    A test reads it over HTTP (GET /mock/log) or off disk (--log FILE, one JSON object per line)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items = []
        self.t0 = time.time()
        self.fh = None

    def open(self, path):
        if path:
            self.fh = open(path, "a", buffering=1)

    def add(self, kind, path, body=None, extra=None):
        ent = {"i": 0, "t": round(time.time() - self.t0, 3), "kind": kind, "path": path}
        if body is not None:
            ent["body"] = body
        if extra:
            ent.update(extra)
        with self.lock:
            ent["i"] = len(self.items)
            self.items.append(ent)
            if self.fh:
                self.fh.write(json.dumps(ent) + "\n")
        if OPTS.verbose:
            print(f"  [{ent['t']:7.2f}] {kind} {path} {json.dumps(body) if body else ''}", flush=True)
        return ent

    def since(self, n):
        with self.lock:
            return len(self.items), [e for e in self.items if e["i"] >= n]

    def clear(self):
        with self.lock:
            self.items = []
            self.t0 = time.time()


LOG = Log()


# ---- motions ---------------------------------------------------------------------------------------------
def load_motions():
    path = os.path.join(ARM_DIR, "motions_tuned.json")
    if not os.path.exists(path):
        print(f"mock_daemon: no motion file at {path}; every /play will 500", flush=True)
        return {}
    with open(path) as f:
        return json.load(f)


def load_cfg():
    path = os.path.join(ARM_DIR, "arms.json")
    if not os.path.exists(path):
        # Enough of arms.json to keep the mock honest if the repo is missing.
        return {"A": {"model": "SO-100", "roll_offset": 76.0, "rest": None},
                "B": {"model": "SO-101", "roll_offset": -88.9, "rest": None},
                "gantry": {"together": {"X": 0.0, "Y": 0.0}, "apart": {"X": 195.0, "Y": 195.0},
                           "charge_feed": 24000.0, "jog_feed": 600.0, "axis": {"A": "X", "B": "Y"}}}
    with open(path) as f:
        return json.load(f)


TUNED = load_motions()
CFG = load_cfg()


def lerp(a, b, s):
    return [x + s * (y - x) for x, y in zip(a, b)]


def sample(t, Q, when):
    """Q at time `when` (linear between samples), the way the daemon's np.interp does it."""
    if when <= t[0]:
        return list(Q[0])
    if when >= t[-1]:
        return list(Q[-1])
    lo, hi = 0, len(t) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if t[mid] <= when:
            lo = mid
        else:
            hi = mid
    span = (t[hi] - t[lo]) or 1e-9
    return lerp(Q[lo], Q[hi], (when - t[lo]) / span)


def sample1(t, v, when):
    """One scalar channel (the gantry track) at time `when`."""
    if when <= t[0]:
        return float(v[0])
    if when >= t[-1]:
        return float(v[-1])
    lo, hi = 0, len(t) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if t[mid] <= when:
            lo = mid
        else:
            hi = mid
    span = (t[hi] - t[lo]) or 1e-9
    return float(v[lo] + (v[hi] - v[lo]) * (when - t[lo]) / span)


# ---- gantry ----------------------------------------------------------------------------------------------
class Gantry:
    """The GRBL two-axis gantry: X carries arm A, Y carries arm B. Same status shape as the real one."""

    def __init__(self):
        self.cfg = CFG["gantry"]
        self.lock = threading.RLock()
        self.connected = False          # the real gantry opens its port on the first home(), not at import
        self.present = "gantry" not in OPTS.fail
        self.homed = False
        self.x = 0.0
        self.y = 0.0
        self.state = "Idle"
        self.last = ""
        self.abort_flag = False

    # -- the two calls the daemon's handler makes -----------------------------------------------------------
    def connect(self):
        if not self.present:
            raise RuntimeError("could not open serial port (mock --fail gantry)")
        if self.connected:
            return
        time.sleep(scaled(2.0))         # the real one sleeps 2 s after opening the port, then preflights
        self.connected = True
        self.last = "connected (not referenced)"

    def home(self):
        self.connect()
        self.abort_flag = False
        self.state = "Home"
        # The real reference sweep runs X then Y at 150 mm/min over up to 201 mm, backs off 1 mm each, then
        # assigns the work zero. Several seconds; we model it as a flat few seconds rather than the sweep.
        for _ in range(30):
            if self.abort_flag:
                self.state = "Idle"
                raise RuntimeError("homing aborted")
            time.sleep(scaled(6.0 / 30))
        self.x = self.y = 0.0
        self.state = "Idle"
        self.homed = True
        self.last = "referenced: X=0 Y=0"

    def status(self):
        if not self.connected:
            return {"connected": False, "homed": False}
        if not self.lock.acquire(blocking=False):
            return {"connected": True, "homed": self.homed, "busy": True,
                    "last": self.last or "moving / referencing"}
        try:
            return {"connected": True, "homed": self.homed, "state": self.state, "pins": 0,
                    "x": round(self.x, 3), "y": round(self.y, 3), "last": self.last}
        finally:
            self.lock.release()

    def move(self, x=None, y=None, feed=None):
        """Blocking absolute move, timed at distance / feed. Mirrors the daemon's path-feed rule."""
        if not self.homed:
            raise RuntimeError("gantry not referenced: home it first")
        tx = self.x if x is None else float(x)
        ty = self.y if y is None else float(y)
        for name, v in (("X", tx), ("Y", ty)):
            if not 0 <= v <= GANTRY_MAX_MM:
                raise RuntimeError(f"{name} must be between 0 and {GANTRY_MAX_MM:g} mm")
        dx, dy = abs(tx - self.x), abs(ty - self.y)
        f = float(feed or self.cfg["charge_feed"])
        if dx > 0 and dy > 0:
            f = f * (dx * dx + dy * dy) ** 0.5 / max(dx, dy)
        f = min(f, self.cfg["charge_feed"])
        dist = (dx * dx + dy * dy) ** 0.5
        secs = (dist / f * 60.0) if f > 0 else 0.0
        x0, y0 = self.x, self.y
        self.state = "Run"
        steps = max(1, int(secs / 0.05))
        for i in range(1, steps + 1):
            if self.abort_flag:
                break
            time.sleep(scaled(secs / steps))
            s = i / steps
            self.x, self.y = x0 + (tx - x0) * s, y0 + (ty - y0) * s
        if not self.abort_flag:
            self.x, self.y = tx, ty
        self.state = "Idle"
        self.last = f"at X={self.x:.0f} Y={self.y:.0f}"

    def abort(self):
        self.abort_flag = True
        self.homed = False
        self.state = "Idle"
        self.last = "ABORTED (reset; re-home before moving)"

    # -- the streamed channel (emotes) ----------------------------------------------------------------------
    def stream_to(self, axis, mm, feed):
        """One decimated segment of a gantry channel, issued while an arm motion is running. The real one
        queues a G1 into GRBL's planner; here it just snaps the axis and records what was sent."""
        mm = max(0.0, min(GANTRY_MAX_MM, float(mm)))
        if axis == "X":
            self.x = mm
        else:
            self.y = mm
        self.state = "Run"
        self.last = f"stream {axis}={mm:.1f} F{feed:.0f}"


class GantryStream:
    """Several arms can carry a gantry channel at once (a two-arm emote moves BOTH carriages). Each playing
    arm registers its own axis; one thread samples every registered channel every STREAM_DT and issues ONE
    merged move, so the two axes travel together instead of taking turns. Same shape as the daemon's."""

    def __init__(self, gantry):
        self.g = gantry
        self.lock = threading.Lock()
        self.channels = {}          # axis -> (t, mm, t0, scale)
        self.thread = None
        self.stop = False
        self.sent = 0
        self.peak_feed = 0.0

    def limit(self):
        ap = self.g.cfg["apart"]
        return float(max(ap["X"], ap["Y"]))

    def clamp(self, v):
        return max(0.0, min(self.limit(), float(v)))

    def usable(self, axis, mm):
        return bool(axis in ("X", "Y") and mm and self.g.connected and self.g.homed)

    def preposition(self, axis, mm):
        """Park the carriage where the scene starts while the arm eases in (the daemon does the same).
        This is an internal call, not an HTTP route, so it is logged explicitly -- otherwise a rehearsal
        could not tell a scene that was prepositioned from one that jumped at the first streamed segment."""
        target = self.clamp(mm)
        try:
            with self.g.lock:
                before = self.g.x if axis == "X" else self.g.y
                self.g.move(**{axis.lower(): target})
            LOG.add("gantry_preposition", "/gantry/preposition",
                    {axis: round(target, 2)}, {"from": round(before, 2)})
        except Exception as e:
            self.g.last = f"gantry preposition failed: {str(e)[:80]}"

    def add(self, axis, t, mm, t0, scale):
        with self.lock:
            self.channels[axis] = (t, mm, t0, scale)
            if self.thread is None or not self.thread.is_alive():
                self.stop = False
                self.sent = 0
                self.peak_feed = 0.0
                self.thread = threading.Thread(target=self._run, daemon=True)
                self.thread.start()

    def remove(self, axis):
        with self.lock:
            self.channels.pop(axis, None)
            done = not self.channels
        if done:
            self.stop = True

    def _run(self):
        feed_cap = float(self.g.cfg["charge_feed"])
        last = {}
        while not self.stop:
            time.sleep(scaled(STREAM_DT))
            with self.lock:
                chans = dict(self.channels)
            if not chans:
                break
            now = time.perf_counter()
            moved = {}
            for axis, (t, mm, t0, scale) in chans.items():
                when = (now - t0) * OPTS.speed * scale     # same clock the arm loop samples on
                target = self.clamp(sample1(t, mm, when))     # never past the apart stop, as the daemon clamps
                prev = last.get(axis, self.g.x if axis == "X" else self.g.y)
                if abs(target - prev) < STREAM_DEADBAND_MM:   # nothing worth sending this tick
                    continue
                moved[axis] = (prev, target)
            if not moved:
                continue
            dist = max(abs(b - a) for a, b in moved.values())
            feed = min(feed_cap, dist / STREAM_DT * 60.0)
            for axis, (_, target) in moved.items():
                self.g.stream_to(axis, target, feed)
                last[axis] = target
            self.sent += 1
            self.peak_feed = max(self.peak_feed, feed)
            LOG.add("gantry_stream", "/gantry/stream",
                    {axis: round(v[1], 2) for axis, v in moved.items()},
                    {"feed": round(feed, 1)})
        self.g.state = "Idle"


# ---- arms ------------------------------------------------------------------------------------------------
class Arm:
    def __init__(self, name):
        self.name = name
        self.busy = threading.Lock()
        self.last = ""
        self.torque = True
        self.abort = False
        self.cfg = CFG.get(name, {})
        self.model = self.cfg.get("model", "SO-100" if name == "A" else "SO-101")
        self.q = list(self.rest_pose())
        self._entry_arm = None

    def rest_pose(self):
        key = "REST" if self.name == "A" else f"REST@{self.name}"
        if key in TUNED:
            return [float(x) for x in TUNED[key]["q"][0]]
        r = self.cfg.get("rest")
        if r:
            return [float(x) for x in r]
        if "REST" in TUNED:
            return [float(x) for x in TUNED["REST"]["q"][0]]
        return [0.0] * 6

    def rebase(self, Q):
        """Tuned trajectories are in arm A's coordinates; another arm gets its roll moved to its own offset."""
        if self._entry_arm == self.name:
            return [list(map(float, r)) for r in Q]
        if self.name == "A":
            return [list(map(float, r)) for r in Q]
        off = self.cfg.get("roll_offset")
        if off is None:
            raise RuntimeError(f"arm {self.name}: roll_offset not set in arms.json")
        a_off = CFG["A"]["roll_offset"]
        out = []
        for row in Q:
            r = list(map(float, row))
            r[4] = max(-175.0, min(175.0, r[4] - a_off + off))
            out.append(r)
        return out

    # -- motion primitives, timed exactly as the daemon times them ------------------------------------------
    def ease_to(self, target, max_speed=EASE_SPEED, min_t=MIN_EASE):
        if not self.torque:
            self.torque = True
        cur = self.q
        T = max(max(abs(b - a) for a, b in zip(cur[:5], target[:5])) / max_speed, min_t)
        n = max(int(T * RATE), 1)
        for i in range(1, n + 1):
            if self.abort:
                return
            self.q = lerp(cur, target, i / n)
            time.sleep(scaled(1.0 / RATE))

    def motion(self, move):
        """(t, Q, rest, gantry_mm, gantry_axis) for `move` on THIS arm, resolved the daemon's way."""
        M = TUNED.get(f"{move}@{self.name}") or TUNED.get(move)
        if M is None:
            raise RuntimeError(f"no move {move}")
        t = [float(x) for x in M["t"]]
        self._entry_arm = M.get("arm", "A")
        Q = self.rebase(M["q"])
        rest = self.rest_pose()
        if move == "REST":
            Q = [list(rest) for _ in t]
        return t, Q, rest, M.get("gantry_mm"), M.get("gantry_axis")

    def play(self, move, scale, repeat, barrier=None, stream=None):
        t, Q, rest, gmm, gaxis = self.motion(move)
        self.abort = False
        self.ease_to(rest)
        self.ease_to(Q[0])
        time.sleep(scaled(0.1))
        # The emote's carriage channel, prepositioned while the arm eases in -- as arm_daemon.py does.
        streaming = bool(stream is not None and stream.usable(gaxis, gmm))
        if streaming:
            stream.preposition(gaxis, gmm[0])
        if barrier is not None:
            try:
                barrier.wait(timeout=30)
            except threading.BrokenBarrierError:
                pass
        for i in range(repeat):
            if self.abort:
                break
            if i:
                self.ease_to(Q[0])
                time.sleep(scaled(0.1))
            T = t[-1] / scale
            t0 = time.perf_counter()
            # --- gantry channel: registered for the length of the motion only, never the ease or the hold ---
            if streaming:
                stream.add(gaxis, t, [float(x) for x in gmm], t0, scale)
            try:
                while not self.abort:
                    now = (time.perf_counter() - t0) * OPTS.speed
                    if now > T:
                        self.q = list(Q[-1])
                        break
                    self.q = sample(t, Q, now * scale)
                    time.sleep(scaled(1.0 / RATE))
            finally:
                if streaming:
                    stream.remove(gaxis)
            time.sleep(scaled(HOLD_END))
        if self.abort:
            self.last = f"{move} ABORTED, holding where it stopped"
            self.abort = False
            return
        self.ease_to(rest, max_speed=RETURN_SPEED)
        err = max(abs(a - b) for a, b in zip(self.q[:5], rest[:5]))
        self.last = f"{move} x{scale} done, end err {err:.1f} deg"

    def entry(self):
        return {"busy": self.busy.locked(), "last": self.last, "torque": self.torque,
                "pose": [round(x, 1) for x in self.q], "model": self.model}


# ---- the server ------------------------------------------------------------------------------------------
gantry = None
arms = {}
stream = None


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
        return obj

    # -- GET ------------------------------------------------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/mock/log":
            since = int((parse_qs(u.query).get("since") or ["0"])[0])
            n, items = LOG.since(since)
            return self._json({"n": n, "log": items})
        if u.path == "/mock/state":
            return self._json({"arms": {n: a.entry() for n, a in arms.items()},
                               "gantry": gantry.status(), "speed": OPTS.speed, "fail": list(OPTS.fail)})
        if u.path != "/status":
            LOG.add("GET", u.path)
            return self._json({"error": "unknown " + u.path}, 404)
        out = {}
        for n, a in arms.items():
            out[n] = a.entry()
        body = {"arms": out, "gantry": gantry.status()}
        # /status is polled several times a second; logging every one would bury the interesting requests.
        # It is counted instead, and the poll itself is what waitIdle is really asserting.
        STATUS_COUNT[0] += 1
        return self._json(body)

    # -- POST -----------------------------------------------------------------------------------------------
    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            body = {}
        if u.path == "/mock/reset":
            LOG.clear()
            STATUS_COUNT[0] = 0
            return self._json({"ok": True})
        ent = LOG.add("POST", u.path, body)
        try:
            code, obj = self.route(u.path, body)
        except Exception as e:                       # a bug in the mock must look like a daemon 500
            code, obj = 500, {"error": str(e)}
        ent["status"] = code
        ent["reply"] = obj
        return self._json(obj, code)

    def route(self, path, body):
        name = body.get("arm", "A")

        if path == "/connect":
            if name in OPTS.fail:
                return 500, {"error": f"connect failed: arm {name} not plugged in (mock --fail {name})"}
            if name not in arms:
                arms[name] = Arm(name)
            return 200, {"ok": True, "last": "connected"}

        if path.startswith("/gantry/"):
            op = path.split("/")[-1]
            try:
                if op == "abort":
                    gantry.abort()
                    return 200, {"ok": True, "last": gantry.last}
                if op == "unlock":
                    gantry.lock = threading.RLock()
                    gantry.last = "lock cleared"
                    return 200, {"ok": True, "last": gantry.last}
                if not gantry.lock.acquire(blocking=False):
                    return 409, {"error": "gantry busy"}
                try:
                    gantry.abort_flag = False
                    if op == "home":
                        gantry.home()
                    elif op == "move":
                        gantry.move(body.get("x"), body.get("y"), body.get("feed"))
                    elif op == "together":
                        gantry.move(gantry.cfg["together"]["X"], gantry.cfg["together"]["Y"], body.get("feed"))
                    elif op == "apart":
                        gantry.move(gantry.cfg["apart"]["X"], gantry.cfg["apart"]["Y"], body.get("feed"))
                    else:
                        return 404, {"error": "unknown gantry op"}
                finally:
                    gantry.lock.release()
                return 200, {"ok": True, "last": gantry.last}
            except Exception as e:
                gantry.last = f"error: {e}"
                return 500, {"error": str(e)}

        a = arms.get(name) if name != "both" else next(iter(arms.values()), None)
        if a is None:
            return 404, {"error": f"arm {name} not connected"}

        if path == "/abort":
            for x in (arms.values() if name == "both" else [a]):
                x.abort = True
            return 200, {"ok": True}

        if path == "/turn":
            return self.turn(body)

        if path == "/play_both":
            A, B = arms.get("A"), arms.get("B")
            if not (A and B):
                return 404, {"error": "both arms must be connected"}
            if not A.busy.acquire(blocking=False):
                return 409, {"error": "A busy"}
            if not B.busy.acquire(blocking=False):
                A.busy.release()
                return 409, {"error": "B busy"}
            try:
                errs = self.both(A, body["moveA"], B, body["moveB"], float(body.get("scale", 0.5)))
                return 200, {"ok": not errs, "A": A.last, "B": B.last, "errors": errs}
            finally:
                A.busy.release()
                B.busy.release()

        if not a.busy.acquire(blocking=False):
            return 409, {"error": "busy"}
        try:
            if path == "/play":
                a.play(body["move"], float(body.get("scale", 1.0)), int(body.get("repeat", 1)), stream=stream)
            elif path == "/rest":
                a.ease_to(a.rest_pose())
                a.last = "at rest"
            elif path == "/hold":
                a.ease_to(list(a.q), min_t=0.05)
                a.last = "holding current pose"
            elif path == "/release":
                a.torque = False
                a.last = "torque off: move the arm by hand"
            elif path == "/goto":
                a.ease_to([float(x) for x in body["q"]], max_speed=float(body.get("speed", 60)))
                a.last = "holding requested pose"
            elif path == "/nudge":
                j = JOINTS.index(body["joint"])
                deg = float(body.get("deg", 15))
                q0 = list(a.q)
                a.ease_to(q0, min_t=0.05)
                time.sleep(scaled(0.3))
                for target in ((deg, 0.0) if body.get("oneway") else (deg, -deg, 0.0)):
                    q1 = list(q0)
                    q1[j] += target
                    a.ease_to(q1, max_speed=40.0)
                    time.sleep(scaled(0.4))
                a.last = f"nudged {body['joint']} by {deg} deg"
            else:
                return 404, {"error": "unknown " + path}
            return 200, {"ok": True, "last": a.last}
        except Exception as e:
            a.last = f"error: {e}"
            return 500, {"error": str(e)}
        finally:
            a.busy.release()

    # -- helpers ---------------------------------------------------------------------------------------------
    def both(self, A, mA, B, mB, sc):
        """Both arms, one barrier, started together -- the daemon's own play_both body."""
        bar = threading.Barrier(2)
        errs = {}

        def run(arm, move):
            try:
                arm.play(move, sc, 1, barrier=bar, stream=stream)
            except Exception as e:
                arm.last = f"error: {e}"
                errs[arm.name] = str(e)
                try:
                    bar.abort()
                except Exception:
                    pass
        ta = threading.Thread(target=run, args=(A, mA))
        tb = threading.Thread(target=run, args=(B, mB))
        ta.start()
        tb.start()
        ta.join()
        tb.join()
        return errs

    def turn(self, body):
        """The daemon's full turn routine: apart if needed -> charge in -> salute -> chains -> apart."""
        A, B = arms.get("A"), arms.get("B")
        if not (A and B):
            return 404, {"error": "both arms must be connected"}
        if not gantry.homed:
            return 409, {"error": "gantry not referenced: press Home first"}
        if not A.busy.acquire(blocking=False):
            return 409, {"error": "A busy"}
        if not B.busy.acquire(blocking=False):
            A.busy.release()
            return 409, {"error": "B busy"}
        try:
            scale = float(body.get("scale", 0.5))
            feed = float(body.get("feed", gantry.cfg["charge_feed"]))
            log = []
            apart = gantry.cfg["apart"]
            for x in (A, B):
                x.ease_to(x.rest_pose())
            with gantry.lock:
                if abs(gantry.x - apart["X"]) > 2 or abs(gantry.y - apart["Y"]) > 2:
                    gantry.move(apart["X"], apart["Y"], feed)
                    log.append("moved apart")
                time.sleep(scaled(0.5))
                gantry.move(gantry.cfg["together"]["X"], gantry.cfg["together"]["Y"], feed)
                log.append("charged in")
            if body.get("salute", True):
                self.both(A, "SALUTE", B, "SALUTE", 1.0)
                log.append("saluted")
            errs = self.both(A, body.get("moveA", "CHAIN_A"), B, body.get("moveB", "CHAIN_B"), scale)
            log.append("played")
            if errs:
                return 500, {"error": str(errs)}
            if body.get("apart_after", True):
                with gantry.lock:
                    gantry.move(apart["X"], apart["Y"], feed)
                    log.append("moved apart")
            return 200, {"ok": True, "log": log, "A": A.last, "B": B.last}
        finally:
            A.busy.release()
            B.busy.release()


STATUS_COUNT = [0]


def main():
    global gantry, arms, stream
    ap = argparse.ArgumentParser(description="a faithful fake of arm/arm_daemon.py")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--speed", type=float, default=1.0,
                    help="time compression: 1 = real timing, 6 = six times faster (rehearsals)")
    ap.add_argument("--fail", default="", help="comma separated: A, B and/or gantry -- that part never answers")
    ap.add_argument("--log", default="", help="append every request to this file as JSON lines")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    OPTS.speed = args.speed
    OPTS.fail = tuple(x.strip() for x in args.fail.split(",") if x.strip())
    OPTS.verbose = args.verbose
    LOG.open(args.log)

    gantry = Gantry()
    arms = {n: Arm(n) for n in ("A", "B") if n not in OPTS.fail}
    stream = GantryStream(gantry)
    missing = [n for n in ("A", "B") if n not in arms]
    print(f"mock arm daemon on http://{args.host}:{args.port}   arms: {sorted(arms)}"
          f"{'   MISSING: ' + ','.join(missing) if missing else ''}   speed x{OPTS.speed}", flush=True)
    print(f"  motions: {len(TUNED)} from {os.path.join(ARM_DIR, 'motions_tuned.json')}", flush=True)
    if "gantry" in OPTS.fail:
        print("  gantry: --fail gantry, it will refuse to connect", flush=True)
    srv = ThreadingHTTPServer((args.host, args.port), H)
    srv.daemon_threads = True
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
