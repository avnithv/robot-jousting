"""Control an xPRO running GRBL 0.9 over USB using pyserial.

Use --home ONLY after flashing firmware configured for X/Y-only homing
and enabling homing with $22=1. This homes, then sets work X0 Y0 at the
backed-off position. Alternatively --zero-current only sets work zero.
Movement happens only when --x or --y is supplied.
Close other G-code senders before connecting. Opening USB may reset GRBL.
"""

import argparse
import math
import re
import time

import serial


class Grbl:
    def __init__(self, connection):
        self.connection = connection

    def read_line(self):
        line = self.connection.readline().decode("ascii", errors="replace").strip()
        if line:
            print("<", line)
        if line.lower().startswith(("error:", "alarm:")):
            raise RuntimeError(line)
        if line.startswith("Grbl "):
            raise RuntimeError("Controller restarted; position must be re-established.")
        return line

    def require_idle(self):
        self.connection.write(b"?")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            line = self.read_line()
            if line.startswith("<") and line.endswith(">"):
                state = re.split(r"[,|>]", line[1:], maxsplit=1)[0]
                if state.lower() != "idle":
                    raise RuntimeError(f"Controller is {state}; resolve this before running.")
                return
        raise TimeoutError("No GRBL status response. Check the port and baud rate.")

    def send(self, command, timeout=300):
        """Send one line and wait for its acknowledgement, ignoring status messages."""
        if "\n" in command or "\r" in command:
            raise ValueError("Send one G-code line at a time.")
        print(">", command)
        self.connection.write((command + "\n").encode("ascii"))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.read_line() == "ok":
                return
        raise TimeoutError(f"No acknowledgement for {command!r}.")

    def zero_xy(self):
        """Declare the current location X=0, Y=0 in G54, without moving."""
        self.require_idle()
        for command in ("G21", "G90", "G94", "G54", "G10 L20 P1 X0 Y0"):
            self.send(command)

    def home(self, timeout=1200):
        """Run the firmware's configured homing cycle (not axis-selective).

        Requires X/Y-only firmware and $22=1 for this two-axis setup.
        A long timeout accommodates sequential 400 mm axes at 100 mm/min.
        """
        try:
            self.send("$H", timeout=timeout)
            self.require_idle()
        except (Exception, KeyboardInterrupt):
            # Feed hold does not abort GRBL 0.9 homing; a soft reset does.
            self.connection.write(b"\x18")
            self.connection.flush()
            raise

    def move_to(self, *, x=None, y=None, feed=300):
        """Move to absolute work coordinates in mm; omitted axes stay put.

        Feed is mm/min. Returns after the commanded motion finishes.
        """
        if x is None and y is None:
            raise ValueError("Specify x, y, or both.")
        if not math.isfinite(feed) or feed <= 0:
            raise ValueError("Feed must be finite and positive.")
        words = ["G21 G90 G94 G54 G1"]
        for axis, value in (("X", x), ("Y", y)):
            if value is not None:
                if not math.isfinite(value):
                    raise ValueError("Coordinates must be finite.")
                words.append(f"{axis}{value:.4f}")
        words.append(f"F{feed:.4f}")
        self.send(" ".join(words))
        # GRBL 0.9 documents a short dwell as a motion-completion barrier.
        self.send("G4 P0.01")


def finite_number(value):
    number = float(value)
    if not math.isfinite(number):
        raise argparse.ArgumentTypeError("Must be a finite number.")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="USB serial port, e.g. COM3 or /dev/cu.usbserial-...")
    origin = parser.add_mutually_exclusive_group(required=True)
    origin.add_argument("--home", action="store_true", help="Home with configured XY-only firmware, then set work zero")
    origin.add_argument("--zero-current", action="store_true", help="Set current position as work zero without homing")
    parser.add_argument("--x", type=finite_number, help="Optional X target in mm")
    parser.add_argument("--y", type=finite_number, help="Optional Y target in mm")
    parser.add_argument("--feed", type=finite_number, default=300, help="Feed in mm/min (default: 300)")
    parser.add_argument("--separate", action="store_true", help="Move X first, then Y")
    args = parser.parse_args()
    if args.feed <= 0:
        parser.error("--feed must be positive")

    with serial.Serial(args.port, 115200, timeout=0.5, write_timeout=2) as connection:
        try:
            # Allow the usual USB-open reset and startup text to finish.
            time.sleep(2)
            connection.reset_input_buffer()
            cnc = Grbl(connection)
            if args.home:
                cnc.home()
            cnc.zero_xy()
            if args.separate:
                if args.x is not None:
                    cnc.move_to(x=args.x, feed=args.feed)
                if args.y is not None:
                    cnc.move_to(y=args.y, feed=args.feed)
            elif args.x is not None or args.y is not None:
                cnc.move_to(x=args.x, y=args.y, feed=args.feed)
            print("Requested operations completed.")
        except (Exception, KeyboardInterrupt):
            # Best effort feed hold; this is not a hardware emergency stop.
            try:
                connection.write(b"!")
                connection.flush()
            except serial.SerialException:
                pass
            raise


if __name__ == "__main__":
    main()
