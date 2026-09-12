"""Openers: the ceremony before the first blow. A player picks one of these as their opening pose, or none --
every scene here is self-contained and optional, and nothing in the game or the daemon depends on one running.

EN_GARDE_OPENER is the gantry showpiece: the carriages start at the daemon's "apart" stop (200 mm back each,
0.947 m between the pan axes) and drive all the way in to the 19.5 in charge-in stop (0.5469 m), while both arms
fold to keep the blade level and the tip on the other arm's chest. Tip separation goes 10.9 cm -> 1.7 cm.
Key poses were solved on the legal grid (lift >= -89, hand reach <= 0.30 m, hand above the table) for a level
blade (|pitch| < 3 deg) at chest height, with the tip reach scheduled against the carriage position so the blades
close on each other without ever crossing: 2 * tip_x stays below the pan-axis spacing at every key."""
import numpy as np
import emote_lib as L
from emote_lib import Track, scene, APART

# Level-blade guards at the chest line (tip z ~= 0.25), from the widest to the most folded.
# tip_x:        0.419      0.381      0.341      0.302      0.265      <- own frame, metres from the pan axis
# carriage g:   200 mm     150        100         50          0        <- spacing 0.947 .. 0.547 m
GUARD_FAR  = np.array([0, -57.0, 36.0, 26.0, 0, 0], float)
GUARD_M1   = np.array([0, -71.0, 34.0, 44.0, 0, 0], float)
GUARD_M2   = np.array([0, -79.0, 24.0, 64.0, 0, 0], float)
GUARD_M3   = np.array([0, -85.0, 14.0, 80.0, 0, 0], float)
GUARD_NEAR = np.array([0, -88.0, 1.5, 93.5, 0, 0], float)   # tip 0.2655 m: 1.7 cm of air between the two tips
CLOSE = [(GUARD_M1, 0.150), (GUARD_M2, 0.100), (GUARD_M3, 0.050), (GUARD_NEAR, 0.0)]
LIFT_OFF = 1.30     # seconds to come up off the rest pose
STEP = 0.62         # seconds per carriage step (50 mm -> 0.081 m/s, well inside the 0.40 m/s feed ceiling)


def en_garde_opener():
    A, B = Track(g=APART), Track(g=APART)
    for T, me, you in ((A, "A", "B"), (B, "B", "A")):
        T.note("*both arms sit back at rest, carriages parked apart", 0.0)
        T.to(GUARD_FAR, LIFT_OFF)
        T.note("*on guard: blade level, pointed at the other arm's chest", LIFT_OFF)
        T.hold(0.40)
        T.note("*steppers charge in -- the arms fold to hold the tips on target", LIFT_OFF + 0.40)
        for q, g in CLOSE:
            T.to(q, STEP, g=g)
        T.note("*carriages hit the 19.5 in stop: tips almost touching", LIFT_OFF + 0.40 + 4 * STEP)
        T.hold(0.55)
        # The nod. At the fully folded guard the lift and wrist are both against their stops, so the nod rides on the
        # gripper: opening the jaw rocks the blade back about its hinge, so the point lifts and settles again. It is
        # also the only direction that is safe here -- it opens the tip gap (1.6 cm -> 2.3 cm) instead of closing it.
        T.note("*a small nod of the point -- the salute", LIFT_OFF + 0.40 + 4 * STEP + 0.55)
        T.nudge(0.20, jaw=16.0)
        T.nudge(0.24, jaw=-16.0)
        T.note("*and hold", LIFT_OFF + 0.40 + 4 * STEP + 0.99)
        T.hold(0.75)
    return scene(A, B, "En garde", "openers",
                 {"A": "squaring up", "B": "squaring up"},
                 "Both arms rise to a level guard, then the carriages charge in from the apart stop to the 19.5 in "
                 "stop while the arms fold to keep the tips on target -- two duellists squaring up.",
                 camera="side", tags=("gantry", "ceremony", "symmetric"))


SCENES = {"EN_GARDE_OPENER": en_garde_opener}
