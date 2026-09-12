#!/usr/bin/env python3
"""End-to-end rehearsal: the whole live path, with no hardware anywhere near it.

    python3 tests/rehearse_live.py                 # fast: the per-beat fallback, ~30 s
    python3 tests/rehearse_live.py --repo          # also compile the chains with sim/chain.py (slower)
    python3 tests/rehearse_live.py --speed 1       # real timing, for watching it happen
    python3 tests/rehearse_live.py --keep          # leave both processes up afterwards

It starts tools/mock_daemon.py and a real server.py wired to it exactly the way start_live.sh wires the real
thing, then drives one whole turn plus an opener and a finale through the HTTP API and checks two things the
unit tests cannot:

  * THE SEQUENCE. Every request the game made reaches the mock, and the mock logs it. The rehearsal asserts
    the real order -- prepare (status, home, apart, rest x2), the opener, charge -> together, the beats,
    retreat -> apart, home, the finale -- against that log, not against what server.py believes it sent.
  * THE WAITS. While each phase runs, the rehearsal polls /api/status the way the browser bridge does, and
    asserts it actually SAW `busy` before the phase finished. That is the difference between the game waiting
    for the metal and the game counting to three: a phase that never showed busy would pass a timing test and
    fail the show.

It also checks the two things that are easy to get silently wrong: that an emote streams its carriage channel
on BOTH axes in time with the arms, and that a swapped finale uses the _SWAP variants (so each arm drives its
own rail), and finally that a missing arm is refused rather than half-played.
"""
import argparse
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
JOUST = os.path.dirname(HERE)
REPO = os.path.expanduser(os.environ.get("JOUST_REPO", "") or (os.path.join(JOUST, "..") if os.path.exists(os.path.join(JOUST, "..", "arm", "motions_tuned.json")) else os.path.join(JOUST, "..", "robot-jousting")))   # joust/ lives inside the repo

FAILURES = []
CHECKS = [0]
MARGINS = []          # (phase, daemon idle at, screen released at, margin s)

# The pacing constants are read straight out of bridge.js so this script and the browser cannot drift apart.
_BRIDGE = open(os.path.join(JOUST, "src", "hw", "bridge.js")).read()
def _js_const(name, default):
    m = re.search(r"const %s = (\d+)" % name, _BRIDGE)
    return int(m.group(1)) if m else default
BEAT_MARGIN_MS = _js_const("BEAT_MARGIN_MS", 250)
NOMINAL_BEAT_MS = _js_const("NOMINAL_BEAT_MS", 1400)


# ---- tiny test harness -----------------------------------------------------------------------------------
def check(ok, what, detail=""):
    CHECKS[0] += 1
    if ok:
        print(f"  ok    {what}")
    else:
        print(f"  FAIL  {what}\n        {detail}")
        FAILURES.append(f"{what}: {detail}")
    return ok


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def post(url, body=None, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return json.load(e)


def wait_up(url, secs=25):
    end = time.time() + secs
    while time.time() < end:
        try:
            get(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.2)
    return False


class Watcher(threading.Thread):
    """Polls /api/status exactly as the browser bridge does, in the background, and keeps the trace. That is
    what lets this script say when the metal actually went quiet -- measured, not modelled."""

    def __init__(self, game, period=0.05):
        super().__init__(daemon=True)
        self.game, self.period, self.samples, self.stop = game, period, [], False

    def run(self):
        while not self.stop:
            t = time.time()
            try:
                s = get(self.game + "/api/status", timeout=5)
                g = s.get("gantry") or {}
                busy = bool(s["armA"].get("busy") or s["armB"].get("busy")
                            or g.get("busy") or g.get("state") in ("Run", "Home"))
                self.samples.append((t, busy))
            except Exception:
                pass
            time.sleep(self.period)

    def last_busy(self, t_from, t_to):
        """The last moment in the window at which anything was still moving, or None if nothing ever was."""
        busy = [t for t, b in self.samples if b and t_from <= t <= t_to]
        return max(busy) if busy else None


def margin(phase, t_from, t_release, watcher):
    """How far BEHIND the metal the screen released this phase. Negative means the screen ran ahead, which is
    the one thing that must never happen.

    The window ends AT the release, never after it: beats run back to back, so looking even half a second
    past the release picks up the NEXT beat's busy samples and reports a phantom overrun. Whether the metal
    had really stopped is a separate question, asked explicitly below."""
    last = watcher.last_busy(t_from, t_release)
    if last is None:
        MARGINS.append((phase, None, t_release, None))
        return None
    m = t_release - last
    MARGINS.append((phase, last, t_release, m))
    check(m >= -watcher.period, f"[{phase}] the screen released AFTER the metal stopped (margin {m * 1000:+.0f} ms)",
          f"released {(-m) * 1000:.0f} ms before the last busy sample")
    return m


def quiet_margin(phase, t_from, t_release, watcher):
    """For a phase after which the metal really is expected to be quiet (a scene, a gantry move, the last
    beat): the margin, plus a check that nothing was still moving when the screen moved on."""
    m = margin(phase, t_from, t_release, watcher)
    still = [t for t, b in watcher.samples if b and t_release < t <= t_release + 0.3]
    check(not still, f"[{phase}] nothing was still moving when the screen moved on",
          f"{len(still)} busy samples in the 300 ms after the release")
    return m


def beat_margin(i, t_release, daemon_done, watcher):
    """A beat in the middle of a turn never has a quiet moment -- the next beat starts on top of it -- so the
    reference is when the DAEMON finished that beat, which is when the next beat's /play hit the mock."""
    m = t_release - daemon_done
    MARGINS.append((f"beat {i + 1}", daemon_done, t_release, m))
    check(m >= -watcher.period,
          f"[beat {i + 1}] the screen released AFTER the arms finished it (margin {m * 1000:+.0f} ms)",
          f"released {(-m) * 1000:.0f} ms before the arms had finished the beat")
    return m


class Rig:
    """A mock daemon and a real server.py wired to it, the way start_live.sh wires the real pair."""

    def __init__(self, speed, use_repo, fail=""):
        self.arm_port = free_port()
        self.game_port = free_port()
        self.arm = f"http://127.0.0.1:{self.arm_port}"
        self.game = f"http://127.0.0.1:{self.game_port}"
        self.speed = speed
        self.procs = []
        cmd = [sys.executable, os.path.join(JOUST, "tools", "mock_daemon.py"),
               "--port", str(self.arm_port), "--speed", str(speed)]
        if fail:
            cmd += ["--fail", fail]
        self.procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           stdin=subprocess.DEVNULL, text=True))
        if not wait_up(self.arm + "/status"):
            raise SystemExit("the mock daemon never came up")
        env = dict(os.environ, ARM_A_URL=self.arm, ARM_B_URL=self.arm, HOST="127.0.0.1")
        env["JOUST_REPO"] = REPO if use_repo else ""
        self.procs.append(subprocess.Popen([sys.executable, os.path.join(JOUST, "server.py"), str(self.game_port)],
                                           env=env, cwd=JOUST, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                           stdin=subprocess.DEVNULL, text=True))
        if not wait_up(self.game + "/api/status"):
            raise SystemExit("the game server never came up")

    # -- the browser's half of the conversation -------------------------------------------------------------
    def status(self):
        return get(self.game + "/api/status", timeout=10)

    def job(self, jid):
        return get(f"{self.game}/api/job?id={jid}", timeout=10)

    def log(self):
        return get(self.arm + "/mock/log", timeout=10)["log"]

    def reset_log(self):
        # The mock stamps its log relative to this moment, so remember it and we can put its entries back on
        # the same wall clock as everything else.
        self.t_reset = time.time()
        post(self.arm + "/mock/reset")

    def run_phase(self, path, body=None, timeout=180):
        """POST a job and watch it exactly as ArmBridge does: poll the job, and poll /api/status alongside so
        we can prove the phase really was busy while it ran. Returns (job, saw_busy, seconds)."""
        started = post(self.game + path, body or {}, timeout=30)
        if "job" not in started:
            return started, False, 0.0
        t0 = time.time()
        saw_busy = False
        while time.time() - t0 < timeout:
            j = self.job(started["job"])
            try:
                s = self.status()
                g = s.get("gantry") or {}
                # A gantry that is mid-move holds its own lock, and the daemon then answers the SHORT status
                # shape -- {connected, homed, busy: true, last} with no state / x / y. Both shapes count.
                if s["armA"].get("busy") or s["armB"].get("busy") or g.get("busy") or g.get("state") in ("Run", "Home"):
                    saw_busy = True
            except Exception:
                pass
            if j.get("status") and j["status"] != "running":
                return j, saw_busy, time.time() - t0
            time.sleep(0.1)
        return {"status": "timeout"}, saw_busy, time.time() - t0

    # -- the browser's own pacing, transcribed from src/hw/bridge.js -----------------------------------------
    # NOTE: this is a transcription, not the real thing -- the browser runs the real one, and the browser pass
    # is what confirms it. What this buys is a MEASUREMENT: every wait below is timed against the mock's
    # actual busy flags, so the margins table is observed rather than asserted.
    def wait_idle(self, timeout=200, grace=1.5):
        """ArmBridge.waitIdle: an idle reading only counts once busy has been seen, or after a grace."""
        t0 = time.time(); saw = False
        while time.time() - t0 < timeout:
            s = self.status()
            busy = bool(s["armA"].get("busy") or s["armB"].get("busy"))
            if busy: saw = True
            elif saw or time.time() - t0 > grace: return True
            time.sleep(0.1)
        return False

    def wait_gantry_idle(self, timeout=60):
        """ArmBridge.waitGantryIdle: a scene is not over when the arms stop if it moved the carriages."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            g = self.status().get("gantry") or {}
            if not g or g.get("offline") or not g.get("connected"): return True
            if not g.get("busy") and g.get("state") in (None, "Idle"): return True
            time.sleep(0.1)
        return False

    def screen_emote(self, scene, swap=False, timeout=300):
        """ArmBridge.emote: post, wait for the arms, THEN wait for the carriages."""
        t_start = time.time()
        started = post(self.game + "/api/emote", {"scene": scene, "swap": swap}, timeout=30)
        self.wait_idle(timeout=timeout)
        self.wait_gantry_idle()
        t_release = time.time()
        job = self.job(started["job"]) if "job" in started else {"status": "failed", "result": started}
        return job, t_start, t_release

    def screen_exchange(self, ours, theirs):
        """ArmBridge.startExchange + beat(i) x3. The beat clock is the server's schedule -- never 1.4 s.

        The `/ self.speed` corrections are a REHEARSAL artefact only: the mock compresses modelled seconds by
        --speed, while the real daemon runs in real time and the real bridge divides by nothing. At
        --speed 1 they vanish, which is why the reported margins are taken from a --speed 1 run."""
        started = post(self.game + "/api/exchange", {"ours": ours, "theirs": theirs}, timeout=30)
        t_seen, job = None, {}
        end = time.time() + 400
        while time.time() < end:
            job = self.job(started["job"])
            if job.get("phase") == "playing" or (job.get("status") and job["status"] != "running"):
                t_seen = time.time(); break
            time.sleep(0.1)
        beats = job.get("beats") or []
        lead, tail = float(job.get("lead") or 0), float(job.get("tail") or 0)
        source = job.get("source") or ""
        t0 = (t_seen or time.time()) + lead / self.speed
        released = []
        for i, b in enumerate(beats):
            due = t0 + b["end"] / self.speed + BEAT_MARGIN_MS / 1000.0
            now = time.time()
            if due > now: time.sleep(due - now)
            last = i == len(beats) - 1
            # The schedule sizes the animation; on the per-beat path the job's own beat counter is the
            # authority (ArmBridge.waitBeatDone), and the last beat additionally waits for idle.
            if source == "per-beat":
                end_b = time.time() + 200
                while time.time() < end_b:
                    j = self.job(started["job"])
                    if int(j.get("done_beats") or 0) > i: break
                    if j.get("status") and j["status"] != "running": break
                    time.sleep(0.05)
            if last: self.wait_idle(timeout=200)
            released.append(time.time())
        while time.time() < end:
            job = self.job(started["job"])
            if job.get("status") and job["status"] != "running": break
            time.sleep(0.1)
        return job, t_seen, t0, released, beats, lead, tail

    def close(self):
        for p in self.procs:
            try:
                p.terminate()
                p.wait(timeout=5)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass


def paths(log, kinds=("POST",)):
    return [e["path"] for e in log if e["kind"] in kinds]


def streams(log):
    return [e for e in log if e["kind"] == "gantry_stream"]


# ---- the rehearsal ---------------------------------------------------------------------------------------
def rehearse(rig, use_repo, watcher):
    print("\n-- prepare ------------------------------------------------------------------")
    rig.reset_log()
    s = rig.status()
    check(s["ready"]["ok"], "both arms answer before we start", json.dumps(s["ready"]))
    check(not s["ready"]["gantry"], "the gantry starts unreferenced, as it does after a power-up")
    t_start = time.time()
    job, busy, secs = rig.run_phase("/api/prepare", timeout=300)
    quiet_margin("prepare", t_start, time.time(), watcher)
    check(job["status"] == "done", "prepare finishes", str(job.get("result"))[:200])
    check([st["phase"] for st in job["steps"]] == ["checking", "homing", "apart", "rest", "ready"],
          "prepare reports checking -> homing -> apart -> rest -> ready",
          str([st["phase"] for st in job["steps"]]))
    check(busy, "the gantry really was moving while prepare ran (Home / Run seen on /api/status)")
    p = paths(rig.log())
    check(p == ["/gantry/home", "/gantry/apart", "/rest", "/rest"],
          "the daemon saw home -> apart -> rest -> rest, in that order", str(p))
    g = rig.status()["gantry"]
    check(g.get("homed") and abs(g.get("x", 0) - 195) < 1 and abs(g.get("y", 0) - 195) < 1,
          "the carriages are parked at the apart stop, referenced", json.dumps(g))

    print("\n-- the opener: En garde (arms AND carriages) --------------------------------")
    rig.reset_log()
    job, t_start, t_release = rig.screen_emote("EN_GARDE_OPENER")
    check(job["status"] == "done", "the opener plays", str(job.get("result"))[:200])
    quiet_margin("opener EN_GARDE_OPENER", t_start, t_release, watcher)
    # EN_GARDE_OPENER is 5.92 s of trajectory inside ~9.3 s of busy. The screen must sit through all of it.
    want = 9.33 / rig.speed
    check(t_release - t_start >= want * 0.8,
          f"the opener held the game for the whole scene ({t_release - t_start:.2f} s, scene is {want:.2f} s)",
          "the game moved on before the scene was over")
    log = rig.log()
    moves = [(e["body"].get("arm"), e["body"].get("move")) for e in log if e["path"] == "/play"]
    check(sorted(moves) == [("A", "EN_GARDE_OPENER"), ("B", "EN_GARDE_OPENER@B")],
          "arm A plays the scene and arm B plays its @B part", str(moves))
    st = streams(log)
    axes = set()
    for e in st:
        axes |= set(k for k in e["body"] if k in ("X", "Y"))
    check(len(st) >= 5, f"the carriage channel really streamed ({len(st)} segments)")
    check(axes == {"X", "Y"}, "BOTH carriages moved, on their own axes", str(axes))
    feeds = [e["feed"] for e in st]
    check(feeds and max(feeds) <= 24000.0, f"every segment stayed at or under the charge feed (peak {max(feeds):.0f})")
    g = rig.status()["gantry"]
    check(abs(g.get("x", 99)) < 1 and abs(g.get("y", 99)) < 1,
          "the opener ends with the carriages charged in at the together stop", json.dumps(g))

    print("\n-- charge -------------------------------------------------------------------")
    rig.reset_log()
    rig.run_phase("/api/retreat")             # put them back out so the charge has somewhere to come from,
    rig.wait_gantry_idle()                    # and let the machine actually settle before asking again
    rig.reset_log()
    t_start = time.time()
    job, busy, secs = rig.run_phase("/api/charge")
    quiet_margin("charge (carriages together)", t_start, time.time(), watcher)
    check(job["status"] == "done", "the charge finishes", str(job.get("result"))[:200])
    check(paths(rig.log())[0] == "/gantry/together", "the charge is one /gantry/together", str(paths(rig.log())))
    check("Idle at" in job["steps"][-1]["note"],
          "and it only reports done once the machine is Idle AT the stop", str(job["steps"][-1]))
    g = rig.status()["gantry"]
    check(abs(g.get("x", 99)) < 1 and abs(g.get("y", 99)) < 1, "the carriages arrived at the together stop", json.dumps(g))

    print("\n-- the exchange -------------------------------------------------------------")
    rig.reset_log()
    ours = ["ATTACK_HIGH", "BLOCK_LEFT", "REST"]
    theirs = ["BLOCK_HIGH", "ATTACK_LOW_LR", "REST"]
    t_start = time.time()
    job, t_seen, t0, released, beats, lead, tail = rig.screen_exchange(ours, theirs)
    check(job["status"] == "done", "the exchange finishes", str(job.get("result"))[:300])
    check(bool(beats), "the server published a beat schedule before anything swung", str(job.get("source")))
    log = rig.log()
    played = [(e["body"].get("arm"), e["body"].get("move")) for e in log if e["path"] == "/play"]
    plays = [e for e in log if e["path"] == "/play"]

    # The heart of it: no beat may be shorter than the move it is showing.
    for i, b in enumerate(beats):
        dur = b["end"] - b["start"]
        check(dur > NOMINAL_BEAT_MS / 1000.0,
              f"beat {i + 1} is sized at {dur:.2f} s, not the nominal {NOMINAL_BEAT_MS / 1000:.1f} s",
              f"beat {i + 1} would run the screen ahead of the arms")
        if b.get("pinned_at") is not None:
            check(b["start"] < b["pinned_at"] < b["end"],
                  f"beat {i + 1} lands its blow at {(b['pinned_at'] - b['start']) / dur:.2f} of the beat")
    # Per-beat margins. A middle beat is measured against the moment the DAEMON finished it (the next beat's
    # /play landing on the mock); the last beat is measured against the metal actually going quiet.
    beat_starts = [e["t"] for e in plays[::2]]
    for i, t_rel in enumerate(released):
        if not use_repo and i + 1 < len(beat_starts):
            beat_margin(i, t_rel, rig.t_reset + beat_starts[i + 1], watcher)
        elif i == len(released) - 1:
            quiet_margin(f"beat {i + 1} (last)", t0 if i == 0 else released[i - 1], t_rel, watcher)
        else:
            margin(f"beat {i + 1}", t0 if i == 0 else released[i - 1], t_rel, watcher)
    # Every beat must get its own stretch of wall clock. Waiting on a GLOBAL busy flag instead of on the
    # beat itself used to swallow the whole turn in beat 1's wait and then flash beats 2 and 3 past in
    # 400 ms each -- the opposite failure to running ahead, and just as wrong on screen.
    for i in range(1, len(released)):
        gap = (released[i] - released[i - 1]) * rig.speed
        planned = beats[i]["end"] - beats[i]["start"]
        check(gap >= planned * 0.5,
              f"beat {i + 1} got {gap:.2f} s of its own against a planned {planned:.2f} s",
              "the beats collapsed into each other instead of playing out one at a time")

    if use_repo:
        check(sorted(played) == [("A", "CHAIN_A"), ("B", "CHAIN_B")],
              "the compiled chains went to the two arms, one motion each", str(played))
        check(job.get("source") == "compiled", "the schedule came from the compiler", str(job.get("source")))
        check(any(abs(b["end"] - b["start"] - 1.4) > 0.05 for b in beats),
              "at least one beat is stretched -- which is why the screen must not count 3 x 1.4 s",
              str([round(b["end"] - b["start"], 2) for b in beats]))
    else:
        check(len(played) == 6, "no compiler: three beats, both arms each time", str(played))
        check([m for a, m in played if a == "A"] == ours, "arm A played our three moves in order", str(played))
        check([m for a, m in played if a == "B"] == theirs, "arm B played theirs in order", str(played))
        check(job.get("source") == "per-beat", "the schedule came from the measured per-move totals")
        # Per-beat path only: each beat is its own pair of blocking /play calls, so the mock's own log gives
        # the MEASURED length of every beat. Compare it with what the screen was told to show.
        # The plan is a model and the mock, like real metal, runs a little slower than the model (its ease
        # loop accumulates sleeps; the overhead is worst at high --speed). So the plan is checked for being
        # in the right ballpark, and the margins table above is what proves the screen never ran ahead --
        # the bridge waits on the busy flag after every beat on this path precisely because of that gap.
        starts = [plays[2 * i]["t"] for i in range(len(beats))]
        for i in range(len(beats) - 1):
            measured = (starts[i + 1] - starts[i]) * rig.speed
            planned = beats[i]["end"] - beats[i]["start"]
            check(planned >= measured * 0.75,
                  f"beat {i + 1}: planned {planned:.2f} s against {measured:.2f} s measured"
                  f" ({planned / measured * 100:.0f}% of it)",
                  "the schedule is far short of what the arms actually took")

    # Nothing may be quietly skipped: the whole turn has to take as long as the motions in it.
    total_model = beats[-1]["end"] + lead + tail
    measured_total = (time.time() - t_start) * rig.speed
    check(measured_total >= total_model * 0.85,
          f"the whole exchange took {measured_total:.2f} s of motion time against a planned {total_model:.2f} s",
          "something was skipped")

    print("\n-- the return ---------------------------------------------------------------")
    rig.reset_log()
    t_start = time.time()
    job, busy, secs = rig.run_phase("/api/retreat")
    quiet_margin("retreat (carriages apart)", t_start, time.time(), watcher)
    check(job["status"] == "done", "the retreat finishes")
    check(paths(rig.log()) == ["/gantry/apart"], "the return is one /gantry/apart", str(paths(rig.log())))
    g = rig.status()["gantry"]
    check(abs(g.get("x", 0) - 195) < 1, "the carriages are back at the apart stop", json.dumps(g))
    rig.reset_log()
    job, busy, secs = rig.run_phase("/api/home")
    check(job["status"] == "done", "both arms go home")
    check(sorted(paths(rig.log())) == ["/rest", "/rest"], "home is a /rest for each arm", str(paths(rig.log())))

    print("\n-- the finale: Samurai finish, swapped --------------------------------------")
    rig.reset_log()
    job, t_start, t_release = rig.screen_emote("SAMURAI_FINISH", swap=True)
    check(job["status"] == "done", "the finale plays", str(job.get("result"))[:200])
    quiet_margin("finale SAMURAI_FINISH", t_start, t_release, watcher)
    # SAMURAI_FINISH is 10.4 s of trajectory inside ~13 s of busy. The result screen waits for all of it.
    want = 13.04 / rig.speed
    check(t_release - t_start >= want * 0.8,
          f"the finale held the game for the whole scene ({t_release - t_start:.2f} s, scene is {want:.2f} s)",
          "the result screen would have come up over a still-dancing arm")
    log = rig.log()
    moves = [(e["body"].get("arm"), e["body"].get("move")) for e in log if e["path"] == "/play"]
    check(sorted(moves) == [("A", "SAMURAI_FINISH_SWAP"), ("B", "SAMURAI_FINISH_SWAP@B")],
          "a swap uses the _SWAP variants, so each arm still drives its OWN rail", str(moves))
    st = streams(log)
    axes = set()
    for e in st:
        axes |= set(k for k in e["body"] if k in ("X", "Y"))
    check(axes == {"X", "Y"}, "the finale streams both carriages too", str(axes))
    pre = [e for e in log if e["kind"] == "gantry_preposition"]
    pre_axes = set()
    for e in pre:
        pre_axes |= set(k for k in e["body"] if k in ("X", "Y"))
    check(pre_axes == {"X", "Y"},
          "each carriage was prepositioned to where its part of the scene starts, before the arms moved",
          str([e["body"] for e in pre]))
    check(all(e["i"] < min(x["i"] for x in st) for e in pre),
          "and prepositioning happened BEFORE the first streamed segment, not as a catch-up jump")

    print("\n-- abort --------------------------------------------------------------------")
    rig.reset_log()
    started = post(rig.game + "/api/emote", {"scene": "SAMURAI_FINISH"})
    time.sleep(1.0)                                   # let it get going
    t0 = time.time()
    out = post(rig.game + "/api/abort")
    check(time.time() - t0 < 5, f"abort answered immediately ({time.time() - t0:.2f} s)")
    check("job" not in out, "abort is not queued behind the emote")
    p = paths(rig.log())
    check("/abort" in p and "/gantry/abort" in p, "abort reached both the arms and the gantry", str(p))
    end = time.time() + 60
    while time.time() < end:
        s = rig.status()
        if not (s["armA"].get("busy") or s["armB"].get("busy")):
            break
        time.sleep(0.2)
    check(not (s["armA"].get("busy") or s["armB"].get("busy")), "the arms stopped", json.dumps(s["armA"]))
    check(not rig.status()["gantry"].get("homed"),
          "the gantry lost its reference, as a GRBL reset really does -- Prepare has to run again")
    check(rig.job(started["job"])["status"] in ("done", "failed"), "the aborted emote job ended")


def rehearse_missing_arm():
    """A live fight with one arm unplugged must be refused, not half-played."""
    print("\n-- a missing arm (mock --fail B) --------------------------------------------")
    rig = Rig(speed=8, use_repo=False, fail="B")
    try:
        s = rig.status()
        check(s["ready"]["missing"] == ["B"], "/api/status names the missing arm", json.dumps(s["ready"]))
        check(not s["ready"]["ok"], "the go/no-go says no")
        check(s["armB"]["offline"] and not s["armA"].get("offline"),
              "arm A is still fine -- one missing arm does not blind us to the other")
        rig.reset_log()
        job, _, _ = rig.run_phase("/api/prepare", timeout=60)
        check(job["status"] == "failed", "prepare refuses to run", str(job.get("result"))[:200])
        check("arm B" in str(job.get("result")), "and says which arm", str(job.get("result"))[:200])
        check(paths(rig.log()) == [], "nothing was commanded to move", str(paths(rig.log())))
    finally:
        rig.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", type=float, default=8.0, help="mock time compression (1 = real timing)")
    ap.add_argument("--repo", action="store_true", help="also compile the chains with sim/chain.py (slower)")
    ap.add_argument("--keep", action="store_true", help="leave the mock and the server running afterwards")
    args = ap.parse_args()

    t0 = time.time()
    rig = Rig(speed=args.speed, use_repo=args.repo)
    print(f"mock daemon {rig.arm}    game server {rig.game}    speed x{args.speed}"
          f"    chain compiler {'ON' if args.repo else 'off (per-beat fallback)'}")
    print(f"pacing constants read from src/hw/bridge.js: margin {BEAT_MARGIN_MS} ms, nominal beat {NOMINAL_BEAT_MS} ms")
    watcher = Watcher(rig.game)
    watcher.start()
    try:
        rehearse(rig, args.repo, watcher)
    finally:
        watcher.stop = True
        if not args.keep:
            rig.close()
        else:
            print(f"\nleft running: {rig.arm} and {rig.game}")
    rehearse_missing_arm()

    if MARGINS:
        print("\n-- margins: how far BEHIND the metal the screen released each phase ----------")
        print(f"   (measured against /api/status polled every {watcher.period * 1000:.0f} ms"
              f"{'; mock time compressed x%g' % args.speed if args.speed != 1 else ''})")
        print(f"   {'phase':28s} {'metal quiet at':>14s} {'screen released':>16s} {'margin':>10s}")
        worst = None
        for phase, last, rel, m in MARGINS:
            if m is None:
                print(f"   {phase:28s} {'(never busy)':>14s} {rel - t0:>15.2f}s {'-':>10s}")
                continue
            print(f"   {phase:28s} {last - t0:>13.2f}s {rel - t0:>15.2f}s {m * 1000:>+9.0f} ms")
            worst = m if worst is None else min(worst, m)
        if worst is not None:
            print(f"   worst margin: {worst * 1000:+.0f} ms  (negative would mean the screen ran ahead)")

    print("\n" + "=" * 78)
    if FAILURES:
        print(f"{len(FAILURES)} of {CHECKS[0]} checks FAILED in {time.time() - t0:.0f} s:")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print(f"all {CHECKS[0]} checks passed in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
