#!/usr/bin/env bash
# Start the two-arm + gantry daemon (arm/arm_daemon.py) the way it wants to be started.
#
#   ./arm/run_daemon.sh            start it in the background, log to arm/daemon.log
#   ./arm/run_daemon.sh -f         run it in the foreground instead (Ctrl-C to stop)
#   ./arm/run_daemon.sh stop       stop the one this script started
#   ./arm/run_daemon.sh log        follow the log
#
# Three things this gets right that a bare `python arm_daemon.py` does not:
#   * the lerobot python. The daemon imports lerobot.robots.so_follower, which only exists in that env.
#   * stdin from /dev/null. LeRobot's connect(calibrate=True) will PROMPT on the terminal if it decides the
#     saved calibration does not match; a daemon that blocks on input() looks exactly like a hung daemon.
#     With no stdin it raises instead, and the error lands in the log where you can see it.
#   * one at a time. Two daemons cannot share the serial ports, and the second one's failure to open them
#     looks like a hardware fault. This refuses to start a second.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${LEROBOT_PYTHON:-}"
if [ -z "$PY" ]; then   # whichever lerobot env this machine has
  for cand in "${SO_ARM_PY:-}" "${SO_ARM_ENV:-$HOME/so-arm/.venv}/bin/python" "$HOME/so-arm/.venv/bin/python" "$HOME/anaconda3/envs/lerobot/bin/python"; do [ -n "$cand" ] && [ -x "$cand" ] && PY="$cand" && break; done
  PY="${PY:-$HOME/anaconda3/envs/lerobot/bin/python}"
fi
LOG="$HERE/daemon.log"
PIDFILE="$HERE/.daemon.pid"
PORT="${ARM_DAEMON_PORT:-8766}"

running() { curl -s -m 2 "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; }

case "${1:-start}" in
  stop)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      kill "$(cat "$PIDFILE")" && echo "stopped daemon $(cat "$PIDFILE")"
      rm -f "$PIDFILE"
    else
      echo "no daemon started by this script (pid file $PIDFILE)"
      echo "if something else is on :$PORT:  lsof -nP -iTCP:$PORT -sTCP:LISTEN"
    fi
    exit 0 ;;
  log)
    exec tail -f "$LOG" ;;
esac

if [ ! -x "$PY" ]; then
  echo "no lerobot python at $PY" >&2
  echo "set LEROBOT_PYTHON=/path/to/python (the env with lerobot installed)" >&2
  exit 1
fi
if running; then
  echo "a daemon is already answering on http://127.0.0.1:$PORT -- leaving it alone"
  curl -s -m 2 "http://127.0.0.1:$PORT/status" | head -c 400; echo
  exit 0
fi

echo "arm daemon: $PY $HERE/arm_daemon.py  ->  http://127.0.0.1:$PORT"
echo "log: $LOG"
if [ "${1:-start}" = "-f" ]; then
  exec "$PY" "$HERE/arm_daemon.py" < /dev/null
fi

# nohup + setsid-equivalent: survives this shell closing, which matters when the show is already running.
nohup "$PY" "$HERE/arm_daemon.py" < /dev/null >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "started pid $(cat "$PIDFILE"), waiting for it to open the ports..."
for i in $(seq 1 40); do
  if running; then
    echo "up. arms and gantry:"
    curl -s -m 2 "http://127.0.0.1:$PORT/status" | head -c 600; echo
    exit 0
  fi
  # Connecting two arms takes a few seconds each, and each has three attempts before it gives up.
  sleep 1
done
echo "the daemon did not answer within 40 s. Last of the log:" >&2
tail -n 30 "$LOG" >&2
exit 1
