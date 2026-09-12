"""Two-arm emote scenes: the pose vocabulary and a chainable keyframe builder (one Track per arm).
Scenes live in emotes/<family>.py as `SCENES = {"NAME": fn}` where fn() returns scene(...). Generate with emote.py.
Conventions (same as tune.py): joints [pan, lift, elbow, wrist, roll, jaw] in sim degrees. pan + = the arm's own right.
Positive lift/elbow/wrist pitch the chain DOWN (lift -89 = leaning fully back, the hard limit; lift +70 = arm forward/down).
roll 0 = sword on top (real +76); jaw 0 shut .. 100 open (opening cocks the blade up and back). Both arms use the same
convention: a pose written for A reads identically on B (B mirrors A through the arena joint mapping)."""
import json, os, numpy as np
import tune, ik
from tune import REST, PARAMS, recipe, JOINTS

HERE = os.path.dirname(os.path.abspath(__file__))
HUBS = {k: np.array(v, float) for k, v in json.load(open(os.path.join(HERE, "hubs.json"))).items() if not k.startswith("_")}
EN_GARDE, READY_MID, TUCK, GATE = HUBS["EN_GARDE"], HUBS["READY_MID"], HUBS["TUCK"], HUBS["GATE"]
J = {"pan": 0, "lift": 1, "elbow": 2, "wrist": 3, "roll": 4, "jaw": 5}
LO, HI = ik.LO, ik.HI   # sim joint ranges (deg)

# ---- extra named poses (checked with ik.fk: reach <= 0.30 m, tip above the table) ----
SALUTE     = np.array([0, 10, -30, -90, 0, 0], float)     # blade vertical in front of the face, hand ~0.20 fwd
PROUD      = np.array([0, -40, -20, -40, 0, 0], float)    # chest out, blade up and forward (tall silhouette)
SLUMP      = np.array([0, -40, 31, 31, 0, 0], float)      # middle hanging guard: sagging, blade drooping
POINT      = np.array([0, -45, 20, 40, 0, 0], float)      # blade level, pointed at the opponent (beckon base)
COWER      = np.array([25, -80, 60, 10, 0, 0], float)     # pulled back, turned away, small
LOOK_AWAY  = np.array([45, -70, 40, 10, 0, 0], float)     # turned to the side, blade off the line
STRETCH    = np.array([0, -75, -20, -60, 0, 0], float)    # reaching up and back: a morning stretch
BLADE_UP   = np.array([0, -30, -40, -90, 0, 0], float)    # blade straight up, hand tucked (victory pump top)

# ---- staged guards ----------------------------------------------------------------------------------------
# The bases are 0.61 m apart and hilt reach + blade is 0.53 m, so two arms both at EN_GARDE cross blades by ~18 cm
# and each tip arrives at the other's hilt (blade/body contact). When BOTH arms are forward at once, put one on the
# high line and one on the low line: the blades still cross in x but pass 15 cm apart in z.
# Height alone is not always enough: a blade is a long capsule, and at a sagging height the far arm's blade
# still lands on this one's gripper. The other lever is pan. Because B mirrors A, giving BOTH arms the same
# pan (e.g. pose(EN_GARDE, pan=15)) turns each to its own right, which in the world turns them in OPPOSITE
# directions and slides the blades off each other's centre plane. On the scenes where both arms sit forward
# for several seconds this took body contacts from 672 to 2 (EXHAUSTED_DRAW) and 145 to 0 (OLD_RIVALS),
# and it reads as two arms not quite facing each other, which usually suits the scene anyway.
HIGH_GUARD = np.array([0, -66, 22, 10, 0, 0], float)      # tip z 0.43 -- the high line
LOW_GUARD  = np.array([0, -50, 42, 18, 0, 0], float)      # tip z 0.13 -- the low line
LEAN_IN    = np.array([0, -48, 45, 10, 0, 0], float)      # low line, pressed forward (hand 0.26): aggression
LEAN_HI    = np.array([0, -48, 16, 20, 0, 0], float)      # high line, pressed forward: the same menace up top
TOUCH      = np.array([0, -68, 20, 8, 0, 0], float)       # tip at the centre line, high: where two blades meet

# ---- flourish poses (numbers from docs/transitions_and_flourishes.md, re-checked with ik.fk) -----------------
PUMP_LO    = np.array([0, -30, -40, -90, 0, 0], float)    # bottom of the victory pump (= BLADE_UP)
PUMP_HI    = np.array([0, 0, -20, -90, 0, 0], float)      # top: blade thrust overhead, tip z 0.61
WAVE_L     = np.array([-50, -20, -30, -90, 0, 0], float)  # crowd wave, blade high, swung to one side
WAVE_R     = np.array([50, -20, -30, -90, 0, 0], float)   # ... and the other (pan -50..+50 = the wave)
CLAP       = np.array([5, 5, -25, -88, 0, 0], float)      # blade upright in front: the slow-clap stance (jaw = the clap)
BOW        = np.array([0, -50, 36, 18, 0, 0], float)      # bows over the blade. Deliberately not deeper: Catmull-Rom
                                                          # overshoots ~7 deg past a bow approached from a tall pose,
                                                          # and a [0,-45,42,22] bow puts the tip through the table on
                                                          # the overshoot. The bow reads from the drop, not the depth.
SLUMP_HIGH = np.array([0, -54, 26, 24, 0, 0], float)      # a shallower sag (tip z 0.25) for the arm sharing the frame
                                                          # with a SLUMPed one: two arms slumped to the same height jam.
LOLL       = np.array([0, -40, 31, 31, 90, 40], float)    # beaten: the blade lolls sideways off the wrist
BACK_TURNED= np.array([90, -70, 40, 10, 0, 0], float)     # fully turned away: the back of the arm to the opponent
BUCKLE     = np.array([-15, -52, 50, 22, 0, 20], float)   # the knee going: hand drops, blade droops off the line
COLLAPSED  = np.array([45, -60, 66, 18, 0, 25], float)    # the end of a mope: folded small, turned away, blade drooping
                                                          # and pulled back inside the centre line. Do NOT end a defeat
                                                          # at REST -- REST leans the arm back and puts the blade UP.
REAR_BACK  = np.array([15, -80, 30, -10, 0, 40], float)   # head snapped back by a blow, blade flung up
SHRUG_DOWN = np.array([0, -72, 45, 8, 0, 0], float)       # the down half of a shrug (blade stays level)
TAP_UP     = np.array([0, -45, 20, 44, 0, 0], float)      # blade poised over the table
TAP_DOWN   = np.array([0, -45, 20, 60, 0, 0], float)      # ... and down on it (allow_table)

def pose(base=None, **dj):
    """pose(pan=.., lift=..) from REST, or pose(EN_GARDE, jaw=30): copy base and override joints by name."""
    q = (REST if base is None else np.asarray(base, float)).copy()
    for k, v in dj.items(): q[J[k]] = v
    return q

def move_keys(name):
    """The tuned move's key poses after its leading REST key: [(q, seconds to reach it), ...]. Names as in params/."""
    return [(np.array(k, float), float(dt)) for k, dt in recipe(name)][1:]

def move_pose(name, i=-1): return move_keys(name)[i][0].copy()   # e.g. move_pose("ATTACK_HIGH") = the slammed end pose

class Track:
    """Keyframes for one arm. Every method appends keys and returns self, so scenes read as choreography:
        Track().to(EN_GARDE, 0.8, "en garde").hold(0.3).wag("pan", 10, n=2, period=0.5, note="looks left and right").rest(1.2)
    Timing: `dt` is seconds from the previous key. `until(t)` holds until an absolute scene time (sync with the other arm)."""
    def __init__(self, start=None):
        self.keys = [((REST if start is None else np.asarray(start, float)).copy(), 0.0)]; self.notes = []
    @property
    def t(self): return float(sum(dt for _, dt in self.keys))
    @property
    def q(self): return self.keys[-1][0].copy()
    def note(self, text, t=None): self.notes.append((round(self.t if t is None else t, 2), text)); return self
    def to(self, q, dt, note=None):
        if note: self.note(note)
        self.keys.append((np.asarray(q, float).copy(), max(float(dt), 0.02))); return self
    def hold(self, dt, note=None): return self.to(self.q, dt, note)
    def until(self, t_abs, note=None):
        if t_abs > self.t + 0.02: self.hold(t_abs - self.t, note)
        return self
    def set(self, dt, note=None, **dj): return self.to(pose(self.q, **dj), dt, note)           # absolute joint values
    def nudge(self, dt, note=None, **dj):                                                       # relative offsets
        q = self.q
        for k, v in dj.items(): q[J[k]] += v
        return self.to(q, dt, note)
    def osc(self, n=3, period=0.3, note=None, **amps):
        """One-sided oscillation: base -> base+amp -> base, n times (jaw chatter, shoulder bob, laugh)."""
        base = self.q; up = base.copy()
        for k, v in amps.items(): up[J[k]] += v
        if note: self.note(note)
        for _ in range(n): self.to(up, period / 2).to(base, period / 2)
        return self
    def wag(self, n=2, period=0.5, note=None, **amps):
        """Symmetric oscillation: base -> +amp -> -amp -> base (head shake, finger wag, pan wander)."""
        base = self.q; up = base.copy(); dn = base.copy()
        for k, v in amps.items(): up[J[k]] += v; dn[J[k]] -= v
        if note: self.note(note)
        for _ in range(n): self.to(up, period / 4).to(dn, period / 2).to(base, period / 4)
        return self
    def move(self, name, note=None, scale=1.0):
        """Play a tuned move's keys (windup + strike / guard). scale > 1 = slower."""
        if note: self.note(note)
        for q, dt in move_keys(name): self.to(q, dt * scale)
        return self
    def rest(self, dt=1.2, note=None): return self.to(REST, dt, note)

def scene(A, B, title, family, moods, blurb, camera="side", allow_table=False, allow_touch=False, tags=()):
    """A, B: Tracks. moods: {"A": "gloating", "B": "hurt"}. allow_table: blade tips may touch the table (taps).
    allow_touch: blade-on-blade contact is intended (a glove-touch). Body contact between the arms is never allowed."""
    return {"A": A, "B": B, "title": title, "family": family, "moods": moods, "blurb": blurb, "camera": camera,
            "allow_table": allow_table, "allow_touch": allow_touch, "tags": list(tags)}
