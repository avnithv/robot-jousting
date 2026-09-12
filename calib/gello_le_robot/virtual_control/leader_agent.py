"""Agent that wraps the LeRobot SO-101 leader arm and maps its joints to UR5 joint space."""

import sys
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "gello_software"))

# SO-101 joints in calibration order
LEADER_JOINT_NAMES = [
    "shoulder_pan",   # 0
    "shoulder_lift",  # 1
    "elbow_flex",     # 2
    "wrist_flex",     # 3
    "wrist_roll",     # 4
    "gripper",        # 5
]

# UR5 arm joints in robosuite order
UR5_JOINT_NAMES = [
    "shoulder_pan",   # 0
    "shoulder_lift",  # 1
    "elbow",          # 2
    "wrist_1",        # 3
    "wrist_2",        # 4
    "wrist_3",        # 5
]

# ── Arm mapping defaults ─────────────────────────────────────────────────────
#
# joint_indices[i]      SO-101 joint (0-5) that feeds UR5 arm joint i
# joint_signs[i]        +1 / -1 applied after reordering
# joint_offsets_deg[i]  degrees added after reorder, before sign & conversion;
#                       for FIXED joints this is the constant commanded value
# is_fixed[i]           True  → hold at joint_offsets_deg[i], ignore SO-101
#                       False → teleoperated from SO-101

DEFAULT_JOINT_INDICES     = (0,     1,     2,      3,      4,      4   )
DEFAULT_JOINT_SIGNS       = (1,     1,     1,      1,      1,      1   )
DEFAULT_JOINT_OFFSETS_DEG = (0.0, -50.0,  30.0, -180.0,  -90.0,   90.0 )
DEFAULT_IS_FIXED          = (False, False, False,  False,  True,  False)

# ── Gripper defaults ─────────────────────────────────────────────────────────
#
# Binary open/close based on a single threshold (degrees).
# Below threshold → +1 (closed).  At or above → -1 (open).
# Midpoint of your open (~50°) and close (~5°) readings.

GRIPPER_THRESHOLD_DEG = 27.0


class LeRobotLeaderAgent:
    """Reads the SO-101 leader arm and emits 7 values: 6 UR5 arm joints (rad) + 1 gripper.

    Arm pipeline per UR5 joint i
    ────────────────────────────
    If is_fixed[i]:
        output[i] = joint_offsets_deg[i] * pi/180
    Else:
        raw       = SO-101 joint at index joint_indices[i]   (degrees)
        output[i] = (raw + joint_offsets_deg[i]) * joint_signs[i] * pi/180

    Gripper pipeline
    ────────────────
    raw       = SO-101 gripper reading (degrees)
    output[6] = +1 (closed) if raw < gripper_threshold_deg, else -1 (open)
    """

    def __init__(
        self,
        port: str,
        leader_id: str = "pi_leader",
        calibration_dir: Optional[str] = None,
        # arm mapping
        joint_indices: Sequence[int] = DEFAULT_JOINT_INDICES,
        joint_signs: Sequence[float] = DEFAULT_JOINT_SIGNS,
        joint_offsets_deg: Sequence[float] = DEFAULT_JOINT_OFFSETS_DEG,
        is_fixed: Sequence[bool] = DEFAULT_IS_FIXED,
        # gripper
        gripper_threshold_deg: float = GRIPPER_THRESHOLD_DEG,
        gripper_enabled: bool = True,
    ):
        """
        Args:
            port: Serial port of the SO-101 leader arm.
            leader_id: LeRobot device ID matching the calibration filename.
            calibration_dir: Calibration directory. Defaults to
                ../calibration/teleoperators/so_leader.
            joint_indices: joint_indices[i] = SO-101 joint index that drives
                UR5 arm joint i.  Ignored for fixed joints.
            joint_signs: Per-UR5-arm-joint sign (+1 or -1).
            joint_offsets_deg: Per-UR5-arm-joint degree offset.
                Controlled joints: shifts the zero point.
                Fixed joints: the constant commanded value.
            is_fixed: Per-UR5-arm-joint bool. True = hold at offset, ignore SO-101.
            gripper_threshold_deg: Gripper reading below this → closed (+1),
                at or above → open (-1). Default is midpoint of your open/close range.
            gripper_enabled: If False, gripper output is always -1 (open).
        """
        from lerobot.teleoperators.so_leader import SOLeader, SOLeaderTeleopConfig

        if calibration_dir is None:
            calibration_dir = (
                Path(__file__).parent.parent / "calibration" / "teleoperators" / "so_leader"
            )
        else:
            calibration_dir = Path(calibration_dir)

        config = SOLeaderTeleopConfig(
            port=port,
            id=leader_id,
            calibration_dir=calibration_dir,
        )
        self._leader = SOLeader(config)
        self._leader.connect()

        self._joint_indices     = np.array(joint_indices, dtype=int)
        self._joint_signs       = np.array(joint_signs, dtype=float)
        self._joint_offsets_deg = np.array(joint_offsets_deg, dtype=float)
        self._is_fixed          = np.array(is_fixed, dtype=bool)

        self._gripper_threshold_deg = gripper_threshold_deg
        self._gripper_enabled       = gripper_enabled

        if not self._leader.is_calibrated:
            print("WARNING: leader arm is not calibrated — positions may be raw ticks.")

        self._print_mapping()
        print(f"Leader arm connected on {port}")

    def _print_mapping(self) -> None:
        print("\nJoint mapping  (SO-101 → UR5):")
        print(f"  {'UR5 joint':<16} {'source':<16} {'offset':>8}°  {'sign':>5}  mode")
        print(f"  {'-'*62}")
        for i in range(6):
            ur5_name = UR5_JOINT_NAMES[i]
            if self._is_fixed[i]:
                source   = "(fixed)"
                sign_str = "  —"
                mode     = f"→ {self._joint_offsets_deg[i]:.1f}°"
            else:
                source   = LEADER_JOINT_NAMES[self._joint_indices[i]]
                sign_str = f"{self._joint_signs[i]:>+.0f}"
                mode     = "teleoperated"
            print(f"  {ur5_name:<16} {source:<16} {self._joint_offsets_deg[i]:>8.1f}   {sign_str}  {mode}")
        if self._gripper_enabled:
            print(
                f"  {'gripper':<16} {'gripper':<16} "
                f"threshold={self._gripper_threshold_deg:.1f}°  binary open/close"
            )
        else:
            print(f"  {'gripper':<16} {'(disabled)':<16}                     → open")
        print()

    def act(self, obs: Dict[str, Any]) -> np.ndarray:
        """Return shape-(7,): 6 UR5 arm joints (rad) + 1 gripper in [-1=open, +1=close]."""
        action = self._leader.get_action()

        # Read all SO-101 joints in degrees
        all_deg = np.array(
            [action.get(f"{name}.pos", 0.0) for name in LEADER_JOINT_NAMES],
            dtype=float,
        )

        # ── Arm joints ──────────────────────────────────────────────────────
        arm_rad = np.zeros(6)
        for i in range(6):
            if self._is_fixed[i]:
                arm_rad[i] = self._joint_offsets_deg[i] * np.pi / 180.0
            else:
                raw = all_deg[self._joint_indices[i]]
                arm_rad[i] = (
                    (raw + self._joint_offsets_deg[i])
                    * self._joint_signs[i]
                    * np.pi / 180.0
                )

        # ── Gripper ─────────────────────────────────────────────────────────
        if self._gripper_enabled:
            g_deg = all_deg[5]  # SO-101 gripper joint
            gripper_action = 1.0 if g_deg < self._gripper_threshold_deg else -1.0
        else:
            gripper_action = -1.0  # open

        return np.append(arm_rad, gripper_action)  # shape (7,)

    @property
    def is_connected(self) -> bool:
        return self._leader.is_connected

    def disconnect(self) -> None:
        if self._leader.is_connected:
            self._leader.disconnect()
            print("Leader arm disconnected.")
