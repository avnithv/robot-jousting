"""Offline tests only: never opens a hardware serial port."""

import contextlib
import io
import re
import unittest
from unittest.mock import patch

import serial

from grbl_manual import Alarm, ControllerError, XYController, main, parse_move, parse_status


class FakeGrbl:
    """Simulate acknowledgements, delayed motion alarms, resets and switch states."""
    def __init__(self, wrong_switch=False, missing_switch=False, stuck_switch=False, reset_race=False):
        self.output = []
        self.commands = []
        self.pins = 0
        self.state = "Idle"
        self.position = [0.0, 0.0, 0.0]
        self.pending = None
        self.hard_limits = 1
        self.wrong_switch = wrong_switch
        self.missing_switch = missing_switch
        self.stuck_switch = stuck_switch
        self.reset_race = reset_race
        self.critical_pending = False
        self.settings = {3: 2, 10: 19, 13: 0, 20: 0, 21: 1, 22: 0, 110: 24000,
                         111: 24000, 130: 200, 131: 200}

    def emit(self, text):
        self.output.append((text + "\r\n").encode())

    def write(self, payload):
        self.commands.append(payload)
        if payload == b"\x18":
            if self.critical_pending:
                # GRBL clears an early reset AFTER reporting the alarm and
                # delaying 500 ms. Only a reset after this prompt succeeds.
                self.critical_pending = False
                self.emit("[Reset to continue]")
                return
            self.output.clear()
            self.pending = None
            self.state = "Alarm"
            self.position = [0.0, 0.0, 0.0]
            self.emit("Grbl 0.9j ['$' for help]")
        elif payload == b"?":
            coords = ",".join(str(v) for v in self.position)
            self.emit(f"<{self.state},MPos:0,0,0,WPos:{coords},Lim:{self.pins:03b}>")
        else:
            command = payload.decode().strip()
            if command == "$$":
                for key, value in self.settings.items():
                    self.emit(f"${key}={value}")
            elif command == "$N":
                self.emit("$N0=")
                self.emit("$N1=")
            elif command.startswith("$21="):
                self.hard_limits = int(command[-1])
            elif command == "$X":
                self.state = "Idle"
            elif "G1 " in command:
                self.pending = command
                self.state = "Run"
            elif command == "G4 P0.01":
                motion = self.pending
                self.pending = None
                self.state = "Idle"
                if motion:
                    axes = re.findall(r"([XY])(-?[0-9.]+)", motion)
                    if "G91" in motion and "-201" in motion and not self.missing_switch:
                        self.pins = {"X": 1, "Y": 2}[axes[0][0]]
                        if self.wrong_switch:
                            self.pins = 2 if self.pins == 1 else 1
                        self.state = "Alarm"
                        self.critical_pending = self.reset_race
                        self.emit("ALARM: Hard limit")
                        return
                    if "G91" in motion and "-201" not in motion:
                        if self.hard_limits:
                            raise AssertionError("Release must occur only with hard limits temporarily disabled")
                        if not self.stuck_switch:
                            self.pins = 0
                    for axis, value in axes:
                        index = "XY".index(axis)
                        self.position[index] = self.position[index] + float(value) if "G91" in motion else float(value)
            elif command == "G10 L20 P1 X0 Y0":
                self.position = [0.0, 0.0, 0.0]
            self.emit("ok")

    def readline(self):
        if not self.output:
            raise AssertionError("Unexpected empty receive queue")
        return self.output.pop(0)

    def flush(self):
        pass


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.quiet = contextlib.redirect_stdout(io.StringIO())
        self.quiet.__enter__()

    def tearDown(self):
        self.quiet.__exit__(None, None, None)

    def test_complete_reference_then_independent_motion(self):
        port = FakeGrbl()
        cnc = XYController(port)
        cnc.home()
        self.assertTrue(cnc.homed)
        self.assertEqual(port.position[:2], [0, 0])
        self.assertEqual(port.hard_limits, 1)
        self.assertEqual(port.commands.count(b"\x18"), 2)
        cnc.move({"X": 100}, 500)
        self.assertEqual(port.position[:2], [100, 0])
        cnc.move({"Y": 50}, 300)
        self.assertEqual(port.position[:2], [100, 50])
        cnc.move({"X": 200, "Y": 200}, 800)
        self.assertEqual(port.position[:2], [200, 200])
        cnc.move({"X": 0, "Y": 0}, 800)
        self.assertEqual(port.position[:2], [0, 0])
        self.assertIn(b"G21 G91 G94 G1 X-201 F150.000\n", port.commands)
        self.assertIn(b"G21 G91 G94 G1 Y-201 F150.000\n", port.commands)
        self.assertFalse(any(b"$H" in cmd or re.search(rb"Z[-+0-9]", cmd) for cmd in port.commands))

    def test_wrong_switch_does_not_unlock_or_back_off(self):
        port = FakeGrbl(wrong_switch=True)
        cnc = XYController(port)
        with self.assertRaisesRegex(ControllerError, "Expected only X"):
            cnc.home()
        self.assertNotIn(b"$21=0\n", port.commands)
        self.assertNotIn(b"$X\n", port.commands)
        self.assertFalse(cnc.homed)

    def test_reset_discarded_during_grbl_alarm_delay_is_reissued_after_prompt(self):
        port = FakeGrbl(reset_race=True)
        cnc = XYController(port)
        cnc.home()
        self.assertTrue(cnc.homed)
        self.assertEqual(port.commands.count(b"\x18"), 4)
        self.assertEqual(port.position[:2], [0, 0])
        self.assertEqual(port.hard_limits, 1)

    def test_explicit_release_then_reference(self):
        port = FakeGrbl(reset_race=True)
        port.pins = 1
        port.state = "Alarm"
        cnc = XYController(port)
        cnc.preflight()
        cnc.release_axis("X")
        self.assertEqual(port.pins, 0)
        self.assertEqual(port.hard_limits, 1)
        self.assertFalse(cnc.homed)
        self.assertEqual(port.position[:2], [1, 0])
        cnc.home()
        self.assertTrue(cnc.homed)

    def test_release_rejects_other_switch_or_running_state(self):
        for state, pins in (("Idle", 0), ("Alarm", 2), ("Alarm", 3), ("Run", 1)):
            port = FakeGrbl()
            port.state, port.pins = state, pins
            with self.assertRaisesRegex(ControllerError, "Release requires only X"):
                XYController(port).release_axis("X")
            self.assertEqual(port.commands, [b"?"])

    def test_busy_port_returns_clear_error_without_opening_hardware(self):
        output = io.StringIO()
        with patch("sys.argv", ["grbl_manual.py", "/dev/fake"]), \
             patch("grbl_manual.serial.Serial", side_effect=serial.SerialException(16, "Resource busy")), \
             contextlib.redirect_stdout(output):
            self.assertEqual(main(), 1)
        self.assertIn("Disconnect it in gSender", output.getvalue())

    def test_missing_switch_does_not_declare_reference(self):
        port = FakeGrbl(missing_switch=True)
        cnc = XYController(port)
        with self.assertRaisesRegex(ControllerError, "without a hard-limit"):
            cnc.home()
        self.assertFalse(cnc.homed)
        self.assertNotIn(b"$21=0\n", port.commands)

    def test_failed_release_restores_hard_limits_on_abort(self):
        port = FakeGrbl(stuck_switch=True)
        cnc = XYController(port)
        with self.assertRaises(ControllerError):
            cnc.home()
        self.assertTrue(cnc.limits_may_be_disabled)
        cnc.abort()
        self.assertEqual(port.hard_limits, 1)
        self.assertFalse(cnc.limits_may_be_disabled)
        self.assertFalse(cnc.homed)

    def test_interrupt_during_release_restores_hard_limits(self):
        port = FakeGrbl()
        cnc = XYController(port)
        with patch.object(cnc, "motion", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                cnc.back_off("X")
        cnc.abort()
        self.assertEqual(port.hard_limits, 1)
        self.assertFalse(cnc.homed)

    def test_reject_unreferenced_and_out_of_range_commands_without_writes(self):
        port = FakeGrbl()
        cnc = XYController(port)
        with self.assertRaises(ValueError):
            cnc.move({"X": 100})
        cnc.homed = True
        for axes, feed in [({"X": -200}, 300), ({"Y": 200.1}, 300), ({"Z": 0}, 300),
                           ({"X": float("nan")}, 300), ({"X": 0}, 0), ({"X": 0}, 24001)]:
            with self.assertRaises(ValueError):
                cnc.move(axes, feed)
        self.assertEqual(port.commands, [])

    def test_feed_24000_accepted_and_lower_controller_limit_respected(self):
        port = FakeGrbl()
        cnc = XYController(port)
        cnc.home()
        cnc.move({"X": 100}, 24000)
        self.assertIn(b"G21 G90 G94 G54 G1 X100.000 F24000.000\n", port.commands)
        port = FakeGrbl()
        port.settings[111] = 12000
        cnc = XYController(port)
        cnc.home()
        before = len(port.commands)
        with self.assertRaises(ValueError):
            cnc.move({"X": 100}, 24000)
        self.assertEqual(len(port.commands), before)

    def test_incorrect_configuration_prevents_motion(self):
        port = FakeGrbl()
        port.settings[21] = 0
        cnc = XYController(port)
        with self.assertRaisesRegex(ControllerError, "requires \\$21=1"):
            cnc.home()
        cnc.abort()
        self.assertEqual(port.commands, [b"$$\n"])

    def test_partial_serial_lines_and_completion_ack(self):
        port = FakeGrbl()
        port.output = [b"AL", b"ARM: Hard limit\r\n"]
        cnc = XYController(port)
        self.assertEqual(cnc.line(), "")
        with self.assertRaises(Alarm):
            cnc.line()
        port = FakeGrbl()
        cnc = XYController(port)
        cnc.homed = True
        cnc.move({"X": 100}, 300)
        self.assertIsNone(port.pending)
        self.assertEqual(port.state, "Idle")
        self.assertIn(b"G4 P0.01\n", port.commands)

    def test_status_and_input_parsers(self):
        self.assertEqual(parse_status("<Idle,MPos:0,0,0,WPos:0,0,0,Lim:010>")[1], 2)
        self.assertEqual(parse_move("G1 X100 Y80 F500"), {"X": 100, "Y": 80, "F": 500})
        self.assertEqual(parse_move("x 100 f 500"), {"X": 100, "F": 500})
        for text in ("$X", "G91 X10", "x nan", "x -20 z 0", "x -20 x -30", "x -20\n$21=0"):
            with self.assertRaises(ValueError):
                parse_move(text)
        with self.assertRaises(ControllerError):
            parse_status("<Idle,MPos:0,0,0,WPos:0,0,0>")


if __name__ == "__main__":
    unittest.main()
