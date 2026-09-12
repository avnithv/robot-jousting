#!/bin/zsh
# Replay a tuned move on the real SO-101.
#   ~/game/arm/replay.sh                     # ATTACK_HIGH, full speed
#   ~/game/arm/replay.sh ATTACK_HIGH 0.5     # half speed
#   ~/game/arm/replay.sh ATTACK_HIGH 1.0 3   # three times in a row
# Always: torque on -> ease to REST -> play -> ease back to REST -> torque off. Stay clear of the arm.
MOVE=${1:-ATTACK_HIGH}; SCALE=${2:-1.0}; REPEAT=${3:-1}
exec ${SO_ARM_PY:-$HOME/so-arm/.venv/bin/python} "$(dirname "$0")/play_motion.py" "$MOVE" --scale "$SCALE" --repeat "$REPEAT" 2>&1 | grep -v "^INFO\|^WARNING"
