#!/usr/bin/env bash
# Bring up a live show: check the three serial devices, start the arm daemon if it is not already up, then
# start the game server pointed at it.
#
#   ./start_live.sh                 the real arms   (port 8770)
#   ./start_live.sh 8771            on another port
#   ./start_live.sh --mock          rehearse with tools/mock_daemon.py: no hardware, same API, same timing
#   ./start_live.sh --mock --fast   the mock at six times speed, for a quick run-through
#
# Then open http://localhost:<port>/?hw=live  and press "Prepare arms" in the host drawer before the first
# fight. The gantry has to be referenced once per power-up; nothing will move until it is.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${JOUST_REPO:-$( [ -f "$HERE/../arm/motions_tuned.json" ] && (cd "$HERE/.." && pwd) || (cd "$HERE/../robot-jousting" 2>/dev/null && pwd) )}"   # joust/ lives inside the repo
PORT=8770
MOCK=0
SPEED=1
for a in "$@"; do
  case "$a" in
    --mock) MOCK=1 ;;
    --fast) SPEED=6 ;;
    [0-9]*) PORT="$a" ;;
    *) echo "unknown argument: $a" >&2; exit 2 ;;
  esac
done
ARM_PORT_URL="http://127.0.0.1:${ARM_DAEMON_PORT:-8766}"

if [ -z "$REPO" ] || [ ! -d "$REPO/arm" ]; then
  echo "cannot find the robot-jousting checkout (set JOUST_REPO)" >&2; exit 1
fi

# ---- the three serial devices -----------------------------------------------------------------------------
# Two LeRobot arms and one GRBL gantry. Their paths live in arm/common.py (arms, overridable by env) and
# arm/arms.json (gantry). A missing one here is a cable, a power switch, or a port name that changed when
# the USB hub re-enumerated -- always check this before blaming the software.
devices() {
  "${PYTHON:-python3}" - "$REPO" <<'PY'
import json, os, re, sys
repo = sys.argv[1]
src = open(os.path.join(repo, "arm", "common.py")).read()
def dflt(var, key):
    m = re.search(r'"%s":\s*os\.environ\.get\("%s",\s*"([^"]+)"\)' % (key, var), src)
    return m.group(1) if m else ""
print("A", os.environ.get("ARM_PORT") or dflt("ARM_PORT", "port"))
print("B", os.environ.get("ARM_B_PORT") or dflt("ARM_B_PORT", "port"))
print("G", json.load(open(os.path.join(repo, "arm", "arms.json")))["gantry"]["port"])
PY
}

if [ "$MOCK" = "0" ]; then
  echo "checking the serial devices..."
  missing=0
  while read -r which dev; do
    if [ -e "$dev" ]; then echo "  ok      $which  $dev"
    else echo "  MISSING $which  $dev"; missing=1; fi
  done < <(devices)
  if [ "$missing" = "1" ]; then
    echo
    echo "One or more devices are not there. Plug them in and power them up, then look at what IS there:"
    echo "  ls /dev/cu.usb*"
    echo "If a name has changed, set ARM_PORT / ARM_B_PORT, or edit the gantry port in arm/arms.json."
    echo "To rehearse without hardware instead:  ./start_live.sh --mock"
    exit 1
  fi
fi

# ---- the daemon --------------------------------------------------------------------------------------------
if curl -s -m 2 "$ARM_PORT_URL/status" >/dev/null 2>&1; then
  echo "a daemon is already answering on $ARM_PORT_URL"
elif [ "$MOCK" = "1" ]; then
  echo "starting the MOCK daemon on $ARM_PORT_URL (speed x$SPEED) -- no hardware is touched"
  nohup "${PYTHON:-python3}" "$HERE/tools/mock_daemon.py" --port "${ARM_DAEMON_PORT:-8766}" --speed "$SPEED" \
    < /dev/null >> "$HERE/tools/mock_daemon.log" 2>&1 &
  for i in $(seq 1 20); do curl -s -m 1 "$ARM_PORT_URL/status" >/dev/null 2>&1 && break; sleep 0.5; done
else
  echo "starting the arm daemon..."
  "$REPO/arm/run_daemon.sh" || exit 1
fi
curl -s -m 3 "$ARM_PORT_URL/status" | head -c 500; echo

# ---- the game server ----------------------------------------------------------------------------------------
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo
  echo "something is already listening on :$PORT. Stop it first:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi

echo
echo "starting the game server on :$PORT"
echo "  ARM_A_URL=$ARM_PORT_URL"
echo "  ARM_B_URL=$ARM_PORT_URL   (one daemon drives both arms; every POST carries {\"arm\":\"A\"|\"B\"})"
echo "  JOUST_REPO=$REPO          (so /api/exchange compiles the chains with sim/chain.py)"
echo
echo "  the big screen:  http://localhost:$PORT/?hw=live"
echo "  on this network: http://$(ipconfig getifaddr en0 2>/dev/null || echo '<lan-ip>'):$PORT/?hw=live"
if curl -s -m 1 http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
  echo "  ngrok is running on :4040 -- server.py picks its https URL up on its own for the phone QR codes."
else
  echo "  For phones on a hostile Wi-Fi: 'ngrok http $PORT' (it is at /opt/homebrew/bin/ngrok), or set"
  echo "  PUBLIC_URL=https://... before this script to point the QR codes somewhere specific."
fi
echo
echo "  FIRST THING in the host drawer: Prepare arms. The gantry needs referencing once per power-up."
echo
exec env ARM_A_URL="$ARM_PORT_URL" ARM_B_URL="$ARM_PORT_URL" JOUST_REPO="$REPO" \
  "${PYTHON:-python3}" "$HERE/server.py" "$PORT"
