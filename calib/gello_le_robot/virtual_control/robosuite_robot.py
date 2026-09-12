"""Robosuite UR5e simulation wrapped as a GELLO-compatible Robot.

Uses the BASIC composite controller with JOINT_POSITION (absolute mode) on the arm,
so command_joint_state() accepts radian joint angles directly.

DOF layout (7 total):
    [0:6]  arm joint angles in radians (absolute)
    [6]    gripper in [-1=open, +1=closed]
"""

import sys
from pathlib import Path
from typing import Dict

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent / "gello_software"))

_JOINT_POSITION_ABSOLUTE = {
    "type": "JOINT_POSITION",
    "input_type": "absolute",
    "input_max": np.pi,
    "input_min": -np.pi,
    "output_max": np.pi,
    "output_min": -np.pi,
    "kp": 150,
    "damping_ratio": 1,
    "impedance_mode": "fixed",
    "kp_limits": [0, 300],
    "damping_ratio_limits": [0, 10],
    "qpos_limits": None,
    "interpolation": None,
    "ramp_ratio": 0.2,
    "gripper": {"type": "GRIP"},
}

_CONTROLLER_CONFIG = {
    "type": "BASIC",
    "body_parts": {
        "right": _JOINT_POSITION_ABSOLUTE,  # "arms" nesting only applies to file-based configs
    },
}


class RobosuiteURRobot:
    """UR5e robosuite simulation implementing the GELLO Robot protocol.

    Accepts 7-DOF commands: 6 arm joint angles (radians) + 1 gripper in [-1, +1].
    """

    NUM_ARM_JOINTS = 6
    NUM_DOFS       = 7  # arm + gripper

    def __init__(
        self,
        env_name: str = "Lift",
        render: bool = True,
        camera: str = "frontview",
    ):
        import robosuite as suite

        self._env = suite.make(
            env_name=env_name,
            robots="UR5e",
            gripper_types="PandaGripper",
            controller_configs=_CONTROLLER_CONFIG,
            has_renderer=render,
            render_camera=camera,
            has_offscreen_renderer=False,
            use_camera_obs=False,
            ignore_done=True,
        )
        self._render = render
        self._obs = self._env.reset()
        if render:
            self._env.render()

        robot = self._env.robots[0]
        self._joint_indexes = robot._ref_joint_pos_indexes[: self.NUM_ARM_JOINTS]
        assert self._env.action_dim == self.NUM_DOFS, (
            f"Expected action_dim={self.NUM_DOFS}, got {self._env.action_dim}"
        )

        print(
            f"Robosuite UR5e ready — env={env_name}  "
            f"arm+gripper DOF={self.NUM_DOFS}  "
            f"initial arm (deg): {np.degrees(self.get_joint_state()[:6]).round(1).tolist()}"
        )

    def num_dofs(self) -> int:
        return self.NUM_DOFS

    def get_joint_state(self) -> np.ndarray:
        """Return shape-(7,): arm joints (rad) + gripper position in [-1, +1]."""
        robot = self._env.robots[0]
        arm = np.array(robot.sim.data.qpos[self._joint_indexes])
        # PandaGripper: qpos[0] is one finger; ~0.021=open, ~0=closed (inverted).
        gripper_obs = self._obs.get("robot0_gripper_qpos", None)
        if gripper_obs is not None and len(gripper_obs) > 0:
            _PANDA_FINGER_MAX = 0.020833
            gripper = (1.0 - float(np.clip(gripper_obs[0] / _PANDA_FINGER_MAX, 0.0, 1.0))) * 2.0 - 1.0
        else:
            gripper = -1.0
        return np.append(arm, gripper)

    def command_joint_state(self, joint_state: np.ndarray) -> None:
        """Send 7-DOF command: joint_state[:6] = arm (rad), joint_state[6] = gripper [-1,+1]."""
        action = np.zeros(self.NUM_DOFS)
        action[: self.NUM_ARM_JOINTS] = joint_state[: self.NUM_ARM_JOINTS]
        action[self.NUM_ARM_JOINTS]   = float(np.clip(joint_state[self.NUM_ARM_JOINTS], -1.0, 1.0))

        self._obs, _, _, _ = self._env.step(action)
        if self._render:
            self._env.render()

    def get_observations(self) -> Dict[str, np.ndarray]:
        joints = self.get_joint_state()
        return {
            "joint_positions":  joints,
            "joint_velocities": np.zeros(self.NUM_DOFS),
            "ee_pos_quat":      np.zeros(7),
            "gripper_position": joints[self.NUM_ARM_JOINTS : self.NUM_ARM_JOINTS + 1],
        }

    def close(self) -> None:
        self._env.close()
