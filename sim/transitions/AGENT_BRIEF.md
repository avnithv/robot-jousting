# Brief for transition authors

You are choreographing TRANSITIONS between states of a robot-arm sword game (two 5-DOF hobby arms with a plastic sword on the
gripper's moving jaw). Read sim/transitions/README.md (format + rules), sim/hubs.json (hub poses), sim/params/README.md
(conventions), and skim sim/tune.py (recipes: how each move's START and END poses arise) and docs/transitions_and_flourishes.md
(earlier ideas). Joint vector = [pan, lift, elbow, wrist_flex, wrist_roll, jaw] in sim degrees: +pan = own right; positive
lift/elbow/wrist pitch the chain DOWN; roll 0 = sword on top, +/-90 = jaw swings sideways, -180 = sword underneath (the guards);
jaw 0 shut .. 100 open (open = sword cocked away from the finger).

Useful commands (run from ~/game/sim):
  ../.venv/bin/python -c "import tune,numpy as np,ik; tune.use_arm('A'); from chain import recipe; print([np.round(k,0).astype(int).tolist() for k,_ in recipe('ATTACK_HIGH')])"   # a move's keys (index 1 = START, last = END)
  ../.venv/bin/python -c "import ik,numpy as np; print(ik.fk(np.array([0,-40,10,30,-90,0.])))"   # (hilt xyz, tip xyz, blade pitch) for a pose
  ../.venv/bin/python validate_transition.py transitions/<FILE>.json --render          # validates both arms, writes filmstrips to out/
Look at the filmstrips (Read the png) to judge how a path reads. Never run anything under ~/game/arm (real robots).

For EACH of your assigned (END -> START) pairs write sim/transitions/<END>__<START>.json with:
  - always a "direct" path (via [] ) if the validator accepts it, else the fastest safe routed path named "plain";
  - 1-2 styled paths when the handoff is long enough to be seen (>= 0.5 s) or visually interesting: sweeps, roll-first moves,
    a dip through LOW_TIP, a lift through SALUTE, a jaw flick, a small pan wag. Give each a short "notes" line on what a
    spectator sees. Keep durations realistic (the validator flags too-fast legs) and total path time under ~1.2 s.
Same-state pairs (X -> X) still need a file: a "hold" path with via [] is fine, plus optionally an idle flourish.
Make every file pass the validator for BOTH arms before moving on. Do not edit any other files. When done, append a short
summary (pairs done, any pair you could not make safe and why) to sim/transitions/AUTHOR_LOG.md.
