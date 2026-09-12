#!/usr/bin/env python3
"""What server.py sends to the arm daemon, and what it makes of the answer.

One daemon on :8766 drives BOTH arms: every POST body carries {"arm": "A"|"B"} and GET /status answers
{"arms": {"A": {...}, "B": {...}}, "gantry": {...}}. These tests never open a socket -- urlopen is replaced
with a recorder -- so they are safe to run while the real arms are powered up.

    python3 -m unittest discover -s tests -p 'test_*.py'      (or: python3 tests/test_server_requests.py)
"""
import io, json, os, sys, time, unittest, urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server


class Recorder:
    """Stands in for urllib.request.urlopen: remembers every request, answers with a canned reply."""
    def __init__(self, reply=None):
        self.sent = []
        self.reply = reply if reply is not None else {"ok": True}
    def __call__(self, req, timeout=None):
        body = req.data.decode() if req.data else None
        self.sent.append({"url": req.full_url, "method": req.get_method(),
                          "body": json.loads(body) if body else None})
        reply = self.reply(req) if callable(self.reply) else self.reply
        return io.BytesIO(json.dumps(reply).encode())
    def paths(self):
        """Just the daemon route of each request, in order: ['/status', '/gantry/home', ...]."""
        return [s["url"].split("8766", 1)[-1] if "8766" in s["url"] else s["url"] for s in self.sent]


def two_arms(gantry=None):
    """A healthy daemon /status: both arms idle, and whatever gantry state the test wants."""
    return {"arms": {"A": {"busy": False, "last": "at rest"}, "B": {"busy": False, "last": "at rest"}},
            "gantry": gantry if gantry is not None else
            {"connected": True, "homed": True, "state": "Idle", "pins": 0, "x": 195.0, "y": 195.0, "last": ""}}


def finish(started, timeout=5.0):
    """A /api/* route that drives metal answers {'ok', 'job'} and runs on a worker. Wait for that worker."""
    jid = started["job"]
    end = time.time() + timeout
    while time.time() < end:
        job = server.find_job(jid)
        if job.get("status") and job["status"] != "running":
            return job
        time.sleep(0.01)
    raise AssertionError(f"job {jid} never finished: {server.find_job(jid)}")


def phases(job):
    return [s["phase"] for s in job.get("steps", [])]


class ArmAddressing(unittest.TestCase):
    def test_side_b_defaults_to_the_same_daemon(self):
        self.assertEqual(server.ARMS["b"], server.ARMS["a"])
        self.assertTrue(server.ARMS["a"])

    def test_every_post_names_its_arm(self):
        rec = Recorder()
        with mock.patch.object(urllib.request, "urlopen", rec):
            server.daemon("a", "/play", {"move": "ATTACK_HIGH", "scale": 1.0})
            server.daemon("b", "/play", {"move": "BLOCK_HIGH"})
            server.daemon("b", "/rest", {})
        self.assertEqual([s["body"]["arm"] for s in rec.sent], ["A", "B", "B"])
        self.assertEqual(rec.sent[0]["body"]["move"], "ATTACK_HIGH")
        self.assertEqual(rec.sent[0]["method"], "POST")

    def test_an_explicit_arm_in_the_body_wins(self):
        rec = Recorder()
        with mock.patch.object(urllib.request, "urlopen", rec):
            server.daemon("a", "/nudge", {"arm": "B", "dq": [1, 0, 0]})
        self.assertEqual(rec.sent[0]["body"]["arm"], "B")

    def test_status_is_a_get_with_no_body(self):
        rec = Recorder({"arms": {"A": {"busy": False}, "B": {"busy": False}}})
        with mock.patch.object(urllib.request, "urlopen", rec):
            server.daemon("a", "/status")
        self.assertEqual(rec.sent[0]["method"], "GET")
        self.assertIsNone(rec.sent[0]["body"])

    def test_both_arms_are_played_in_one_exchange_beat(self):
        rec = Recorder()
        with mock.patch.object(urllib.request, "urlopen", rec):
            server.play_both("ATTACK_HIGH", "BLOCK_HIGH")
        got = sorted((s["body"]["arm"], s["body"]["move"]) for s in rec.sent)
        self.assertEqual(got, [("A", "ATTACK_HIGH"), ("B", "BLOCK_HIGH")])
        self.assertTrue(all(s["url"].endswith("/play") for s in rec.sent))

    def test_compiled_chain_goes_to_the_two_arms_by_name(self):
        rec = Recorder()
        with mock.patch.object(urllib.request, "urlopen", rec), mock.patch.object(server, "REPO", ""):
            server.exchange(["ATTACK_HIGH", "REST", "REST"], ["BLOCK_HIGH", "REST", "REST"])
        # no repo: the per-beat fallback, three beats, both arms each time
        self.assertEqual(len(rec.sent), 6)
        self.assertEqual({s["body"]["arm"] for s in rec.sent}, {"A", "B"})


class StatusShape(unittest.TestCase):
    TWO_ARM = {"arms": {"A": {"busy": True, "pose": "REST", "model": "so101"},
                        "B": {"busy": False, "pose": "GUARD"}},
               "gantry": {"A": 0.0, "B": 120.0}}

    def test_one_daemon_is_split_into_armA_and_armB(self):
        with mock.patch.object(urllib.request, "urlopen", Recorder(self.TWO_ARM)):
            s = server.arm_status()
        self.assertEqual(s["armA"]["busy"], True)
        self.assertEqual(s["armB"]["busy"], False)
        self.assertEqual(s["armB"]["pose"], "GUARD")
        self.assertEqual(s["gantry"], {"A": 0.0, "B": 120.0})

    def test_one_status_call_serves_both_sides(self):
        rec = Recorder(self.TWO_ARM)
        with mock.patch.object(urllib.request, "urlopen", rec):
            server.arm_status()
        self.assertEqual(len(rec.sent), 1, "both arms come from the one daemon, so one GET is enough")

    def test_a_missing_arm_reads_as_offline(self):
        with mock.patch.object(urllib.request, "urlopen", Recorder({"arms": {"A": {"busy": False}}})):
            s = server.arm_status()
        self.assertFalse(s["armA"].get("offline"))
        self.assertTrue(s["armB"]["offline"])

    def test_an_unreachable_daemon_marks_both_offline(self):
        def boom(req, timeout=None): raise OSError("connection refused")
        with mock.patch.object(urllib.request, "urlopen", boom):
            s = server.arm_status()
        self.assertTrue(s["armA"]["offline"])
        self.assertTrue(s["armB"]["offline"])
        self.assertIn("error", s["armA"])

    def test_two_separate_daemons_are_still_supported(self):
        def reply(req):
            return {"busy": req.full_url.startswith("http://x")}      # a single-arm daemon, flat shape
        rec = Recorder(reply)
        with mock.patch.dict(server.ARMS, {"a": "http://x:8766", "b": "http://y:8767"}), \
             mock.patch.object(urllib.request, "urlopen", rec):
            s = server.arm_status()
        self.assertEqual(len(rec.sent), 2, "two daemons means two GETs")
        self.assertTrue(s["armA"]["busy"])
        self.assertFalse(s["armB"]["busy"])


class ReadyToFight(unittest.TestCase):
    """/api/status has to answer one question before a live fight: is everything there?"""

    def test_status_carries_the_gantry_and_a_go_no_go(self):
        with mock.patch.object(urllib.request, "urlopen", Recorder(two_arms())):
            s = server.arm_status()
        self.assertTrue(s["ready"]["ok"])
        self.assertEqual(s["ready"]["missing"], [])
        self.assertTrue(s["ready"]["gantry"], "a referenced gantry reads as ready")
        self.assertEqual(s["gantry"]["x"], 195.0)

    def test_a_missing_arm_is_a_refusal(self):
        reply = {"arms": {"A": {"busy": False}}, "gantry": {"connected": True, "homed": True}}
        with mock.patch.object(urllib.request, "urlopen", Recorder(reply)):
            s = server.arm_status()
        self.assertEqual(s["ready"]["missing"], ["B"])
        self.assertFalse(s["ready"]["ok"])

    def test_an_unreferenced_gantry_is_not_a_refusal(self):
        """Prepare exists precisely to fix this, so it must not block the fight from starting."""
        with mock.patch.object(urllib.request, "urlopen", Recorder(two_arms({"connected": True, "homed": False}))):
            s = server.arm_status()
        self.assertTrue(s["ready"]["ok"])
        self.assertFalse(s["ready"]["gantry"])

    def test_no_gantry_at_all_reads_as_offline_not_as_a_crash(self):
        reply = {"arms": {"A": {"busy": False}, "B": {"busy": False}}}    # an older daemon, no gantry at all
        with mock.patch.object(urllib.request, "urlopen", Recorder(reply)):
            s = server.arm_status()
        self.assertTrue(s["gantry"]["offline"])
        self.assertTrue(s["ready"]["ok"], "the arms are what a fight needs; the gantry is Prepare's problem")


class Prepare(unittest.TestCase):
    """POST /api/prepare: reference the gantry if it is not referenced, carriages apart, both arms to rest."""

    def test_the_whole_sequence_in_order(self):
        rec = Recorder(lambda req: two_arms({"connected": True, "homed": False})
                       if req.get_method() == "GET" else {"ok": True, "last": "done"})
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/prepare", {}))
        self.assertEqual(job["status"], "done", job["result"])
        posts = [p for p in rec.paths() if p != "/status"]
        self.assertEqual(posts, ["/gantry/home", "/gantry/apart", "/rest", "/rest"])
        self.assertEqual(phases(job), ["checking", "homing", "apart", "rest", "ready"])

    def test_both_arms_are_rested_by_name(self):
        rec = Recorder(lambda req: two_arms() if req.get_method() == "GET" else {"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec):
            finish(server.api("/api/prepare", {}))
        rested = sorted(s["body"]["arm"] for s in rec.sent if s["url"].endswith("/rest"))
        self.assertEqual(rested, ["A", "B"])

    def test_an_already_referenced_gantry_is_not_swept_again(self):
        rec = Recorder(lambda req: two_arms() if req.get_method() == "GET" else {"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/prepare", {}))
        self.assertNotIn("/gantry/home", rec.paths())
        self.assertIn("/gantry/apart", rec.paths())
        self.assertIn("already referenced", " ".join(s["note"] for s in job["steps"]))

    def test_a_missing_arm_stops_prepare_before_anything_moves(self):
        rec = Recorder(lambda req: {"arms": {"A": {"busy": False}}, "gantry": {"connected": True, "homed": True}}
                       if req.get_method() == "GET" else {"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/prepare", {}))
        self.assertEqual(job["status"], "failed")
        self.assertIn("arm B", job["result"])
        self.assertEqual([p for p in rec.paths() if p != "/status"], [],
                         "nothing may be commanded to move when an arm is missing")

    def test_a_gantry_that_will_not_home_fails_the_job_loudly(self):
        def reply(req):
            if req.get_method() == "GET": return two_arms({"connected": True, "homed": False})
            if req.full_url.endswith("/gantry/home"): return {"error": "ALARM: hard limit"}
            return {"ok": True}
        with mock.patch.object(urllib.request, "urlopen", Recorder(reply)):
            job = finish(server.api("/api/prepare", {}))
        self.assertEqual(job["status"], "failed")
        self.assertIn("hard limit", job["result"])


TOG = server.gantry_stop("together"); TX, TY = TOG["X"], TOG["Y"]   # where this rig's together stop really is (arm/arms.json)

def arrived(x, y):
    """A daemon that answers every POST 'ok' and every /status with the gantry Idle at (x, y)."""
    return lambda req: (two_arms({"connected": True, "homed": True, "state": "Idle", "pins": 0, "x": x, "y": y})
                        if req.get_method() == "GET" else {"ok": True, "last": f"at X={x} Y={y}"})


class ChargeAndRetreat(unittest.TestCase):
    """The screen's charge and return phases, on the gantry. The daemon's reply only means the request came
    back; the phase is not over until the machine is Idle AT the stop, so both are checked."""

    def test_charge_drives_the_carriages_together_and_confirms_arrival(self):
        rec = Recorder(arrived(TX, TY))
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/charge", {}))
        self.assertEqual(job["status"], "done", job["result"])
        self.assertEqual(rec.paths()[0], "/gantry/together")
        self.assertIn("/status", rec.paths(), "the phase confirms the machine actually settled")
        self.assertEqual(phases(job), ["together", "done"])
        self.assertIn(f"Idle at X={TX}", job["steps"][-1]["note"])

    def test_retreat_drives_them_apart(self):
        rec = Recorder(arrived(195.0, 195.0))
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/retreat", {}))
        self.assertEqual(job["status"], "done", job["result"])
        self.assertEqual(rec.paths()[0], "/gantry/apart")

    def test_a_phase_that_never_reaches_the_stop_fails_instead_of_letting_the_screen_on(self):
        rec = Recorder(arrived(120.0, 120.0))       # stalled half way to the together stop
        orig = server.gantry_settled
        with mock.patch.object(urllib.request, "urlopen", rec), \
             mock.patch.object(server, "gantry_settled", lambda timeout=90, **k: orig(timeout=0.5, **k)):
            job = finish(server.api("/api/charge", {}), timeout=10)
        self.assertEqual(job["status"], "failed")
        self.assertIn("never settled", job["result"])

    def test_a_feed_is_passed_through(self):
        rec = Recorder(arrived(TX, TY))
        with mock.patch.object(urllib.request, "urlopen", rec):
            finish(server.api("/api/charge", {"feed": 6000}))
        self.assertEqual(rec.sent[0]["body"]["feed"], 6000)

    def test_an_unreferenced_gantry_fails_the_phase_instead_of_hanging(self):
        rec = Recorder({"error": "gantry not referenced: home it first"})
        with mock.patch.object(urllib.request, "urlopen", rec):
            job = finish(server.api("/api/charge", {}))
        self.assertEqual(job["status"], "failed")
        self.assertIn("not referenced", job["result"])


class DaemonReplies(unittest.TestCase):
    """A daemon that says no is not a daemon that is gone, and the difference decides whether the show
    carries on or drops back to sim."""

    def test_a_409_is_an_answer_not_an_outage(self):
        def busy(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 409, "Conflict", {},
                                         io.BytesIO(json.dumps({"error": "gantry busy"}).encode()))
        with mock.patch.object(urllib.request, "urlopen", busy):
            r = server.daemon("a", "/gantry/together", {})
        self.assertNotIn("offline", r, "the daemon answered; it just said no")
        self.assertEqual(r["status"], 409)
        self.assertEqual(r["error"], "gantry busy")

    def test_a_refused_connection_really_is_offline(self):
        def boom(req, timeout=None): raise OSError("connection refused")
        with mock.patch.object(urllib.request, "urlopen", boom):
            self.assertTrue(server.daemon("a", "/status").get("offline"))

    def test_a_busy_gantry_is_waited_out_and_retried(self):
        """A phase fired while the last one is still draining gets a flat 409. That is a timing graze, not a
        fault, and failing a phase of the show over it would be worse than waiting a moment."""
        calls = []
        def reply(req, timeout=None):
            if req.get_method() == "GET":
                return io.BytesIO(json.dumps(two_arms({"connected": True, "homed": True, "state": "Idle",
                                                       "pins": 0, "x": TX, "y": TY})).encode())
            calls.append(req.full_url)
            if len([c for c in calls if c.endswith("together")]) == 1:
                raise urllib.error.HTTPError(req.full_url, 409, "Conflict", {},
                                             io.BytesIO(json.dumps({"error": "gantry busy"}).encode()))
            return io.BytesIO(json.dumps({"ok": True, "last": "at X=0 Y=0"}).encode())
        with mock.patch.object(urllib.request, "urlopen", reply):
            job = finish(server.api("/api/charge", {}), timeout=60)
        self.assertEqual(job["status"], "done", job["result"])
        self.assertEqual(len([c for c in calls if c.endswith("together")]), 2, "it asked again")


class Abort(unittest.TestCase):
    def test_abort_stops_both_arms_and_resets_the_gantry_immediately(self):
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec):
            out = server.api("/api/abort", {})
        self.assertNotIn("job", out, "an abort must answer now, not queue behind whatever is blocked")
        self.assertEqual(rec.paths(), ["/abort", "/gantry/abort"])
        self.assertEqual(rec.sent[0]["body"]["arm"], "both")
        self.assertIn("re-homed", out["note"])


class EmoteScenes(unittest.TestCase):
    """A two-arm scene, and the one thing a swap must not get wrong: which carriage moves."""

    def test_straight_is_the_scene_and_its_at_B_part(self):
        self.assertEqual(server.emote_moves("EN_GARDE_OPENER", False)[:2],
                         ("EN_GARDE_OPENER", "EN_GARDE_OPENER@B"))

    def test_a_swap_uses_the_SWAP_variant_so_the_axes_stay_on_their_own_rail(self):
        # NAME_SWAP carries NAME@B's joints with gantry_axis put back to X (arm A's rail), and NAME_SWAP@B
        # the reverse. Crossing NAME / NAME@B over would hand arm A a channel labelled Y.
        names = {"S", "S@B", "S_SWAP", "S_SWAP@B"}
        with mock.patch.object(server, "tuned_names", lambda: names):
            a, b, how = server.emote_moves("S", True)
        self.assertEqual((a, b), ("S_SWAP", "S_SWAP@B"))
        self.assertIn("_SWAP", how)

    def test_a_scene_with_no_SWAP_variant_falls_back_to_crossing_the_parts(self):
        with mock.patch.object(server, "tuned_names", lambda: {"S", "S@B"}):
            a, b, how = server.emote_moves("S", True)
        self.assertEqual((a, b), ("S@B", "S"))
        self.assertIn("no _SWAP", how)

    def test_the_real_motion_file_really_has_the_SWAP_variants(self):
        names = server.tuned_names()
        if not names: self.skipTest("no motions_tuned.json next to this checkout")
        for scene in ("EN_GARDE_OPENER", "SAMURAI_FINISH"):
            for suffix in ("", "@B", "_SWAP", "_SWAP@B"):
                self.assertIn(scene + suffix, names)

    def test_the_scene_goes_to_both_arms_by_name(self):
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec), \
             mock.patch.object(server, "tuned_names", lambda: {"EN_GARDE_OPENER", "EN_GARDE_OPENER@B"}):
            finish(server.api("/api/emote", {"scene": "EN_GARDE_OPENER"}))
        got = sorted((s["body"]["arm"], s["body"]["move"]) for s in rec.sent)
        self.assertEqual(got, [("A", "EN_GARDE_OPENER"), ("B", "EN_GARDE_OPENER@B")])

    def test_an_empty_scene_is_refused_without_touching_the_daemon(self):
        rec = Recorder()
        with mock.patch.object(urllib.request, "urlopen", rec):
            self.assertIn("error", server.api("/api/emote", {"scene": "  "}))
        self.assertEqual(rec.sent, [])


class CompiledBeats(unittest.TestCase):
    """sim/chain.py stretches beats. The front end has to pace off the real boundaries, not off 3 x 1.4 s."""

    def test_beats_are_read_back_from_the_compiled_chains(self):
        import tempfile
        T = {"CHAIN_A": {"beats": [{"move": "ATTACK_HIGH", "start": 0.0, "end": 1.79},
                                   {"move": "BLOCK_LEFT", "start": 1.79, "end": 3.7}]},
             "CHAIN_B": {"beats": [{"move": "BLOCK_HIGH", "start": 0.0, "end": 1.75},
                                   {"move": "ATTACK_LOW_LR", "start": 1.75, "end": 3.7}]}}
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "arm"))
            with open(os.path.join(d, "arm", "motions_tuned.json"), "w") as f: json.dump(T, f)
            with mock.patch.object(server, "tuned_path", lambda: os.path.join(d, "arm", "motions_tuned.json")):
                beats = server.chain_beats()
        self.assertEqual([b["end"] for b in beats], [1.79, 3.7])
        self.assertNotEqual(beats[0]["end"], 1.4, "a compiled beat is stretched, that is the whole point")
        self.assertEqual(beats[0]["a"], "ATTACK_HIGH")
        self.assertEqual(beats[0]["b"], "BLOCK_HIGH")

    def test_no_compiled_chain_means_no_plan_and_the_bridge_falls_back(self):
        with mock.patch.object(server, "tuned_path", lambda: ""):
            self.assertIsNone(server.chain_beats())

    def test_the_exchange_job_reports_compiling_then_playing(self):
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec), mock.patch.object(server, "REPO", ""):
            job = finish(server.api("/api/exchange", {"ours": ["ATTACK_HIGH"], "theirs": ["BLOCK_HIGH"]}))
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["phase"], "done")
        self.assertIn("playing", phases(job))


class LiveBeatLength(unittest.TestCase):
    """The screen must never run ahead of the arms, and the arms are much slower than the nominal beat.

    A /play is not the length of the trajectory. The daemon eases to rest, eases into the first key, plays,
    HOLDS the last pose for 1.5 s and eases home at 60 deg/s. These tests pin that arithmetic to the real
    motion file, because it is what every live beat is sized from."""

    def setUp(self):
        if not server.tuned_json(): self.skipTest("no motions_tuned.json next to this checkout")

    def test_an_attack_beat_is_far_longer_than_the_nominal_beat(self):
        t = server.move_timing("ATTACK_HIGH", "A")
        traj = float(server.tuned_json()["ATTACK_HIGH"]["t"][-1])   # the library's own trajectory length (1.26 s before the pause and retract were added)
        self.assertAlmostEqual(t["motion"], traj, places=2, msg="the trajectory itself")
        self.assertGreater(t["total"], t["motion"] + t["hold"] + 0.4, "...but the arm is busy for longer: lead, hold and the return")
        self.assertEqual(t["hold"], server.turn_profile()["hold_end"])
        self.assertAlmostEqual(t["total"], t["lead"] + t["motion"] + t["hold"] + t["ret"], places=3)

    def test_a_feint_is_longer_still(self):
        self.assertGreater(server.move_timing("FEINT_HIGH", "A")["total"],
                           server.move_timing("ATTACK_HIGH", "A")["total"])

    def test_the_blow_lands_at_the_end_of_the_trajectory_not_at_the_end_of_the_beat(self):
        t = server.move_timing("ATTACK_HIGH", "A")
        self.assertAlmostEqual(t["pinned"], t["lead"] + t["motion"], places=3)
        self.assertLessEqual(t["pinned"], t["total"] - t["hold"] - t["ret"] + 1e-6, "the hold and the return come after the blow")

    def test_each_arm_gets_its_own_timing(self):
        # BLOCK_HIGH ends far from arm B's rest, so B's return is twice A's. A beat is the slower of the two.
        a, b = server.move_timing("BLOCK_HIGH", "A"), server.move_timing("BLOCK_HIGH", "B")
        self.assertNotAlmostEqual(a["ret"], b["ret"], places=2)

    def test_a_fallback_beat_is_the_slower_of_the_two_whole_motions(self):
        plan = server.fallback_beat_plan(["ATTACK_HIGH"], ["BLOCK_HIGH"])
        slower = max(server.move_timing("ATTACK_HIGH", "A")["total"], server.move_timing("BLOCK_HIGH", "B")["total"])
        self.assertAlmostEqual(plan[0]["end"] - plan[0]["start"], slower, places=2)
        self.assertGreater(plan[0]["end"], 1.4 + server.turn_profile()["hold_end"])   # a whole motion: lead + trajectory + hold + return

    def test_a_fallback_plan_is_cumulative_and_carries_the_impact_instant(self):
        plan = server.fallback_beat_plan(["ATTACK_HIGH", "BLOCK_LEFT", "REST"], ["BLOCK_HIGH", "ATTACK_LOW_LR", "REST"])
        self.assertEqual(len(plan), 3)
        self.assertEqual(plan[0]["end"], plan[1]["start"], "beats butt up against each other")
        for b in plan:
            self.assertGreater(b["pinned_at"], b["start"])
            self.assertLess(b["pinned_at"], b["end"], "the blow lands inside its own beat")

    def test_the_moves_table_covers_both_arms(self):
        table = server.api("/api/moves", {})["moves"]
        self.assertIn("ATTACK_HIGH", table)
        self.assertEqual(sorted(table["ATTACK_HIGH"]), ["A", "B"])
        self.assertNotIn("ATTACK_HIGH@B", table, "the @B parts are folded into their base move")

    def test_scale_shortens_the_trajectory_but_not_the_hold(self):
        one = server.move_timing("ATTACK_HIGH", "A", 1.0)
        half = server.move_timing("ATTACK_HIGH", "A", 2.0)
        self.assertAlmostEqual(half["motion"], one["motion"] / 2, places=3)
        self.assertEqual(half["hold"], one["hold"])

    def test_the_per_beat_exchange_counts_its_beats_off_as_they_land(self):
        """Three beats go out back to back, so a global busy flag cannot tell them apart -- it either misses
        the gap between them or swallows the whole turn. The job counts them instead."""
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec), mock.patch.object(server, "REPO", ""):
            job = finish(server.api("/api/exchange",
                                    {"ours": ["ATTACK_HIGH", "BLOCK_LEFT", "REST"],
                                     "theirs": ["BLOCK_HIGH", "ATTACK_LOW_LR", "REST"]}), timeout=10)
        self.assertEqual(job["done_beats"], 3)
        done = [s for s in job["steps"] if "done on both arms" in s["note"]]
        self.assertEqual(len(done), 3, "one progress line per beat, as it finishes")

    def test_the_per_beat_exchange_publishes_its_schedule_before_it_plays(self):
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec), mock.patch.object(server, "REPO", ""):
            job = finish(server.api("/api/exchange",
                                    {"ours": ["ATTACK_HIGH", "REST", "REST"],
                                     "theirs": ["BLOCK_HIGH", "REST", "REST"]}), timeout=10)
        self.assertEqual(job["source"], "per-beat")
        self.assertEqual(len(job["beats"]), 3)
        self.assertGreater(job["beats"][0]["end"], 1.4 + server.turn_profile()["hold_end"], "a real attack beat, not 1.4 s")
        self.assertEqual(job["lead"], 0.0, "each per-beat play carries its own ease-in inside its beat")

    def test_a_compiled_beat_plan_carries_the_pinned_instant(self):
        import tempfile
        T = {"CHAIN_A": {"beats": [{"move": "ATTACK_HIGH", "start": 0.0, "pinned_at": 1.4, "end": 1.79}]},
             "CHAIN_B": {"beats": [{"move": "BLOCK_HIGH", "start": 0.0, "pinned_at": 0.95, "end": 1.75}]}}
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "arm"))
            with open(os.path.join(d, "arm", "motions_tuned.json"), "w") as f: json.dump(T, f)
            with mock.patch.object(server, "tuned_path", lambda: os.path.join(d, "arm", "motions_tuned.json")):
                beats = server.chain_beats()
        self.assertEqual(beats[0]["pinned_at"], 1.4)
        self.assertLess(beats[0]["pinned_at"], beats[0]["end"])


class JobLog(unittest.TestCase):
    def test_a_job_can_be_fetched_by_id(self):
        rec = Recorder({"ok": True})
        with mock.patch.object(urllib.request, "urlopen", rec):
            started = server.api("/api/charge", {})
            finish(started)
        job = server.api("/api/job", {}, {"id": [started["job"]]})
        self.assertEqual(job["id"], started["job"])
        self.assertEqual(job["kind"], "charge")
        self.assertTrue(job["steps"])

    def test_an_unknown_job_id_says_so(self):
        self.assertIn("error", server.api("/api/job", {}, {"id": ["deadbeef"]}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
