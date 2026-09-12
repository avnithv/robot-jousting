#!/usr/bin/env python3
"""Slim the real-arm move library down for the browser foley engine (src/audio/servo.js).

    python3 tools/make_moves.py                # robot-jousting/arm/motions_tuned.json -> assets/motions/moves.json

Per move: t (s, 50 Hz), q ([pan, lift, elbow, wrist_flex, wrist_roll, jaw] real-arm degrees, jaw 0-100), key_times,
kind ('attack' | 'block' | 'feint' | 'rest') and `impact`: the clip time of the move's commit instant.
  attacks / feints: time of peak deceleration of the blade tip (planar FK through the three pitch joints, plus pan);
                    feints search only up to their last key, so the stop-dead of the cocked pose wins, not the pull-back.
  blocks:           time the joints settle (max joint speed stays under SETTLE deg/s from there on).
  rest:             null (nothing moves).
The link lengths are rough; the peak lands on the end of the strike segment for any sensible geometry."""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("MOTIONS", os.path.join(HERE, "..", "..", "arm", "motions_tuned.json"))   # joust/ lives inside the repo
DST = os.path.join(HERE, "..", "assets", "motions", "moves.json")
MOVES = ["ATTACK_HIGH", "ATTACK_LOW_LR", "ATTACK_LOW_RL", "BLOCK_HIGH", "BLOCK_LEFT", "BLOCK_RIGHT", "BLOCK_MIDDLE",
         "FEINT_HIGH", "FEINT_LEFT", "FEINT_RIGHT", "REST"]
L1, L2, L3 = 0.116, 0.135, 0.25      # upper arm, forearm, wrist-to-blade-tip (m)
SETTLE = 12.0                        # deg/s: below this a block counts as set

def kind_of(name):
    for k in ("attack", "block", "feint"):
        if name.lower().startswith(k): return k
    return "rest"

def tip(q):
    """Blade tip in metres from q (N x 6, degrees). lift / elbow / wrist_flex are pitch joints in series; pan spins the plane."""
    r = np.radians(q)
    a1 = r[:, 1]; a2 = a1 + r[:, 2]; a3 = a2 + r[:, 3]
    x = L1 * np.cos(a1) + L2 * np.cos(a2) + L3 * np.cos(a3)     # reach in the arm's plane
    z = L1 * np.sin(a1) + L2 * np.sin(a2) + L3 * np.sin(a3)
    return np.stack([x * np.cos(r[:, 0]), x * np.sin(r[:, 0]), z], 1)

def smooth(v, n=3):
    return np.convolve(v, np.ones(n) / n, mode="same") if len(v) >= n else v

def impact_time(name, t, q, key_times):
    kind = kind_of(name)
    dq = np.gradient(q, t, axis=0)
    speed = np.linalg.norm(dq[:, :5], axis=1)
    if kind == "rest" or speed.max() < 5: return None
    if kind == "block":   # guard set = first near-standstill after the fastest frame (the spline bounces a little after it)
        top = int(np.argmax(speed)); vmax = speed[top]
        for i in range(top + 1, len(t) - 1):
            if speed[i] <= speed[i - 1] and speed[i] <= speed[i + 1] and speed[i] < max(SETTLE, 0.1 * vmax): return float(t[i])
        return float(t[-1])
    v = smooth(np.linalg.norm(np.gradient(tip(q), t, axis=0), axis=1))   # tip speed (m/s)
    decel = -np.gradient(v, t)
    lim = len(t) if kind == "attack" else int(np.searchsorted(t, key_times[-2] + 0.06)) + 1   # feint: ignore the pull-back
    lo = int(np.searchsorted(t, 0.25 * t[-1]))                                                 # skip the initial ramp
    return float(t[lo + int(np.argmax(decel[lo:lim]))])

def main():
    lib = json.load(open(SRC)); out = {}
    for name in MOVES:
        m = lib[name]; t = np.array(m["t"], float); q = np.array(m["q"], float)
        imp = impact_time(name, t, q, m["key_times"])
        out[name] = {"kind": kind_of(name), "t": [round(float(x), 3) for x in t], "q": [[round(float(x), 1) for x in row] for row in q],
                     "key_times": m["key_times"], "impact": None if imp is None else round(imp, 3)}
        print(f"{name:14s} {out[name]['kind']:6s} dur {t[-1]:.2f}s  keys {m['key_times']}  impact {imp if imp is None else round(imp, 2)}")
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    json.dump(out, open(DST, "w"), separators=(",", ":"))
    print("wrote", os.path.relpath(DST), os.path.getsize(DST) // 1024, "kB")

if __name__ == "__main__":
    main()
