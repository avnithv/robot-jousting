# Move parameters
One JSON file per move. Edit a file (or use the UI), then regenerate: `cd ~/game/sim && ../.venv/bin/python tune.py <MOVE>` (or ALL).
Conventions: metres from the arm's own pan axis (x forward, z up from the base plane), degrees, seconds.
pan: + = the arm's own right. roll: 0 = sword on top (real arm reads +76). jaw: 0 = shut, 100 = fully open.
Joint angle lists are [pan, lift, elbow, wrist_flex, wrist_roll, jaw]. Positive lift/elbow/wrist pitch the chain DOWN.
Rules: hand (hilt) no more than 0.27 m forward of the base; nothing below the base plane; servo cap ~300 deg/s.
