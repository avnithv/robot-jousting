# Robot Jousting

A turn-based sword-fighting game for two hobby robot arms (SO-100 and SO-101). Players pick a chain of moves on their
phones; the arms perform the chains simultaneously, beat by beat, and a rules table decides who landed what.
This repo holds the move library, the MuJoCo simulation used to design and check moves, the real-arm playback, and a
small web UI ("move studio") to tweak parameters, preview, and run moves.

## Layout

| Path | What |
|---|---|
| `joust/` | **The game.** Browser front end for the fight ("The Tilt of Tiltford"): the card battler (voltage / rush / full tilt / counter on top of the beat rules), campaign and phone 1v1 (QR links, `server.py` mailbox), host control panel, Arm Studio dashboard, procedural score, and the hardware seam that drives this repo's daemon (`joust/start_live.sh`, `joust/tools/mock_daemon.py` to rehearse without arms). See `joust/README.md`. |
| `sim/params/*.json` | **The move definitions.** One file per move, every parameter has a `_help` note. `REST.json` is the rest pose (real-arm degrees). |
| `sim/tune.py` | Turns a parameter file into key poses, splines them, checks joint speed, saves a 50 Hz trajectory to `arm/motions_tuned.json` and renders `sim/out/tuned_<MOVE>.mp4` (+ filmstrip png). `python tune.py ALL` |
| `sim/pair.py` | Two-arm simulation: `python pair.py BLOCK_HIGH ATTACK_HIGH` (A = us, B = opponent). Reports closest blade distance, renders a clip. |
| `sim/arena.py` | MuJoCo scene: SO101 + SO100 facing each other 0.61 m apart, the printed fencing gripper's blade on the moving jaw (real `Sword_Blade_8in_<style>` mesh from `sim/assets/blades/`, socket mouth 56 mm from the jaw pivot, 203 mm showing, tip 259 mm from the pivot; `JOUST_BLADE=none` restores the old capsule), SO100 joint-convention mapping. |
| `sim/emote.py`, `sim/emote_lib.py` | Two-arm emote framework (openers, hit reactions, gloats, finales, idle): `Track` keyframe builder, checks, MuJoCo clips, trajectories as `NAME` / `NAME@B`. Scene files go in `sim/emotes/<family>.py`; the first batch of scenes was cut (see `docs/emotes_brainstorm.md` for the vocabulary and the intended scene list). |
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
- `docs/emotes_brainstorm.md` - the arms' emotional vocabulary (what each joint can say), two-arm principles, scene families for the emote framework.

## Setup (fresh laptop)
```bash
brew install uv            # or: curl -LsSf https://astral.sh/uv/install.sh | sh
git clone https://github.com/avnithv/robot-jousting.git && cd robot-jousting
./setup.sh                 # sim env (.venv), arm env (~/so-arm/.venv: LeRobot + Feetech), SO-ARM100 models, calibration files
```
`./setup.sh --no-arm` skips the LeRobot env (sim, studio and the game in sim mode). Everything the runtime needs is in the
repo: the tuned motion library (`arm/motions_tuned.json`), the transition library, the 24 contact calibrations
(`sim/contact_stops.json`), the turn profile, the servo calibration files (`calib/`), the game and its soundtrack.
The only things generated locally are the studio's preview clips (`sim/out/`, optional: `cd sim && ../.venv/bin/python tune.py ALL`).

Then: `./studio.sh` (http://localhost:8765), `cd joust && ./start_live.sh` (http://localhost:8770/?hw=live&mode=simple;
`--mock` for no hardware), `python3 arm/duel_sequence.py sim/safe_show.json` for the scripted show.
Hardware names live in `arm/common.py` (arm ports/ids, env `ARM_PORT` `ARM_B_PORT` `ARM_ID` `ARM_B_ID`) and `arm/arms.json`
(gantry port and stops); `ls /dev/cu.usb*` shows what is plugged in. The LeRobot env can live elsewhere: `SO_ARM_ENV=/path`
for setup.sh, `SO_ARM_PY=/path/bin/python` for the studio and `arm/run_daemon.sh`. The studio's "Send to agent" needs the `claude` CLI.

## Conventions
Joint vector `[pan, lift, elbow, wrist_flex, wrist_roll, jaw]` in degrees. Sim convention: pan + = the arm's own right,
roll 0 = sword on top (real arm reads roll +76), positive lift/elbow/wrist pitch the chain down, jaw 0 shut / 100 open.
Hand positions in metres from the arm's own base (x forward, z up from the base plane). Rules used everywhere:
hand no more than 0.27 m forward of its own base (hands never cross the centre line), nothing below the base plane,
servo speed ~300 deg/s, the real wrist roll must not cross +/-180.

## Current move set (v1)
ATTACK_HIGH (overhead chop), ATTACK_LOW_LR / RL (low slashes), FEINT_HIGH / LEFT / RIGHT (windup then snap back),
BLOCK_HIGH (level bar at the high line), BLOCK_LEFT / RIGHT / MIDDLE (hanging guards), REST. Beat length 1.4 s.
