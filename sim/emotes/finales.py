"""Finales: the finishing pose a player picks for the end of a bout, or none -- each scene here is self-contained
and optional, and neither the game nor the daemon depends on one running.

SAMURAI_FINISH: A (the winner) throws six blows on alternating lines -- overhead chop, low sweep across the table,
diagonal up-left, level thrust, reverse diagonal, then a big overhead that stops dead and holds over the fallen
loser -- walking its carriage in from the 0.61 m start to the 19.5 in charge-in stop as it goes. Each blow is a
short cock, a strike sized to sit just under the 300 deg/s servo cap, and a 70 ms freeze on the impact frame so
the blow lands and stops instead of smearing into the next one. The six lines are deliberately spread in HEIGHT
(tip z 0.12, 0.07, 0.26, 0.30, 0.08, 0.18) as well as in pan, so the alternation reads from any camera.

B takes the first blow with a jolt locked to that impact frame, staggers on the next two, doubles over on the
thrust and then collapses in stages: wrist and elbow folding, the blade rolling over (roll 0 -> 90) and dropping
until blade and hand lie on the table, pan turned away to 62 deg, its carriage drifting back 50 mm as if driven
off. It stays down while A holds the overhead, A withdraws slowly to en garde, and B twitches once.

Blade-on-blade and blade-on-body contact is expected here: the blows are meant to land."""
import numpy as np
import emote_lib as L
from emote_lib import Track, scene

START_GAP = 0.61                             # pan-axis spacing at the top of the scene
G_A0 = round(START_GAP - L.CHARGED_GAP, 4)   # 63.2 mm: A carries the whole opening gap, B starts charged in
G_B_END = 0.050                              # how far the loser's carriage is driven back

# ---- A, the winner. tip = (x, z) in A's own frame; A's pan axis starts 63 mm back from the charge-in stop ----
A_READY  = np.array([0, -48, 16, 20, 0, 0], float)      # high guard, tip z 0.38: clear over B's low guard
COCK1    = np.array([0, -62, -30, -8, 0, 20], float)    # blade swung up and back over the shoulder
CHOP1    = np.array([0, -24, 18, 32, 0, 0], float)      # 1 overhead chop, straight down the middle   tip z 0.12
COCK2    = np.array([-18, -44, 8, 16, 20, 20], float)   # cocked out flat to A's left
SWEEP2   = np.array([18, -30, 40, 18, 20, 0], float)    # 2 low sweep across to A's right             tip z 0.07
COCK3    = np.array([18, -56, -4, 8, -20, 20], float)   # up on A's right
DIAG3    = np.array([-15, -34, 20, 18, -20, 0], float)  # 3 diagonal, high right to A's left          tip z 0.26
COCK4    = np.array([0, -70, 24, 50, 0, 20], float)     # pulled back level: the thrust coils
THRUST4  = np.array([0, -36, 10, 26, 0, 0], float)      # 4 straight level thrust, full extension     tip z 0.31
COCK5    = np.array([-18, -56, -4, 8, 20, 20], float)   # up on A's left
DIAG5    = np.array([15, -28, 28, 30, 20, 0], float)    # 5 reverse diagonal down to A's right        tip z 0.08
BIGCOCK  = np.array([0, -72, -46, 14, 0, 30], float)    # the big raise: blade all the way overhead and back
SLAM6    = np.array([0, -16, -30, 76, 0, 0], float)     # 6 stops dead, blade angled down over the fallen arm
A_END    = np.array([0, -52, 30, 26, 0, 0], float)      # en garde again

# ---- B, the loser -----------------------------------------------------------------------------------------
B_READY  = np.array([6, -44, 34, 30, 0, 8], float)      # low wary guard, under A's line
B_BRACE  = np.array([10, -50, 38, 28, 0, 14], float)
B_JOLT   = np.array([14, -74, 16, 4, 0, 35], float)     # snapped back, blade flung up
B_STAG0  = np.array([18, -62, 26, 10, 10, 20], float)
B_STAG1  = np.array([30, -58, 36, 14, 25, 25], float)
B_SAG1   = np.array([34, -56, 42, 18, 30, 28], float)
B_STAG2  = np.array([44, -54, 50, 18, 40, 30], float)
B_SAG2   = np.array([48, -52, 58, 20, 50, 32], float)
B_BUCKLE = np.array([52, -54, 66, 20, 60, 36], float)   # doubled over by the thrust
B_SINK   = np.array([56, -66, 76, 20, 72, 42], float)   # wrist and elbow folding, blade rolling over
B_DOWN   = np.array([62, -79, 91, 24, 90, 50], float)   # blade and hand on the table, pan turned away

HOLD_END, WITHDRAW, TWITCH_AT, TAIL = 7.10, 1.90, 9.45, 1.40
# Segment times are set by the speed ceiling, not by taste: no joint may move faster than the recorded move
# library already moves it (pan 146, lift 192, elbow 165 deg/s; wrist/roll/jaw bound by the 300 deg/s servo
# rule). Catmull-Rom peaks about 1.3-1.45x the segment mean, so each dt below is ~1.45 * travel / that cap --
# which roughly doubles every strike compared with the first cut of this scene.


def samurai_finish():
    A, B = Track(A_READY, g=G_A0), Track(B_READY, g=0.0)
    hits = []

    def blow(cock, land, t_cock, t_strike, note, g=None, freeze=0.07):
        """A cock, a strike as fast as the library allows, and a short freeze on the impact frame."""
        A.to(cock, t_cock, g=g).to(land, t_strike, note)
        hits.append(round(A.t, 3)); A.hold(freeze)

    A.note("*the winner squares up -- carriages 0.61 m apart", 0.0)
    A.to(A_READY, 0.45)
    A.note("*A rears back: the flurry starts", 0.45)
    blow(COCK1, CHOP1, 0.41, 0.43, "1 overhead chop")
    blow(COCK2, SWEEP2, 0.19, 0.36, "2 low sweep across", g=0.050)
    blow(COCK3, DIAG3, 0.39, 0.33, "3 diagonal, high right to low left", g=0.038)
    blow(COCK4, THRUST4, 0.28, 0.26, "4 level thrust", g=0.025)
    blow(COCK5, DIAG5, 0.19, 0.33, "5 reverse diagonal", g=0.013)
    A.note("*the big one -- blade all the way overhead", A.t)
    A.to(BIGCOCK, 0.65, g=0.0).to(SLAM6, 0.43)
    hits.append(round(A.t, 3))
    A.note("*the overhead stops dead over the fallen arm", hits[5])
    A.until(HOLD_END)
    A.note("*A withdraws, slowly, to en garde", HOLD_END)
    A.to(A_END, WITHDRAW).hold(TAIL)

    H = hits
    B.to(B_READY, 0.45).to(B_BRACE, 0.55).until(H[0])
    B.to(B_JOLT, 0.22, "takes the first blow").to(B_STAG0, 0.30).until(H[1])
    B.to(B_STAG1, 0.22, "staggers").to(B_SAG1, 0.40).until(H[2])
    B.to(B_STAG2, 0.24, "staggers again").to(B_SAG2, 0.40).until(H[3])
    B.note("*the thrust doubles the loser over", H[3])
    B.to(B_BUCKLE, 0.34, g=0.020).until(H[4])
    B.note("*it goes down in stages -- wrist, elbow, blade", H[4])
    B.to(B_SINK, 0.42, g=0.035)
    B.to(B_DOWN, max(0.40, H[5] - B.t), g=G_B_END)          # flat on the table as the overhead lands
    B.note("*blade and hand on the table, turned away, carriage driven back", H[5])
    B.until(TWITCH_AT)
    B.note("*one twitch, and still", TWITCH_AT)
    B.nudge(0.18, lift=-3.0, wrist=-4.0, jaw=8).nudge(0.20, lift=3.0, wrist=4.0, jaw=-8)
    B.until(HOLD_END + WITHDRAW + TAIL)

    return scene(A, B, "Samurai finish", "finales",
                 {"A": "finishing it", "B": "beaten"},
                 "The winner throws six fast blows on alternating lines, walking its carriage in to the charge-in "
                 "stop, and freezes a big overhead over the loser, who jolts, staggers and collapses onto the table.",
                 camera="iso", allow_table={"A": False, "B": True}, allow_touch=True,
                 cam={"azimuth": 118, "elevation": -24},
                 tags=("gantry", "flurry", "collapse", "finisher"))


SCENES = {"SAMURAI_FINISH": samurai_finish}
