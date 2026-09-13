#!/usr/bin/env bash
# Fresh-laptop setup for robot-jousting (macOS / Linux). Idempotent: rerun it any time.
#   ./setup.sh            everything: sim env, arm env, arm models, calibration files
#   ./setup.sh --no-arm   skip the LeRobot env (sim, studio and the game in sim mode only)
# Needs: git, uv (https://docs.astral.sh/uv/ ; brew install uv), and for the game server's phone QR codes nothing else.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE"
SO_ARM_DIR="${SO_ARM_DIR:-$HOME/so-arm/SO-ARM100}"; ARM_ENV="${SO_ARM_ENV:-$HOME/so-arm/.venv}"
command -v uv >/dev/null || { echo "install uv first: brew install uv  (or curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }

echo "== sim / studio env: .venv"
[ -x .venv/bin/python ] || uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -q -r requirements-sim.txt

echo "== arm models: $SO_ARM_DIR"
if [ ! -d "$SO_ARM_DIR" ]; then mkdir -p "$(dirname "$SO_ARM_DIR")"; git clone -q --depth 1 https://github.com/TheRobotStudio/SO-ARM100 "$SO_ARM_DIR"; fi

if [ "${1:-}" != "--no-arm" ]; then
  echo "== real-arm env (LeRobot + Feetech): $ARM_ENV"
  [ -x "$ARM_ENV/bin/python" ] || uv venv "$ARM_ENV" --python 3.12
  uv pip install --python "$ARM_ENV/bin/python" -q -r requirements-arm.txt
  echo "== LeRobot calibration files -> ~/.cache/huggingface/lerobot/calibration/robots/so_follower/"
  mkdir -p ~/.cache/huggingface/lerobot/calibration/robots/so_follower
  for f in my_follower so101_arm; do [ -f ~/.cache/huggingface/lerobot/calibration/robots/so_follower/$f.json ] || cp calib/$f.json ~/.cache/huggingface/lerobot/calibration/robots/so_follower/; done
fi

echo "== checks"
.venv/bin/python -c "import mujoco, numpy, imageio, qrcode; print('  sim env ok: mujoco', mujoco.__version__)"
[ "${1:-}" = "--no-arm" ] || "$ARM_ENV/bin/python" -c "import lerobot, serial; from lerobot.motors.feetech import FeetechMotorsBus; print('  arm env ok: lerobot', __import__('importlib.metadata').metadata.version('lerobot'))"
[ -f "$SO_ARM_DIR/Simulation/SO101/so101_new_calib.xml" ] && echo "  arm models ok" || echo "  WARNING: $SO_ARM_DIR has no Simulation/SO101/so101_new_calib.xml"
cat <<TXT

Done. To run:
  ./studio.sh                         move studio        -> http://localhost:8765   (sim only needs .venv)
  cd joust && ./start_live.sh --mock  the game, no arms  -> http://localhost:8770/?hw=live&mode=simple
  cd joust && ./start_live.sh         the game, real arms (starts the daemon from $ARM_ENV; plug in A, B and the gantry first)
  python3 arm/duel_sequence.py sim/safe_show.json --dry   the scripted show (drop --dry to play it)
Ports and ids: arm/common.py (ARM_PORT / ARM_B_PORT / ARM_ID / ARM_B_ID), arm/arms.json (gantry). Studio python for the
daemon: SO_ARM_PY=$ARM_ENV/bin/python if the env lives elsewhere. Game server python: PYTHON=.venv/bin/python (has qrcode).
TXT
