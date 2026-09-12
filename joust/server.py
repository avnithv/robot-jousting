#!/usr/bin/env python3
"""Tilt of Tiltford: static server for the game + bridge to the real arms.

    python3 server.py              -> http://localhost:8770   (sim only: no arm daemon needed)
    ARM_A_URL=http://127.0.0.1:8766 ARM_B_URL=http://127.0.0.1:8767 JOUST_REPO=~/game python3 server.py

Env:
  ARM_A_URL   the arm daemon (robot-jousting/arm/arm_daemon.py). Default http://127.0.0.1:8766. One daemon
              drives BOTH arms: every POST carries {"arm": "A"|"B"} and GET /status answers
              {"arms": {"A": {busy,...}, "B": {...}}, "gantry": {...}}.
  ARM_B_URL   only if the two arms really are two separate daemons. Default: the same URL as ARM_A_URL.
  JOUST_REPO  path to the robot-jousting checkout. If set, /api/exchange compiles CHAIN_A/CHAIN_B with sim/chain.py
              and plays them; otherwise it falls back to playing each beat's move one at a time.
  HOST        bind address. Default 0.0.0.0 so phones on the same Wi-Fi can reach the phone client.
  PUBLIC_URL  base URL printed into the phone links / QR codes (e.g. a cloudflared https URL). A running ngrok
              tunnel (its local API on :4040) is picked up automatically, no restart needed.
              Default: http://<lan-ip>:<port>, found from the default-route interface.

API (all JSON). Everything that drives metal is a JOB: the POST returns {"ok", "job": id} at once and the
caller watches GET /api/job?id=... for its `phase`, `steps` and `status`. Nothing here blocks the browser.
  GET  /api/status                                -> {"armA": ..., "armB": ..., "gantry": {...}, "ready": {...}}
                                                     `ready.missing` lists arms the daemon does not report;
                                                     the game refuses to start a live fight when it is non-empty.
  POST /api/prepare                               -> queued; home the gantry if it is not referenced, drive
                                                     both carriages apart, both arms to rest. The slow one.
  POST /api/charge   {"feed": mm/min}             -> queued; carriages to the `together` stop (the charge)
  POST /api/retreat  {"feed": mm/min}             -> queued; carriages back to the `apart` stop (the return)
  POST /api/play     {"side": "a"|"b", "move": "ATTACK_HIGH", "scale": 1.0}  -> queued (non-blocking)
  POST /api/exchange {"ours": [..3 moves..], "theirs": [..3 moves..]}         -> queued; builds + plays both chains.
                                                     The job carries `beats` -- the compiler's REAL beat
                                                     boundaries, which are not three equal 1.4 s beats.
  POST /api/emote    {"scene": "EN_GARDE_OPENER", "swap": false}              -> queued; plays the scene on both
                                                     arms, carriage channel included (see emote_moves).
  POST /api/home                                  -> both arms ease to REST
  POST /api/abort                                 -> IMMEDIATE (not a job): every arm stops where it stands and
                                                     the gantry is reset. The gantry must be re-homed after.
  GET  /api/moves?scale=1                         -> every move's REAL timing on both arms:
                                                     {lead, motion, hold, ret, total, pinned}. A /play is not
                                                     the length of the trajectory -- ATTACK_HIGH is 1.26 s of
                                                     motion inside 4.54 s of busy -- and this is what the
                                                     front end sizes a live beat from.
  GET  /api/job?id=XXX                            -> one job: {phase, steps, beats, lead, tail, source,
                                                     done_beats, closest_cm, status, result}
  GET  /api/jobs                                  -> recent job log

Phone multiplayer (in memory, no database; the big screen is the host and the only place the rules run,
this server is a mailbox and a relay -- see the "mp" block below and joust/src/net/room.js):
  POST /api/mp/rooms                              -> {code, tokens:{a,b}, urls:{a,b}}
  POST /api/mp/rooms/<code>/publish {rev, public, private:{a,b}}   host pushes the latest view, wakes pollers
  GET  /api/mp/rooms/<code>/acts?since=K&wait=25  -> {seq, acts:[...], seen:{a,b}, now}  host long-polls the choices
  GET  /api/mp/rooms/<code>/state                 -> {code, rev, seq, seen:{a,b}, now, urls}  no tokens, no view
  POST /api/mp/rooms/<code>/adopt                 -> {code, tokens, urls, rev, seq, seen, now}  take a room back
  POST /api/mp/rooms/<code>/reissue {side}        -> {side, token, url}   new ticket for one seat, old one dies
  POST /api/mp/rooms/<code>/swap                  -> {tokens, urls}       the two phones trade colours
  GET  /api/mp/p/<token>?rev=N&wait=25            -> {side, code, rev, public, private}  one player's view only
  POST /api/mp/p/<token>/act {type, ...}          -> {ok, seq}           that player's choice
  GET  /api/mp/qr.svg?text=...                    -> an SVG QR code (server-side, python `qrcode`)

A retired token (its seat was reissued from the host's Host Controls) answers 410 {"error": "reissued"} to
both routes, so the old phone can say "this seat was reissued" instead of looping on a dead ticket.
"""
import json, os, re, sys, time, threading, subprocess, uuid, random, secrets, socket
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
# One daemon drives BOTH arms (robot-jousting/arm/arm_daemon.py on :8766): every POST carries {"arm": "A"|"B"}
# and GET /status answers {"arms": {"A": {...}, "B": {...}}, "gantry": {...}}. ARM_B_URL therefore defaults to
# ARM_A_URL; set it to a second URL only if the two arms really are served by two separate daemons.
ARM_A = os.environ.get("ARM_A_URL", "http://127.0.0.1:8766")
ARMS = {"a": ARM_A, "b": os.environ.get("ARM_B_URL", "") or ARM_A}
SIDE_ARM = {"a": "A", "b": "B"}                 # our side letters -> the daemon's arm names
_repo_env = os.environ.get("JOUST_REPO")   # unset: auto-detect the repo this folder lives in; set but empty: no compiler (per-beat play)
REPO = os.path.expanduser(_repo_env) if _repo_env is not None else (os.path.join(HERE, "..") if os.path.exists(os.path.join(HERE, "..", "arm", "motions_tuned.json")) else "")
jobs = []; jobs_lock = threading.Lock()

def arm_body(side, body):
    """Every POST to the daemon says which arm it is for. An explicit 'arm' in the body wins."""
    out = dict(body or {})
    out.setdefault("arm", SIDE_ARM.get(side, "A"))
    return out

def daemon(side, path, body=None, timeout=10):
    base = ARMS.get(side)
    if not base: return {"offline": True, "reason": "no daemon configured for side " + side}
    try:
        data = json.dumps(arm_body(side, body)).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data,
                                     headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        # The daemon ANSWERED -- it just said no (409 busy, 404 no such arm, 500 mid-move error). That is a
        # very different thing from an unreachable daemon, and calling it "offline" would have the front end
        # putting the whole show back into sim over one busy gantry.
        try: out = json.loads(e.read() or b"{}")
        except Exception: out = {}
        if not isinstance(out, dict): out = {"error": str(out)}
        out.setdefault("error", f"HTTP {e.code}")
        out["status"] = e.code
        return out
    except Exception as e:
        return {"offline": True, "error": str(e)}

def _arm_entry(raw, key):
    """One arm's slice of a daemon /status reply. Handles the two-arm daemon ({'arms': {'A': ..., 'B': ...}})
    and a single-arm daemon that reports {busy, last, ...} at the top level. Missing arm = offline."""
    if not raw or raw.get("offline"):
        out = {"offline": True}
        for k in ("error", "reason"):
            if raw and raw.get(k): out[k] = raw[k]
        return out
    arms = raw.get("arms")
    if isinstance(arms, dict):
        ent = arms.get(key) or arms.get(key.lower())
        if not isinstance(ent, dict): return {"offline": True, "reason": "daemon reports no arm " + key}
        return dict(ent)
    return dict(raw)

def gantry_state(raw=None):
    """The gantry slice of the daemon's /status: {connected, homed, state, pins, x, y, last}, or offline.
    The gantry lives on the arm-A daemon -- it is the process that owns the GRBL serial port."""
    raw = daemon("a", "/status", timeout=6) if raw is None else raw
    if not raw or raw.get("offline"):
        return {"offline": True, "error": (raw or {}).get("error"), "reason": (raw or {}).get("reason")}
    g = raw.get("gantry")
    if not isinstance(g, dict): return {"offline": True, "reason": "this daemon reports no gantry"}
    return dict(g)

def arm_status():
    """/api/status for both wirings: one daemon driving both arms (the usual case) or two separate daemons.
    It also answers the only question the front end really has before a live fight: is everything there?"""
    a_raw = daemon("a", "/status")
    b_raw = a_raw if ARMS.get("b") == ARMS.get("a") else daemon("b", "/status")
    out = {"armA": _arm_entry(a_raw, "A"), "armB": _arm_entry(b_raw, "B"),
           "repo": bool(REPO), "arms": ARMS}
    g = gantry_state(a_raw)
    out["gantry"] = g
    missing = [k for k in ("A", "B") if out["arm" + k].get("offline")]
    # `ready` is the go / no-go the game refuses to start a live fight without. An unreferenced gantry is not
    # a refusal -- /api/prepare exists to fix that -- but a missing arm is.
    out["ready"] = {"arms": not missing, "missing": missing,
                    "gantry": bool(g.get("connected") and g.get("homed")),
                    "ok": not missing}
    return out

def gantry_op(op, body=None, timeout=240):
    """One /gantry/* call on the arm-A daemon. Generous timeouts: a reference sweep is two axes crawling onto
    their switches at 150 mm/min, and every gantry route blocks until the machine is Idle again."""
    return daemon("a", "/gantry/" + op, body or {}, timeout=timeout)

def failed(r, what):
    """Daemon replies are {ok:...} / {error:...} / {offline:...}. Turn the bad ones into one sentence."""
    if not isinstance(r, dict): return f"{what}: no reply"
    if r.get("offline"): return f"{what}: the arm daemon is not answering ({r.get('error') or r.get('reason')})"
    if r.get("error"): return f"{what}: {r['error']}"
    return ""

def log(kind, label, fn):
    """Start `fn` on a worker and hand back its job id at once. `fn` is called with the job dict, so a long
    routine (a reference sweep, a chain compile) can post progress into it while the front end watches."""
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "kind": kind, "label": label, "status": "running", "t": time.time(),
           "phase": "", "steps": [], "result": None}
    with jobs_lock: jobs.insert(0, job); del jobs[60:]
    def run():
        try: job["result"] = fn(job); job["status"] = "done"
        except Exception as e: job["result"] = str(e); job["status"] = "failed"
        job["phase"] = job["status"]; job["took"] = round(time.time() - job["t"], 2)
    threading.Thread(target=run, daemon=True).start(); return {"ok": True, "job": jid}

def step(job, phase, note=""):
    """One line of progress on a job: the host drawer prints the latest, the bridge waits on the phase."""
    job["phase"] = phase
    job["steps"].append({"t": round(time.time() - job["t"], 2), "phase": phase, "note": note})
    return job

def find_job(jid):
    with jobs_lock:
        for j in jobs:
            if j["id"] == jid: return j
    return {"error": "no such job", "id": jid}

def play_both(move_a, move_b, scale=1.0):
    """Start both arms as close to simultaneously as the two blocking daemons allow."""
    res = {}
    def go(side, move):
        if move: res[side] = daemon(side, "/play", {"move": move, "scale": scale, "repeat": 1}, timeout=180)
    ta = threading.Thread(target=go, args=("a", move_a)); tb = threading.Thread(target=go, args=("b", move_b))
    ta.start(); tb.start(); ta.join(); tb.join(); return res

def both_rest(timeout=120):
    """Both arms ease to their own REST, at the same time rather than one after the other."""
    res = {}
    def go(side): res[side] = daemon(side, "/rest", {}, timeout=timeout)
    ts = [threading.Thread(target=go, args=(s,)) for s in ("a", "b") if ARMS.get(s)]
    for t in ts: t.start()
    for t in ts: t.join()
    return res

# ---- the motion file, for the questions server.py has to answer itself -----------------------------------
MOVES_CACHE = {"path": "", "mtime": 0.0, "names": set()}
def tuned_path():
    for base in ([REPO] if REPO else []) + [os.path.join(HERE, ".."), os.path.join(HERE, "..", "robot-jousting")]:   # the repo this folder lives in, or a sibling checkout
        p = os.path.join(base, "arm", "motions_tuned.json")
        if os.path.exists(p): return p
    return ""
def tuned_names():
    p = tuned_path()
    if not p: return set()
    try: mt = os.path.getmtime(p)
    except OSError: return set()
    if MOVES_CACHE["path"] != p or MOVES_CACHE["mtime"] != mt:
        try:
            with open(p) as f: MOVES_CACHE["names"] = set(json.load(f))
            MOVES_CACHE["path"], MOVES_CACHE["mtime"] = p, mt
        except Exception: return set()
    return MOVES_CACHE["names"]

# ---- how long a motion really takes ----------------------------------------------------------------------
# These four numbers are arm_daemon.py's, and they must stay in step with it. A /play is NOT the length of
# the trajectory: the daemon eases to rest, eases to the motion's first key, waits 0.1 s, plays the
# trajectory at `scale`, HOLDS the last pose for HOLD_END, and only then eases back to rest at RETURN_SPEED.
# On an attack that is 1.26 s of trajectory inside about 3.6 s of busy, which is why sizing a live beat at
# the screen's 1.4 s puts the picture a whole move ahead of the metal.
RATE, EASE_SPEED, HOLD_END, RETURN_SPEED, MIN_EASE, SETTLE = 50.0, 150.0, 1.5, 60.0, 0.15, 0.1
IMPACT_FRACTION = 0.7        # ui/stage.js: where in a beat the screen lands its impact, when we cannot do better

def _rest_pose(T, cfg, arm):
    key = "REST" if arm == "A" else f"REST@{arm}"
    if key in T: return [float(x) for x in T[key]["q"][0]]
    r = (cfg.get(arm) or {}).get("rest")
    if r: return [float(x) for x in r]
    return [float(x) for x in T["REST"]["q"][0]] if "REST" in T else [0.0] * 6

def _ease(a, b, speed):
    """The daemon's ease_to: time is the largest joint move over `speed`, with a floor."""
    return max(max(abs(x - y) for x, y in zip(a[:5], b[:5])) / speed, MIN_EASE)

def move_timing(name, arm="A", scale=1.0):
    """How long the daemon will hold `arm` busy playing `name`, broken down. Seconds.

    lead    ease to rest + ease to the first key + the daemon's 0.1 s settle -- BEFORE the trajectory clock
    motion  the trajectory itself, at `scale`
    hold    HOLD_END on the last pose
    ret     the ease back to rest at RETURN_SPEED
    pinned  when the blow lands, measured from the START of the whole thing: the last key of the trajectory,
            which is where an attack's impact is pinned (sim/chain.py pins it at IMPACT within its beat).
    """
    T = tuned_json()
    if not T: return None
    M = T.get(f"{name}@{arm}") or T.get(name)
    if not M: return None
    t, Q = M["t"], M["q"]
    rest = _rest_pose(T, T.get("_cfg") or {}, arm)
    q0 = [float(x) for x in Q[0]]; q1 = [float(x) for x in Q[-1]]
    lead = MIN_EASE + _ease(rest, q0, EASE_SPEED) + SETTLE
    motion = float(t[-1]) / max(0.01, scale)
    ret = _ease(q1, rest, RETURN_SPEED)
    return {"lead": round(lead, 3), "motion": round(motion, 3), "hold": HOLD_END, "ret": round(ret, 3),
            "total": round(lead + motion + HOLD_END + ret, 3), "pinned": round(lead + motion, 3),
            "gantry": bool(M.get("gantry_mm"))}

TUNED_CACHE = {"path": "", "mtime": 0.0, "data": None}
def tuned_json():
    p = tuned_path()
    if not p: return None
    try: mt = os.path.getmtime(p)
    except OSError: return None
    if TUNED_CACHE["path"] != p or TUNED_CACHE["mtime"] != mt:
        try:
            with open(p) as f: data = json.load(f)
        except Exception: return None
        try:
            with open(os.path.join(os.path.dirname(p), "arms.json")) as f: data["_cfg"] = json.load(f)
        except Exception: data["_cfg"] = {}
        TUNED_CACHE.update({"path": p, "mtime": mt, "data": data})
    return TUNED_CACHE["data"]

def moves_table(scale=1.0):
    """Every move's real timing, for both arms. The front end sizes its live beats off this."""
    T = tuned_json()
    if not T: return {}
    out = {}
    for name in sorted(k for k in T if not k.startswith("_") and not k.endswith("@B")):
        ent = {}
        for arm in ("A", "B"):
            tm = move_timing(name, arm, scale)
            if tm: ent[arm] = tm
        if ent: out[name] = ent
    return out

def fallback_beat_plan(ours, theirs, scale=1.0):
    """The per-beat path (no chain compiler): each beat is two separate /play calls, so the beat lasts as
    long as the SLOWER of the two whole motions -- lead, trajectory, hold and the return to rest, all of it.
    A FEINT_HIGH beat is over 5 s of busy; the screen has to stretch to that or it runs away."""
    plan, t = [], 0.0
    for i in range(max(len(ours), len(theirs))):
        a = ours[i] if i < len(ours) else "REST"
        b = theirs[i] if i < len(theirs) else "REST"
        ta = move_timing(a or "REST", "A", scale) or {}
        tb = move_timing(b or "REST", "B", scale) or {}
        dur = max(ta.get("total", 1.4), tb.get("total", 1.4))
        pinned = max(ta.get("pinned", dur * IMPACT_FRACTION), tb.get("pinned", dur * IMPACT_FRACTION))
        plan.append({"start": round(t, 3), "end": round(t + dur, 3), "pinned_at": round(t + pinned, 3),
                     "a": a, "b": b})
        t += dur
    return plan

def chain_beats():
    """The beat boundaries of the chains that were just compiled.

    sim/chain.py STRETCHES a beat whenever the connector into the next move does not fit in the 1.4 s window
    (a real pair comes out as e.g. 1.79 / 1.91 / 1.46 s), so a compiled turn is not three equal beats. The
    true numbers are in CHAIN_A / CHAIN_B's own `beats` array; the front end paces the screen off these
    instead of counting 1.4 s three times, which is the whole point of compiling them together."""
    p = tuned_path()
    if not p: return None
    try:
        with open(p) as f: T = json.load(f)
    except Exception: return None
    A = (T.get("CHAIN_A") or {}).get("beats") or []
    B = (T.get("CHAIN_B") or {}).get("beats") or []
    out = []
    for i in range(max(len(A), len(B))):
        pair = [x for x in (A[i] if i < len(A) else None, B[i] if i < len(B) else None) if x]
        if not pair: continue
        # `pinned_at` is where the compiler put the blow: an attack's last key, a block's guard key. The
        # screen lands its impact instant there instead of at a flat 0.7 of the beat.
        pinned = [x["pinned_at"] for x in pair if x.get("pinned_at") is not None]
        ent = {"start": round(min(x["start"] for x in pair), 3),
               "end": round(max(x["end"] for x in pair), 3),
               "a": (A[i]["move"] if i < len(A) else None), "b": (B[i]["move"] if i < len(B) else None)}
        if pinned: ent["pinned_at"] = round(max(pinned), 3)
        out.append(ent)
    return out or None

CHAIN_CACHE = {"key": None}

def exchange(ours, theirs, job=None):
    """One turn on the metal. With JOUST_REPO set the two three-move chains are compiled TOGETHER (so the
    beats line up and the pair is collision-checked) and played as one motion each; otherwise it is one beat
    at a time. The compile is the slow part -- about 9 s for a pair on this machine -- so the job reports
    `compiling` then `playing`, and an identical pair is not compiled twice."""
    note = (lambda phase, text: step(job, phase, text)) if job is not None else (lambda phase, text: None)
    if REPO and os.path.isdir(os.path.join(REPO, "sim")):
        key = (tuple(ours), tuple(theirs))
        if CHAIN_CACHE.get("key") != key:
            note("compiling", "sim/chain.py is building CHAIN_A and CHAIN_B (connectors, flourishes, pair check)")
            py = os.path.join(REPO, ".venv", "bin", "python")
            # --no-render keeps the pair's blade-distance safety check and drops the MuJoCo video, which is
            # the overwhelming bulk of the time: 10-80 s measured with it, a couple of seconds without. That
            # is the gap between a player locking in and the arms moving, so it is dead screen time.
            cmd = [py, "chain.py", "pair", *[m for m in ours if m], "--", *[m for m in theirs if m], "--no-render"]
            r = subprocess.run(cmd, cwd=os.path.join(REPO, "sim"), capture_output=True, text=True, timeout=300)
            if r.returncode != 0:
                CHAIN_CACHE["key"] = None
                raise RuntimeError("chain build failed: " + r.stdout[-800:] + r.stderr[-800:])
            CHAIN_CACHE["key"] = key
            # The pair pass measures how close the two blades come and prints it. Nobody was reading that.
            # It is the only automatic warning that this particular pair of chains puts metal into metal, so
            # put it in the job where the host can see it -- and say so loudly when it is under the
            # touching threshold the checker itself quotes.
            m = re.search(r"closest blade-axis distance ([\d.]+) cm.*?touching = ([\d.]+) cm", r.stdout, re.S)
            if m and job is not None:
                near, touch = float(m.group(1)), float(m.group(2))
                job["closest_cm"] = near
                if near < touch:
                    job["collision_warning"] = (f"the two blades come within {near:.1f} cm and the checker calls "
                                                f"{touch:.1f} cm touching: expect contact on this pair")
                    note("compiling", "WARNING: " + job["collision_warning"])
        else:
            note("compiling", "the same two chains as last turn: reusing the compiled CHAIN_A / CHAIN_B")
        beats = chain_beats()
        if job is not None and beats:
            # The chain's beat clock starts AFTER the daemon has eased both arms into the first key, so the
            # screen's beat clock has to start there too. `lead` is that ease, measured off the real poses,
            # not guessed; `tail` is the hold plus the return the daemon adds after the last beat.
            ta = move_timing("CHAIN_A", "A") or {}; tb = move_timing("CHAIN_B", "B") or {}
            job["beats"] = beats
            job["lead"] = round(max(ta.get("lead", 0.35), tb.get("lead", 0.35)), 3)
            job["tail"] = round(max(ta.get("hold", 0) + ta.get("ret", 0), tb.get("hold", 0) + tb.get("ret", 0)), 3)
            job["source"] = "compiled"
        note("playing", "both arms play their compiled chain, started together"
             + (f" ({len(beats)} beats, {beats[-1]['end']:.2f} s)" if beats else ""))
        return play_both("CHAIN_A", "CHAIN_B")
    # No compiler: each beat is two separate blocking /play calls, so its length is the whole of the slower
    # motion (lead, trajectory, hold, return). The plan is published BEFORE anything moves, so the screen
    # already knows how long to stretch each beat.
    plan = fallback_beat_plan(ours, theirs)
    if job is not None and plan:
        job["beats"] = plan; job["lead"] = 0.0; job["tail"] = 0.0; job["source"] = "per-beat"
        job["done_beats"] = 0
    note("playing", "no JOUST_REPO: playing the beats one at a time"
         + (f" ({plan[-1]['end']:.2f} s of motion)" if plan else ""))
    out = []
    for i, (a, b) in enumerate(zip(ours, theirs)):
        out.append(play_both(a, b))                              # no compiler: one beat at a time
        # Each beat here is its own pair of BLOCKING /play calls, so the moment this returns is the exact
        # moment that beat finished on the metal. Publishing it lets the screen wait on the beat itself
        # instead of on a global busy flag -- which, with three beats fired back to back, would either miss
        # the gap between them or swallow the whole turn in one wait.
        if job is not None:
            job["done_beats"] = i + 1
            step(job, "playing", f"beat {i + 1} of {len(ours)} done on both arms")
    return out

def emote_moves(scene, swap):
    """Which motion each arm plays for a two-arm scene, and why.

    emote.py saves a scene as NAME (arm A's part, whose carriage channel is on axis X) and NAME@B (arm B's
    part, axis Y). A swap CANNOT simply cross the two over: `gantry_axis` is baked into the motion, so arm A
    playing NAME@B would stream arm B's rail. The file therefore also carries NAME_SWAP / NAME_SWAP@B -- the
    same two parts with the roles exchanged AND the axes put back on the right carriage. Use those when they
    exist, and fall back to the old cross-over (joints right, carriage channel skipped) when they do not."""
    if not swap: return scene, f"{scene}@B", "straight"
    names = tuned_names()
    if f"{scene}_SWAP" in names and f"{scene}_SWAP@B" in names:
        return f"{scene}_SWAP", f"{scene}_SWAP@B", "swapped (the _SWAP variant, carriage channels on their own axes)"
    return f"{scene}@B", scene, "swapped by crossing the parts over (no _SWAP variant for this scene)"

def prepare_hw(job):
    """Everything the hardware needs before a live fight: a REFERENCED gantry, both carriages at the apart
    stop, both arms at rest. This is the slow one -- a GRBL reference sweep crawls both axes onto their
    switches at 150 mm/min -- so it reports every step and the bridge waits for it with a long timeout."""
    step(job, "checking", "asking the daemon which arms are there")
    st = daemon("a", "/status", timeout=8)
    if st.get("offline"): raise RuntimeError("the arm daemon is not answering: " + str(st.get("error") or st.get("reason")))
    missing = [k for k in ("A", "B") if _arm_entry(st, k).get("offline")]
    if missing: raise RuntimeError("arm " + " and ".join(missing) + " is not connected: nothing to prepare")
    g = gantry_state(st)
    if g.get("offline"): raise RuntimeError("this daemon reports no gantry: " + str(g.get("reason") or g.get("error")))
    if g.get("homed"):
        step(job, "homing", "the gantry is already referenced, skipping the sweep")
    else:
        step(job, "homing", "referencing the gantry: X then Y onto their switches, then the work zero")
        r = gantry_op("home", timeout=300)
        bad = failed(r, "gantry home")
        if bad: raise RuntimeError(bad)
    ok, g = gantry_settled(timeout=400)
    if not ok: raise RuntimeError(f"gantry never came back to Idle after homing (last: {json.dumps(g)})")
    step(job, "apart", "driving both carriages out to the apart stop")
    bad = failed(gantry_op("apart"), "gantry apart")
    if bad: raise RuntimeError(bad)
    ok, g = gantry_settled(where=gantry_stop("apart"))
    if not ok: raise RuntimeError(f"gantry never settled at the apart stop (last: {json.dumps(g)})")
    step(job, "rest", f"carriages Idle at X={g.get('x')} Y={g.get('y')}; both arms easing to rest")
    rest = both_rest()
    step(job, "ready", "gantry referenced and apart, both arms at rest")
    return {"gantry": gantry_state(), "rest": rest}

def gantry_settled(timeout=90, where=None, tol=2.0):
    """Wait until the gantry is actually Idle -- and, when `where` is given, actually THERE.

    The daemon's /gantry/* already blocks until its move returns, but "the request came back" and "the
    machine has stopped at the target" are not the same sentence, and the screen must not move on between
    them. While the gantry holds its own lock its status is the short shape ({connected, homed, busy: true})
    with no x / y, so being busy and being unreadable look alike: both mean keep waiting.
    Returns (ok, last state)."""
    end = time.time() + timeout
    g = {}
    while time.time() < end:
        g = gantry_state()
        if g.get("offline"): return False, g
        if not g.get("busy") and g.get("state") in (None, "Idle"):
            if where is None: return True, g
            if g.get("x") is None: return True, g          # a daemon that does not report position
            if abs(g["x"] - where["X"]) <= tol and abs(g["y"] - where["Y"]) <= tol: return True, g
        time.sleep(0.1)
    return False, g

def gantry_stop(op):
    """Where `together` and `apart` actually are, read from the daemon's own reply if it tells us."""
    return {"together": {"X": 0.0, "Y": 0.0}, "apart": {"X": 195.0, "Y": 195.0}}.get(op)

def carriages(job, op, feed=None):
    """The charge and the retreat. `together` is the 19.5 in stop where the blades can actually meet;
    `apart` is 195 mm, the parked position. Both block on the daemon, and then we confirm the machine really
    is Idle at the stop before the job -- and so the screen -- moves on."""
    word = "closing to the together stop" if op == "together" else "backing out to the apart stop"
    step(job, op, "carriages " + word)
    # The gantry is one serial port behind one lock, and a phase fired while the previous one is still
    # draining gets a flat 409 "gantry busy". That is a timing graze, not a fault, so wait it out and ask
    # again rather than failing a phase of the show over it.
    for attempt in range(3):
        r = gantry_op(op, {"feed": feed} if feed else None)
        if r.get("status") != 409 and "busy" not in str(r.get("error", "")).lower(): break
        step(job, op, f"the gantry was still busy, waiting (attempt {attempt + 1})")
        gantry_settled(timeout=30)
    bad = failed(r, "gantry " + op)
    if bad: raise RuntimeError(bad)
    ok, g = gantry_settled(where=gantry_stop(op))
    if not ok: raise RuntimeError(f"gantry {op}: never settled at the stop (last: {json.dumps(g)})")
    step(job, "done", f"Idle at X={g.get('x')} Y={g.get('y')}")
    return {**r, "gantry": g}

def abort_all():
    """The big red button: stop every arm where it stands and reset the gantry. Deliberately NOT a job --
    it must answer immediately even while three other jobs are blocked on the daemon."""
    out = {}
    out["arms"] = daemon("a", "/abort", {"arm": "both"}, timeout=8)
    if ARMS.get("b") != ARMS.get("a"): out["armsB"] = daemon("b", "/abort", {"arm": "both"}, timeout=8)
    out["gantry"] = gantry_op("abort", timeout=15)
    # A gantry abort throws the reference away on purpose (GRBL was reset), so say so out loud.
    out["note"] = "arms stopped where they are; the gantry was reset and must be re-homed (Prepare arms)"
    return out

def api(path, body, query=None):
    query = query or {}
    if path == "/api/status":
        return arm_status()
    if path == "/api/play":
        side, move = body.get("side", "a"), body["move"]
        return log("play", f"{side}: {move}", lambda job: daemon(side, "/play", {"move": move, "scale": float(body.get("scale", 1.0)), "repeat": 1}, timeout=180))
    if path == "/api/emote":
        # A two-arm emote scene, played on both arms at once. On hardware the scene's carriage channel
        # (gantry_mm / gantry_axis) rides along with the arm samples -- see arm_daemon.py's GantryStream --
        # so the opener really is the two carriages charging in. Non-blocking and logged like /api/play.
        scene = str(body.get("scene", "")).strip()
        if not scene: return {"error": "no scene"}
        swap = bool(body.get("swap", False)); scale = float(body.get("scale", 1.0))
        move_a, move_b, how = emote_moves(scene, swap)
        return log("emote", f"{scene} [{how}]: a={move_a} b={move_b}",
                   lambda job: play_both(move_a, move_b, scale))
    if path == "/api/exchange":
        ours, theirs = body.get("ours", []), body.get("theirs", [])
        return log("exchange", " ".join(map(str, ours)) + " vs " + " ".join(map(str, theirs)),
                   lambda job: exchange(ours, theirs, job))
    if path == "/api/prepare":
        return log("prepare", "prepare the hardware for a live fight", prepare_hw)
    if path == "/api/charge":
        feed = body.get("feed")
        return log("charge", "carriages together", lambda job: carriages(job, "together", feed))
    if path == "/api/retreat":
        feed = body.get("feed")
        return log("retreat", "carriages apart", lambda job: carriages(job, "apart", feed))
    if path == "/api/abort":
        return abort_all()
    if path == "/api/home":
        return log("home", "both arms to rest", lambda job: both_rest())
    if path == "/api/moves":
        # Every move's REAL timing on both arms. The front end sizes a live beat off this instead of
        # assuming the move library's nominal 1.4 s, which is only the trajectory's share of a /play.
        return {"scale": 1.0, "constants": {"rate": RATE, "ease_speed": EASE_SPEED, "hold_end": HOLD_END,
                                            "return_speed": RETURN_SPEED, "settle": SETTLE},
                "moves": moves_table(float((query.get("scale") or ["1"])[0]))}
    if path == "/api/job":
        return find_job((query.get("id") or [""])[0])
    if path == "/api/jobs":
        with jobs_lock: return jobs[:30]
    return {"error": "unknown " + path}

# ---------------------------------------------------------------------------------------------------------
# Phone multiplayer: a mailbox and a relay.
#
# The big screen (index.html) is the HOST and the only place the rules run. It creates a room, shows two QR
# codes, and from then on it PUBLISHES a view of the fight (a public part both phones may see, and a private
# part per side) and READS the actions the phones post back. Phones are thin clients: they render what the
# host published and send {join, deck, lock, ready}. Nothing here knows the rules, and a phone can never be
# served the other side's private view -- the token decides which side you are.
#
# Long-polling: one Condition guards everything. A publish bumps room["rev"], an action bumps room["seq"],
# and both notify_all(); a waiter sleeps on the Condition (which releases the lock) until its number moves or
# `wait` seconds pass. No busy loops, no sockets to keep open, and a dropped phone just re-polls.
# ---------------------------------------------------------------------------------------------------------
ROOM_TTL = 3 * 3600          # a room dies 3 hours after the last publish / action
MAX_ROOMS = 40
CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # no I / O: they read as 1 / 0 on a phone
MAX_WAIT = 30.0

rooms = {}                                   # code -> room dict
tokens = {}                                  # token -> (code, side)
retired = {}                                 # token -> (code, side) for a seat the host reissued: 410, not 404
mp_cv = threading.Condition()                # guards rooms + tokens, and is the long-poll wakeup

def _lan_ip():
    """The address of the default-route interface: what a phone on the same Wi-Fi must dial."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        try: return socket.gethostbyname(socket.gethostname())
        except Exception: return "127.0.0.1"

PORT = [8770]                                # filled in by __main__ so the links carry the real port
def _ngrok_url():
    """The public https address of a running ngrok tunnel to this port (ngrok's local API on :4040), or ''."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=0.4) as r: tunnels = json.load(r).get("tunnels", [])
        mine = [t for t in tunnels if str(t.get("config", {}).get("addr", "")).rstrip("/").endswith(f":{PORT[0]}")]
        for t in mine or tunnels:
            u = t.get("public_url", "")
            if u.startswith("https://"): return u.rstrip("/")
        return (mine or tunnels)[0]["public_url"].rstrip("/") if (mine or tunnels) else ""
    except Exception: return ""

def public_base():
    """Where the phones should go: PUBLIC_URL if set, else a running ngrok tunnel (looked up fresh each time, so
    restarting ngrok needs no server restart), else this machine's LAN address."""
    p = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")
    return p or _ngrok_url() or f"http://{_lan_ip()}:{PORT[0]}"

def _drop(code):
    """Forget one room and every ticket that pointed at it (call with mp_cv held)."""
    r = rooms.pop(code, None)
    if not r: return
    for t in r["tokens"].values(): tokens.pop(t, None)
    for t in [t for t, ref in retired.items() if ref[0] == code]: retired.pop(t, None)

def _reap():
    """Drop idle rooms (call with mp_cv held)."""
    now = time.time()
    for code in [c for c, r in rooms.items() if now - r["touched"] > ROOM_TTL]: _drop(code)
    while len(rooms) > MAX_ROOMS: _drop(min(rooms, key=lambda c: rooms[c]["touched"]))   # oldest first

def _urls(tok):
    base = public_base()
    return base, {s: f"{base}/play/?t={tok[s]}" for s in ("a", "b")}

def mp_create():
    with mp_cv:
        _reap()
        for _ in range(200):
            code = "".join(random.choice(CODE_LETTERS) for _ in range(4))
            if code not in rooms: break
        else: return 503, {"error": "no free room code"}
        tok = {s: secrets.token_urlsafe(12) for s in ("a", "b")}   # ~16 chars of url-safe randomness
        rooms[code] = {"code": code, "tokens": tok, "rev": 0, "seq": 0, "public": {}, "private": {"a": {}, "b": {}},
                       "acts": [], "created": time.time(), "touched": time.time(),
                       # when each seat's phone was last heard from (a poll or an action): the host's Host
                       # Controls panel turns this into "connected / 14 s ago / never" for each side.
                       "seen": {"a": 0.0, "b": 0.0}}
        for s, t in tok.items(): tokens[t] = (code, s)
    base, urls = _urls(tok)
    return 200, {"code": code, "tokens": tok, "base": base, "urls": urls}

def mp_adopt(code):
    """Take a room back after the big screen was reloaded. The host reads its tokens (and so its QR links)
    back out of the server, re-attaches its long-poll and republishes; the phones never notice."""
    with mp_cv:
        r = rooms.get(code)
        if not r: return 404, {"error": "no such room"}
        r["touched"] = time.time()
        tok = dict(r["tokens"]); seen = dict(r["seen"]); rev, seq = r["rev"], r["seq"]
    base, urls = _urls(tok)
    return 200, {"code": code, "tokens": tok, "base": base, "urls": urls,
                 "rev": rev, "seq": seq, "seen": seen, "now": time.time()}

def mp_reissue(code, body):
    """One seat gets a brand new ticket; the old one is retired, not deleted, so the phone holding it can be
    told WHY it stopped working. The seat's name, deck and state stay with the host -- only the ticket moves."""
    side = str((body or {}).get("side", "")).lower()
    if side not in ("a", "b"): return 400, {"error": "side must be a or b"}
    with mp_cv:
        r = rooms.get(code)
        if not r: return 404, {"error": "no such room"}
        old = r["tokens"][side]
        new = secrets.token_urlsafe(12)
        tokens.pop(old, None); retired[old] = (code, side)
        r["tokens"][side] = new; tokens[new] = (code, side)
        r["seen"][side] = 0.0                      # nobody is on this seat until the new phone polls
        r["touched"] = time.time()
        mp_cv.notify_all()                         # wake the old phone's long-poll so it sees the 410 at once
        tok = dict(r["tokens"])
    base, urls = _urls(tok)
    return 200, {"side": side, "token": new, "url": urls[side], "urls": urls, "tokens": tok, "base": base}

def mp_swap(code):
    """The two phones trade colours. The tickets move, not the people: whoever holds the red ticket now polls
    as side b. The host swaps its own per-side names and decks to match, so each player keeps their identity."""
    with mp_cv:
        r = rooms.get(code)
        if not r: return 404, {"error": "no such room"}
        ta, tb = r["tokens"]["a"], r["tokens"]["b"]
        r["tokens"] = {"a": tb, "b": ta}
        tokens[tb] = (code, "a"); tokens[ta] = (code, "b")
        r["seen"] = {"a": r["seen"].get("b", 0.0), "b": r["seen"].get("a", 0.0)}
        r["private"] = {"a": r["private"].get("b") or {}, "b": r["private"].get("a") or {}}
        r["touched"] = time.time()
        mp_cv.notify_all()
        tok = dict(r["tokens"])
    base, urls = _urls(tok)
    return 200, {"tokens": tok, "urls": urls, "base": base}

def mp_state(code):
    """A cheap, token-free poll for the host's Host Controls panel: who is still out there, and how stale."""
    with mp_cv:
        r = rooms.get(code)
        if not r: return 404, {"error": "no such room"}
        out = {"code": code, "rev": r["rev"], "seq": r["seq"], "seen": dict(r["seen"]),
               "now": time.time(), "created": r["created"], "touched": r["touched"]}
        tok = dict(r["tokens"])
    out["urls"] = _urls(tok)[1]
    return 200, out

def mp_publish(code, body):
    with mp_cv:
        r = rooms.get(code)
        if not r: return 404, {"error": "no such room"}
        r["rev"] = int(body.get("rev") or 0) or r["rev"] + 1
        r["public"] = body.get("public") or {}
        priv = body.get("private") or {}
        r["private"] = {"a": priv.get("a") or {}, "b": priv.get("b") or {}}
        r["touched"] = time.time()
        mp_cv.notify_all()
        return 200, {"ok": True, "rev": r["rev"]}

def mp_player(token, since, wait):
    with mp_cv:
        ref = tokens.get(token)
        if not ref:
            # a seat the host reissued: say so, so the phone can print "this seat was reissued" and stop
            if token in retired: return 410, {"error": "reissued"}
            return 404, {"error": "bad token"}
        code, side = ref
        deadline = time.time() + wait
        while True:
            r = rooms.get(code)
            if not r: return 404, {"error": "room closed"}
            if tokens.get(token) != ref:                       # reissued (or swapped) while we were waiting
                if token in retired: return 410, {"error": "reissued"}
                break
            r["seen"][side] = time.time()                      # this phone is alive: the host's panel reads it
            if r["rev"] > since or wait <= 0 or time.time() >= deadline: break
            mp_cv.wait(max(0.05, min(1.0, deadline - time.time())))
        code, side = tokens.get(token, ref)                    # a swap may have moved this ticket's colour
        r = rooms.get(code)
        if not r: return 404, {"error": "room closed"}
        r["seen"][side] = time.time()
        return 200, {"side": side, "code": code, "rev": r["rev"], "public": r["public"],
                     "private": r["private"].get(side) or {}, "seen": dict(r["seen"]), "now": time.time()}

def mp_act(token, body):
    with mp_cv:
        ref = tokens.get(token)
        if not ref:
            if token in retired: return 410, {"error": "reissued"}
            return 404, {"error": "bad token"}
        code, side = ref
        r = rooms.get(code)
        if not r: return 404, {"error": "room closed"}
        act = dict(body or {}); act["side"] = side; r["seq"] += 1
        act["seq"] = r["seq"]; act["t"] = time.time()
        r["acts"].append(act); del r["acts"][:-200]
        r["touched"] = time.time(); r["seen"][side] = act["t"]
        mp_cv.notify_all()
        return 200, {"ok": True, "seq": act["seq"]}

def mp_acts(code, since, wait):
    with mp_cv:
        deadline = time.time() + wait
        while True:
            r = rooms.get(code)
            if not r: return 404, {"error": "no such room"}
            if r["seq"] > since or wait <= 0 or time.time() >= deadline: break
            mp_cv.wait(max(0.05, min(1.0, deadline - time.time())))
        # `seen` rides along on every acts poll, so even a host that never opens the panel knows within one
        # long-poll whether a phone is still out there.
        return 200, {"seq": r["seq"], "acts": [a for a in r["acts"] if a["seq"] > since],
                     "seen": dict(r["seen"]), "now": time.time()}

def qr_svg(text, box=8, border=2):
    """A QR code as an SVG path, dark modules merged into horizontal runs. Raises if `qrcode` is missing."""
    import qrcode
    q = qrcode.QRCode(border=border, box_size=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(text); q.make(fit=True)
    m = q.get_matrix(); n = len(m); d = []
    for y, row in enumerate(m):
        x = 0
        while x < n:
            if row[x]:
                x2 = x
                while x2 < n and row[x2]: x2 += 1
                d.append(f"M{x} {y}h{x2 - x}v1h-{x2 - x}z"); x = x2
            else: x += 1
    px = n * box
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 {n} {n}" '
            f'shape-rendering="crispEdges" role="img" aria-label="QR code">'
            f'<rect width="{n}" height="{n}" fill="#fff"/><path d="{"".join(d)}" fill="#1b120c"/></svg>')

def mp_api(method, path, query, body):
    """-> (status, obj) for every /api/mp/* route, or None if the path is not ours."""
    p = [x for x in path.split("/") if x]          # ['api','mp',...]
    if len(p) < 3 or p[0] != "api" or p[1] != "mp": return None
    q = lambda k, d="": (query.get(k) or [d])[0]
    wait = max(0.0, min(MAX_WAIT, float(q("wait", "0") or 0)))
    if p[2] == "rooms" and len(p) == 3 and method == "POST": return mp_create()
    if p[2] == "rooms" and len(p) == 5:
        code = p[3].upper()
        if p[4] == "publish" and method == "POST": return mp_publish(code, body)
        if p[4] == "acts" and method == "GET": return mp_acts(code, int(q("since", "0") or 0), wait)
        if p[4] == "state" and method == "GET": return mp_state(code)
        if p[4] == "adopt" and method == "POST": return mp_adopt(code)
        if p[4] == "reissue" and method == "POST": return mp_reissue(code, body)
        if p[4] == "swap" and method == "POST": return mp_swap(code)
    if p[2] == "p" and len(p) == 4 and method == "GET": return mp_player(p[3], int(q("rev", "0") or 0), wait)
    if p[2] == "p" and len(p) == 5 and p[4] == "act" and method == "POST": return mp_act(p[3], body)
    return 404, {"error": "unknown " + path}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=HERE, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def _json(self, obj, status=200):
        b = json.dumps(obj, default=str).encode(); self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _send(self, body, ctype, status=200):
        b = body.encode() if isinstance(body, str) else body
        self.send_response(status); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _mp(self, method, u, body):
        """True if this was a /api/mp/* request (already answered)."""
        if u.path == "/api/mp/qr.svg":
            text = (parse_qs(u.query).get("text") or [""])[0]
            if not text: return self._json({"error": "no text"}, 400) or True
            try: self._send(qr_svg(text), "image/svg+xml")
            except Exception as e: self._json({"error": "qr unavailable: " + str(e)}, 501)
            return True
        r = mp_api(method, u.path, parse_qs(u.query), body)
        if r is None: return False
        status, obj = r; self._json(obj, status); return True
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/mp/"):
            try:
                if self._mp("GET", u, {}): return
            except (BrokenPipeError, ConnectionResetError): return   # a phone walked away mid long-poll
        if u.path.startswith("/api/"): return self._json(api(u.path, {}, parse_qs(u.query)))
        return super().do_GET()
    def do_POST(self):
        u = urlparse(self.path); n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        if u.path.startswith("/api/mp/"):
            try:
                if self._mp("POST", u, body): return
            except (BrokenPipeError, ConnectionResetError): return
        return self._json(api(u.path, body))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    PORT[0] = port
    host = os.environ.get("HOST", "0.0.0.0")      # phones need to reach this box, so bind every interface
    lan = _lan_ip()
    print(f"Tilt of Tiltford on http://localhost:{port}   arms: {ARMS}   repo: {REPO or '(none: per-beat fallback)'}")
    if host != "127.0.0.1":
        print(f"  on this network: http://{lan}:{port}     phones join at {public_base()}/play/?t=<token>")
    if os.environ.get("PUBLIC_URL"): print(f"  PUBLIC_URL (QR codes point here): {public_base()}")
    try: import qrcode; print("  QR codes: server-side (python qrcode)")
    except Exception: print("  QR codes: python `qrcode` not importable -- /api/mp/qr.svg will 501")
    ThreadingHTTPServer((host, port), H).serve_forever()
