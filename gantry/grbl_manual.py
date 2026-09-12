"""Interactive X/Y control and approximate switch referencing for GRBL 0.9j.

No Z commands, firmware homing ($H), or firmware soft limits are used.
Assumes negative-end X/Y switches, $3=2, 200 mm usable travel from the
backed-off home position, $10=19,
$13=0, $20=0, $21=1, and $22=0. Start with both switches released.
Close other serial senders before running; opening USB can reset GRBL.
"""

import argparse
from collections import deque
import errno
import math
import re
import time

import serial
from serial.tools import list_ports


DEFAULT_HOME_FEED = 150
DEFAULT_MAX_FEED = 24000
TRAVEL_MM = 200
PULL_OFF_MM = 1
SEARCH_MM = TRAVEL_MM + PULL_OFF_MM


class ControllerError(RuntimeError):
    pass


class Alarm(ControllerError):
    pass


def number(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("Numbers must be finite.")
    return value


def parse_status(line):
    state = line[1:-1].split(",", 1)[0]
    limits = re.search(r"(?:,|^)Lim:([01]{3})(?=,|>)", line)
    position = re.search(r"WPos:([^>]+?)(?=,[A-Za-z]+:|>)", line)
    if not limits or not position:
        raise ControllerError("Expected GRBL 0.9 Lim and WPos fields; set $10=19 and $13=0.")
    coords = tuple(float(value) for value in position[1].split(","))
    if len(coords) != 3 or not all(math.isfinite(v) for v in coords):
        raise ControllerError("Invalid position report.")
    # GRBL 0.9 prints logical axis bits as ZYX: X=001, Y=010, Z=100.
    return state, int(limits[1], 2), coords


class XYController:
    def __init__(self, port, home_feed=DEFAULT_HOME_FEED, max_feed=DEFAULT_MAX_FEED, verbose=False):
        self.port = port
        self.home_feed = home_feed
        self.max_feed = max_feed
        self.feed = 300.0
        self.homed = False
        self.motion_may_be_active = False
        self.limits_may_be_disabled = False
        self.partial = b""
        self.verbose = verbose
        self.recent = deque(maxlen=12)

    def write(self, data):
        if self.verbose:
            print(f"> {data!r}", flush=True)
        self.port.write(data)

    def line(self, check=True):
        self.partial += self.port.readline()
        if not self.partial.endswith(b"\n"):
            return ""
        line = self.partial.decode("ascii", errors="replace").strip()
        self.partial = b""
        if line:
            self.recent.append(line)
            if self.verbose:
                print(f"< {line}", flush=True)
        if check:
            if line.startswith("ALARM:"):
                raise Alarm(line)
            if line.startswith("error:"):
                raise ControllerError(line)
            if line.startswith("Grbl "):
                raise ControllerError("Controller restarted unexpectedly; reference is lost.")
        return line

    def send(self, command, timeout=5):
        if "\n" in command or "\r" in command or len(command) > 79:
            raise ValueError("Invalid command line.")
        self.write((command + "\n").encode("ascii"))
        deadline = time.monotonic() + timeout
        replies = []
        while time.monotonic() < deadline:
            line = self.line()
            if line == "ok":
                return replies
            if line:
                replies.append(line)
        raise ControllerError(f"Timed out waiting for {command!r}.")

    def status(self):
        self.write(b"?")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            line = self.line()
            if line.startswith("<") and line.endswith(">"):
                return parse_status(line)
        raise ControllerError("No status response.")

    def ready(self):
        state, pins, coords = self.status()
        if state != "Idle" or pins:
            raise ControllerError(f"Expected Idle with released switches; got {state}, Lim:{pins:03b}.")
        return coords

    def reset(self):
        self.homed = False
        self.write(b"\x18")
        self.port.flush()
        self.partial = b""
        deadline = time.monotonic() + 5
        critical_retries = 0
        while time.monotonic() < deadline:
            line = self.line(check=False)
            if line.startswith("Grbl 0.9"):
                self.motion_may_be_active = False
                return
            if "reset to continue" in line.lower() and critical_retries < 2:
                # GRBL 0.9 reports ALARM, waits 500 ms, prints this prompt,
                # then clears EXEC_RESET before entering the critical loop.
                # The immediate stop request above can therefore be discarded.
                time.sleep(0.05)
                self.write(b"\x18")
                self.port.flush()
                critical_retries += 1
                deadline = time.monotonic() + 5
        received = " | ".join(self.recent) or "(no complete lines)"
        raise ControllerError(f"No GRBL 0.9 startup response after reset. Recent replies: {received}")

    def preflight(self):
        rows = self.send("$$")
        settings = {}
        for row in rows:
            match = re.match(r"\$(\d+)=([-+0-9.]+)", row)
            if match:
                settings[int(match[1])] = float(match[2])
        required = {3: 2, 13: 0, 20: 0, 21: 1, 22: 0, 130: 200, 131: 200}
        for key, value in required.items():
            if settings.get(key) != value:
                raise ControllerError(f"This setup requires ${key}={value}; got {settings.get(key)}.")
        if int(settings.get(10, 0)) & 19 != 19:
            raise ControllerError("Set $10=19 so position and switch state are available.")
        for row in self.send("$N"):
            if re.match(r"\$N\d+=.+", row):
                raise ControllerError("Nonempty startup blocks found. Remove them before using this script.")
        self.max_feed = min(self.max_feed, settings.get(110, 0), settings.get(111, 0))
        if self.max_feed <= 0 or self.home_feed > self.max_feed:
            raise ControllerError("Configured X/Y speeds are too low for the requested homing feed.")
        self.feed = min(self.feed, self.max_feed)

    def motion(self, command, timeout):
        self.motion_may_be_active = True
        self.send(command)
        # Acknowledging G1 only means queued; this dwell waits for completion.
        self.send("G4 P0.01", timeout=timeout)
        self.motion_may_be_active = False

    def back_off(self, axis):
        # Called only after confirming exactly the expected switch is active.
        # Release edges can retrigger a hard-limit interrupt in GRBL 0.9.
        self.limits_may_be_disabled = True
        self.send("$21=0")
        self.send("$X")
        self.motion(f"G21 G91 G94 G1 {axis}{PULL_OFF_MM} F{self.home_feed:.3f}",
                    PULL_OFF_MM / self.home_feed * 60 + 30)
        self.ready()
        self.send("$21=1")
        self.limits_may_be_disabled = False
        self.ready()

    def release_axis(self, axis):
        """Explicit recovery for exactly one already-pressed negative switch."""
        self.homed = False
        state, pins, _ = self.status()
        if state not in ("Idle", "Alarm") or pins != {"X": 1, "Y": 2}[axis]:
            raise ControllerError(f"Release requires only {axis} pressed and Idle/Alarm; got {state}, Lim:{pins:03b}.")
        print(f"Releasing {axis}: moving +1 mm, then restoring hard limits.", flush=True)
        self.back_off(axis)

    def home_axis(self, axis):
        self.ready()
        print(f"Referencing {axis}: moving negative at {self.home_feed:g} mm/min (up to {SEARCH_MM} mm).", flush=True)
        try:
            self.motion(f"G21 G91 G94 G1 {axis}-{SEARCH_MM} F{self.home_feed:.3f}",
                        SEARCH_MM / self.home_feed * 60 + 30)
        except Alarm as error:
            if str(error).strip().lower() not in ("alarm: hard limit", "alarm:hard limit", "alarm: 1", "alarm:1"):
                raise
        else:
            raise ControllerError(f"{axis} travelled {SEARCH_MM} mm without a hard-limit alarm. No reference established.")
        self.reset()
        state, pins, _ = self.status()
        expected = {"X": 1, "Y": 2}[axis]
        if pins != expected or state not in ("Idle", "Alarm"):
            raise ControllerError(f"Expected only {axis} switch active after alarm; got {state}, Lim:{pins:03b}.")
        self.back_off(axis)
        print(f"{axis} switch verified; backed off 1 mm.", flush=True)

    def home(self):
        self.homed = False
        self.preflight()
        self.ready()
        self.home_axis("X")
        self.home_axis("Y")
        # Both axes remain 1 mm off their switches. Resetting on Y erased the
        # earlier coordinate reference, so assign BOTH work coordinates now.
        self.send("G21 G90 G94 G54")
        self.send("G10 L20 P1 X0 Y0")
        self.ready()
        self.homed = True
        print(f"Reference complete: X=0, Y=0. Allowed commands: 0 through {TRAVEL_MM} mm.")

    def move(self, axes, feed=None):
        if not self.homed:
            raise ValueError("Home both axes first.")
        feed = self.feed if feed is None else feed
        if not math.isfinite(feed) or not 0.001 <= feed <= self.max_feed:
            raise ValueError(f"Feed must be at least 0.001 and at most {self.max_feed:g} mm/min.")
        feed = round(feed, 3)
        if not axes or set(axes) - {"X", "Y"}:
            raise ValueError("Specify X, Y, or both; Z is not supported.")
        for axis, value in axes.items():
            if not math.isfinite(value) or not 0 <= value <= TRAVEL_MM:
                raise ValueError(f"{axis} must be between 0 and {TRAVEL_MM} mm.")
        current = self.ready()
        distance = math.hypot(axes.get("X", current[0]) - current[0],
                              axes.get("Y", current[1]) - current[1])
        words = " ".join(f"{axis}{value:.3f}" for axis, value in axes.items())
        self.motion(f"G21 G90 G94 G54 G1 {words} F{feed:.3f}", distance / feed * 60 + 30)
        self.ready()
        self.feed = feed

    def abort(self):
        """Discard queued motion and reference; restore protection if possible."""
        self.homed = False
        if not self.motion_may_be_active and not self.limits_may_be_disabled:
            return
        try:
            self.reset()
            if self.limits_may_be_disabled:
                self.send("$21=1")
                self.limits_may_be_disabled = False
        except (Exception, KeyboardInterrupt) as error:
            print(f"Could not complete reset/recovery: {error}")
        if self.limits_may_be_disabled:
            print("HARD LIMITS MAY BE OFF. Restore $21=1 before operating the machine.")


HELP = """Commands (absolute positions in mm, feed in mm/min):
  x 150             Move X only, using the current feed
  y 100 f 600       Move Y only at 600 mm/min
  x 50 y 80 f 300   Coordinated move of both axes
  G1 X50 Y80 F300   Same restricted command syntax, also accepted
  f 500              Set feed for subsequent moves
  status             Show work position and switch bits
  home               Reference X then Y again
  help               Show this help
  quit               Exit after completed motion
Ctrl+C during motion resets GRBL, exits, and invalidates the reference.
No raw G-code, Z moves, or settings commands are accepted here.
"""


def parse_move(text):
    text = re.sub(r"^\s*G0?1\b", "", text, flags=re.I)
    result = {}
    while text.strip():
        match = re.match(r"\s*([XYF])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))", text, flags=re.I)
        if not match:
            raise ValueError("Use e.g. x 100 y 50 f 300. Type help for commands.")
        key = match[1].upper()
        if key in result:
            raise ValueError(f"Duplicate {key} value.")
        result[key] = number(match[2])
        text = text[match.end():]
    if not result:
        raise ValueError("Specify a position or feed.")
    return result


def console(cnc):
    print(HELP)
    while True:
        try:
            text = input("xy> ").strip()
        except EOFError:
            return
        if not text:
            continue
        if text.lower() in ("quit", "exit"):
            return
        if text.lower() == "help":
            print(HELP)
        elif text.lower() == "home":
            cnc.home()
        elif text.lower() in ("status", "?"):
            state, pins, coords = cnc.status()
            print(f"{state}: X={coords[0]:.3f}, Y={coords[1]:.3f}, Lim(ZYX)={pins:03b}, F={cnc.feed:g}")
        else:
            try:
                values = parse_move(text)
                feed = values.pop("F", cnc.feed)
                if not 0.001 <= feed <= cnc.max_feed:
                    raise ValueError(f"Feed must be at least 0.001 and at most {cnc.max_feed:g} mm/min.")
                feed = round(feed, 3)
                if values:
                    cnc.move(values, feed)
                else:
                    cnc.feed = feed
                print(f"Done. Feed={cnc.feed:g} mm/min")
            except ValueError as error:
                print(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", help="e.g. COM3 or /dev/cu.usbserial-...")
    parser.add_argument("--list-ports", action="store_true")
    parser.add_argument("--home-feed", type=float, default=DEFAULT_HOME_FEED, help="Reference speed, 1-150 mm/min (default 150)")
    parser.add_argument("--max-feed", type=float, default=DEFAULT_MAX_FEED, help="Console feed ceiling in mm/min (default 24000)")
    parser.add_argument("--verbose", action="store_true", help="Print serial commands and controller replies")
    parser.add_argument("--release-axis", choices=("X", "Y"), help="Back an already-pressed switch off +1 mm before referencing")
    args = parser.parse_args()
    if args.list_ports:
        for port in list_ports.comports():
            print(f"{port.device}: {port.description}")
        return
    if not args.port:
        parser.error("Specify a port, or use --list-ports.")
    if not math.isfinite(args.home_feed) or not 1 <= args.home_feed <= 150:
        parser.error("--home-feed must be 1-150 mm/min.")
    if not math.isfinite(args.max_feed) or args.max_feed <= 0:
        parser.error("--max-feed must be finite and positive.")
    print("Will reference negative X and Y switches, then open the position console.")
    print("Requires 200 mm usable travel from the backed-off home position and the other sender closed.")
    if not args.release_axis:
        print("Start with both switches released, or use --release-axis X/Y for one pressed switch.")
    try:
        connection = serial.Serial(args.port, 115200, timeout=0.2, write_timeout=2)
    except serial.SerialException as error:
        if error.errno == errno.EBUSY:
            print(f"Port {args.port} is busy. Disconnect it in gSender (or quit gSender), then retry.")
        else:
            print(f"Could not open {args.port}: {error}")
        return 1
    with connection as port:
        time.sleep(2)
        port.reset_input_buffer()
        cnc = XYController(port, args.home_feed, args.max_feed, args.verbose)
        try:
            if args.release_axis:
                cnc.preflight()
                cnc.release_axis(args.release_axis)
            cnc.home()
            console(cnc)
        except (Exception, KeyboardInterrupt) as error:
            print(f"Stopped: {error or 'Ctrl+C'}. Reference is invalid; re-home before further moves.")
            cnc.abort()
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
