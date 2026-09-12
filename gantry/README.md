# X/Y Python controller for the CNC xPRO V3 / GRBL 0.9j

Use **`grbl_manual.py`** for the current two-axis setup. The older
`grbl_control.py` is a separate example using firmware homing and is not the
script described here.

This script performs approximate switch referencing in Python without `$H`,
Z movement, or a firmware change. It then opens an interactive position/feed
console. It has been tested with a simulated controller, not physical hardware.

## Setup and run

Close the CNC sender so Python has exclusive use of the serial port. Both
physical switches must initially be released and the controller must be Idle.
Each axis must have 200 mm of usable travel **from the backed-off home position**,
with negative motion toward its
own limit switch. The script assumes the user's existing direction setting
`$3=2` and calibrated steps/mm.

If a previous attempt left **only X** pressing its switch, use this guarded
recovery command instead of starting with both switches released:

```sh
.venv/bin/python grbl_manual.py /dev/cu.usbserial-AL00JZ0H --release-axis X --verbose
```

It verifies X's switch is active (and Y/Z are clear), backs X off +1 mm,
restores hard limits, and then references both axes. Use `--release-axis Y`
for only Y pressed. It refuses an unexpected switch or a running controller.
`--verbose` prints serial traffic and can also be used on ordinary runs.
Only use the device path above if it is still your xPRO's port.

On macOS/Linux:

```sh
cd robot-jousting/gantry
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python grbl_manual.py --list-ports
.venv/bin/python grbl_manual.py /dev/cu.usbserial-YOUR_PORT
```

Replace the example port with the exact output from `--list-ports`.
On Windows, install pyserial with `py -m pip install pyserial` and run
`py grbl_manual.py COM3`, substituting the actual COM port.

**Running with a port immediately starts referencing X, then Y.** The default
approach speed is **150 mm/min**, with up to
201 mm of search on each axis: 200 mm travel plus the 1 mm home-to-switch gap.
Starting at the far end takes about 80 seconds per axis for the search.
Use `--home-feed 25` to return to the original speed (allowed range 1–150 mm/min).

Opening a serial connection can reset GRBL. The script checks for nonempty
startup blocks and refuses to operate if it finds them. Do not configure
automatic startup movements on a controller used with this script.

## What the script does

1. Check `$3=2`, `$13=0`, `$20=0`, `$21=1`, `$22=0`, and `$130=$131=200`.
   `$10` must include the position and switch-state fields (`$10=19` works).
2. Move only X in the negative direction at the slow referencing feed. Hard
   limits stay enabled, so the controller stops itself when a switch triggers.
3. Accept only a hard-limit alarm. Reset GRBL, then check that exactly the X
   switch remains active. A missing or wrong switch fails the procedure.
   GRBL 0.9 delays after printing the alarm and clears an early reset. The
   script reissues the reset after `[Reset to continue]`, before accepting a
   new startup banner. No unlock or back-off occurs without that handshake.
4. Temporarily set `$21=0`, unlock, move X **+1 mm**, verify all switches are
   released, and restore `$21=1`. GRBL 0.9 can otherwise alarm on the release
   edge as well. If 1 mm does not release the switch, stop; do not keep backing
   off automatically.
5. Repeat for Y. Finally assign **both** G54 work positions to **zero** using
   `G10 L20 P1 X0 Y0`, since the resets invalidate earlier coordinates.

The backed-off home positions are **X=0, Y=0**, with the physical switch contacts
nominally at -1 mm. Positive commands move away from the switches. The console
accepts positions **from 0 through 200 mm**, measured from this backed-off zero.
This requires 200 mm of physical clearance beyond that zero; the old switch-based
200 mm travel setting alone does not establish this clearance. This is a Python-enforced work
coordinate boundary. Firmware soft limits remain off, and other senders do
not inherit this Python boundary.

This method intentionally uses a hard-limit stop. GRBL cannot guarantee step
position after such a stop, and releasing/re-enabling motors can add error.
Treat the reference as approximate; use firmware configured for X/Y homing
when repeatability or machining accuracy matters. No Z settings need to change
for this script. `$23` is unused because this script does not invoke `$H`.

## Position and speed commands

```text
xy> x 150 f 300
xy> y 100 f 500
xy> x 50 y 80 f 600
xy> f 1000
xy> x 0
xy> status
xy> home
xy> quit
```

Positions are absolute millimeters in G54. Omitted axes stay in place.
Feed is millimeters per minute and persists for subsequent moves. The feed
ceiling defaults to 24000 mm/min, further limited by the controller's X/Y
maximum rates; `--max-feed` can set a lower or higher application ceiling.
The default feed after referencing is 300 mm/min.

The restricted syntax `G1 X100 Y50 F500` is also accepted. Arbitrary G-code,
settings, Z, and relative-mode commands are rejected. A move involving both
axes is coordinated, with one path feed; it does not give each motor an
independent concurrent speed.

Each move finishes before the next prompt appears. Changing `f` affects the
next move, not a move already in progress. Press **Ctrl+C** during a move to
request a controller reset, discard queued movement, and exit. The reference
is then invalid. A serial command cannot substitute for a physical emergency
stop or guarantee stopping after a USB disconnection.

Unexpected alarms exit the program instead of automatically unlocking and
continuing. Recovery attempts to restore `$21=1` if back-off was interrupted.
Because `$21` is persistent, **a process kill, power loss, or disconnection
during back-off may leave hard limits disabled**. If restoration cannot be
confirmed, the script prints a warning; reconnect and restore `$21=1` before
operating. After a failed reference, inspect/release the switches and start
again with the controller Idle.

## Use from another Python script

Import `XYController` from `grbl_manual.py`. Importing the module does not open
the serial port, move the machine, or launch the interactive console.
Keep your script beside `grbl_manual.py`, or add its directory to Python's
import path. Use the project virtual environment so pyserial is available.

Close gSender and the interactive controller first: only one process should
own the serial connection. Start with both switches released. The same setup
requirements and approximate referencing behavior described above apply.

```python
import time
import serial
from grbl_manual import XYController

with serial.Serial(
    "/dev/cu.usbserial-AL00JZ0H",
    115200,
    timeout=0.2,
    write_timeout=2,
) as port:
    time.sleep(2)  # Allow the USB-open reset to finish.
    port.reset_input_buffer()

    cnc = XYController(port, home_feed=150, max_feed=24000)

    try:
        cnc.home()                       # Reference X/Y and set work zero.
        cnc.move({"X": 100}, feed=6000)   # X only.
        cnc.move({"Y": 150}, feed=6000)   # Y only.
        cnc.move({"X": 0, "Y": 0}, feed=12000)

        state, switches, position = cnc.status()
        print(state, position[:2])
    finally:
        cnc.abort()  # Stop pending motion and restore hard limits if needed.
```

Replace the port with your controller's actual serial device. Running this
example immediately starts referencing and then executes the example moves.
`abort()` performs best-effort recovery; keep it in `finally` to handle
exceptions and Ctrl+C. The serial context manager closes the connection.

| API | Behavior |
| --- | --- |
| `cnc.home()` | Check configuration, reference X then Y, and set G54 X/Y to zero. |
| `cnc.move({"X": 100}, feed=6000)` | Move specified axes to absolute positions in 0–200 mm; omitted axes stay put. |
| `cnc.move({"Y": 50})` | Use the last successful move's feed, initially 300 mm/min. |
| `cnc.status()` | Return `(state, switch_bits, (x, y, z))`; positions are G54 work positions with this setup. Switch bits are X=1, Y=2, Z=4. |
| `cnc.abort()` | Invalidate the reference, reset pending motion, and attempt to restore temporarily disabled hard limits. |

Feed values are in mm/min. Each `move()` blocks until motion finishes; a move
with both axes uses one coordinated path feed. `home()` limits the requested
maximum feed to the controller's X/Y maximum rates. Use the controller from
one thread at a time; it does not synchronize concurrent calls.

## Offline checks

```sh
.venv/bin/python -m unittest -v test_grbl_manual.py
```

Tests use an in-memory simulated serial controller and never open hardware.

References: [GRBL 0.9 settings](https://github.com/grbl/grbl/wiki/Configuring-Grbl-v0.9),
[serial protocol and motion completion](https://github.com/grbl/grbl/wiki/Interfacing-with-Grbl),
[limit switch reporting](https://github.com/grbl/grbl/blob/master/grbl/report.c).
