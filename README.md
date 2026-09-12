# Robot Jousting

A turn-based sword-fighting game for two hobby robot arms (SO-100 and SO-101). Players pick a chain of moves on their
phones; the arms perform the chains simultaneously, beat by beat, and a rules table decides who landed what.
This repo holds the move library, the MuJoCo simulation used to design and check moves, the real-arm playback, and a
small web UI ("move studio") to tweak parameters, preview, and run moves.

## Layout

| Path | What |
|---|---|
| `sim/params/*.json` | **The move definitions.** One file per move, every parameter has a `_help` note. `REST.json` is the rest pose (real-arm degrees). |
| `sim/tune.py` | Turns a parameter file into key poses, splines them, checks joint speed, saves a 50 Hz trajectory to `arm/motions_tuned.json` and renders `sim/out/tuned_<MOVE>.mp4` (+ filmstrip png). `python tune.py ALL` |
| `sim/pair.py` | Two-arm simulation: `python pair.py BLOCK_HIGH ATTACK_HIGH` (A = us, B = opponent). Reports closest blade distance, renders a clip. |
| `sim/arena.py` | MuJoCo scene: SO101 + SO100 facing each other 0.61 m apart, plastic sword on the moving jaw, SO100 joint-convention mapping. |
| `sim/ik.py` | Planar IK / FK helpers on the sim (hand position + sword pitch -> joints). |
| `sim/reel.py` | Concatenates clips into one labelled video. |
| `arm/arm_daemon.py` | Stays connected to the real arm, holds REST, plays moves on request (HTTP :8766). Used by the UI. |
| `arm/play_motion.py`, `arm/replay.sh` | One-shot playback on the real arm: `arm/replay.sh ATTACK_HIGH 0.5` (name, time scale, repeat). |
| `arm/teach_daemon.py` | Torque-off teach mode: record a hand-guided motion (`rec NAME` / `stop` via `cmd.txt`) into `arm/motions_real.json`. |
| `arm/motions_real.json` | Hand-guided recordings (rough input to tuning) and the REST pose. |
| `arm/motions_tuned.json` | Generated trajectories in real-arm degrees (what the arm plays). |
| `ui/` | Move studio web UI. `./studio.sh` -> http://localhost:8765 |
| [`gantry/`](gantry/README.md) | X/Y CNC xPRO V3 / GRBL 0.9j controller: switch referencing, position/feed console, Python API, and offline tests. |
| `docs/` | Design notes and brainstorms (see below). |
| `sim/legacy/` | Earlier experiments (probes, calibration mapping, first move sets). Not used by the current pipeline. |

## Docs
- `docs/brainstorm.md` - running log of game ideas: pass structure, cards, weapons, stagger/bonus rules, what was tried and dropped.
- `docs/design_early.md` - the first written design (pre-hardware), kept for the rules ideas.
- `docs/library_architecture.md` - proposed data model for a chainable move library (stances, transitions, flourish slots, validation).
- `docs/move_catalogue.md` - 41 candidate moves/flourishes/reactions with joint-level descriptions, plus signature combos.
- `docs/reactions_and_pairs.md` - how each beat outcome is performed by both arms, timing, and pair safety checks.
- `docs/transitions_and_flourishes.md` - end-pose to next-move transition table, hub poses, flourishes, worked example turns.

## Setup
1. Arm models: clone https://github.com/TheRobotStudio/SO-ARM100 to `~/so-arm/SO-ARM100` (or set `SO_ARM_DIR`).
2. Sim env: `uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python mujoco numpy imageio imageio-ffmpeg pillow matplotlib`
3. Real arm (optional): a LeRobot install with the SO follower calibrated, in `~/so-arm/.venv` (or set `SO_ARM_PY`). Port/id via `ARM_PORT`, `ARM_ID`
   (see `arm/common.py`). The studio's "Send to agent" feature needs the `claude` CLI.
4. `cd sim && ../.venv/bin/python tune.py ALL` to build every move and clip, then `./studio.sh`.

## Conventions
Joint vector `[pan, lift, elbow, wrist_flex, wrist_roll, jaw]` in degrees. Sim convention: pan + = the arm's own right,
roll 0 = sword on top (real arm reads roll +76), positive lift/elbow/wrist pitch the chain down, jaw 0 shut / 100 open.
Hand positions in metres from the arm's own base (x forward, z up from the base plane). Rules used everywhere:
hand no more than 0.27 m forward of its own base (hands never cross the centre line), nothing below the base plane,
servo speed ~300 deg/s, the real wrist roll must not cross +/-180.

## Current move set (v1)
ATTACK_HIGH (overhead chop), ATTACK_LOW_LR / RL (low slashes), FEINT_HIGH / LEFT / RIGHT (windup then snap back),
BLOCK_HIGH (level bar at the high line), BLOCK_LEFT / RIGHT / MIDDLE (hanging guards), REST. Beat length 1.4 s.
