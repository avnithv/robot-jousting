# virtual_control

Teleoperate a simulated robosuite UR5e arm using a physical SO-101 LeRobot leader arm. Joint positions are read from the SO-101, remapped and offset to match the UR5e's joint convention, and streamed to robosuite at 100 Hz.

## Files

| File | Purpose |
|---|---|
| `run_sim.py` | Entry point — connects leader arm to simulation |
| `leader_agent.py` | Reads SO-101, applies joint mapping, outputs 7-DOF commands |
| `robosuite_robot.py` | Wraps robosuite UR5e + PandaGripper as a robot interface |

## Requirements

```
robosuite
lerobot
numpy
```

The SO-101 port is read automatically from `../arm_config.md` (`LEADER_BUS:` line).

## Running

```bash
cd virtual_control

# With render window — requires mjpython on macOS
mjpython run_sim.py

# Headless (any Python)
python run_sim.py --no-render

# Test the simulation without a leader arm
python run_sim.py --dry-run --no-render

# Different robosuite task
mjpython run_sim.py --env Stack

# Override leader port explicitly
mjpython run_sim.py --leader-port /dev/tty.usbmodem5AE60824811
```

> **macOS note:** MuJoCo's viewer requires `mjpython` (ships with the `mujoco` pip package). Use `--no-render` with regular `python` for headless runs.

## Joint mapping

The SO-101 has 6 joints; the UR5e also has 6. They are mapped 1-to-1 by index with per-joint offsets and optional sign flips. All constants live at the top of `leader_agent.py`.

### Current mapping

| UR5 joint | SO-101 source | Offset | Sign | Mode |
|---|---|---|---|---|
| shoulder_pan | shoulder_pan | 0° | +1 | teleoperated |
| shoulder_lift | shoulder_lift | −50° | +1 | teleoperated |
| elbow | elbow_flex | +30° | +1 | teleoperated |
| wrist_1 | wrist_flex | −180° | +1 | teleoperated |
| wrist_2 | *(fixed)* | −90° | — | fixed at −90° |
| wrist_3 | wrist_roll | +90° | +1 | teleoperated |

**Offset** shifts the zero point: `output = (leader_reading + offset) * sign`.  
When a joint is **fixed**, the offset *is* the commanded value and the SO-101 input is ignored.

### Tuning offsets

The offsets are chosen so that the SO-101 in its upright neutral pose (all joints near 0°) places the UR5e in a reasonable ready configuration. Adjust `DEFAULT_JOINT_OFFSETS_DEG` in `leader_agent.py` if the sim arm starts in the wrong pose.

### Fixing a joint

Set the corresponding entry in `DEFAULT_IS_FIXED` to `True` and set its value in `DEFAULT_JOINT_OFFSETS_DEG`:

```python
DEFAULT_IS_FIXED          = (False, False, False, False, True, False)
DEFAULT_JOINT_OFFSETS_DEG = (0.0, -50.0, 30.0, -180.0, -90.0, 90.0)
#                                                         ^^^^^ held here
```

### Reordering joints

`DEFAULT_JOINT_INDICES[i]` controls which SO-101 joint (0–5) drives UR5 joint `i`. The current config maps SO-101 `wrist_roll` (index 4) to both `wrist_2` and `wrist_3`:

```python
DEFAULT_JOINT_INDICES = (0, 1, 2, 3, 4, 4)
#                                    ^  ^ both read from wrist_roll
```

## Gripper

The SO-101 gripper is binary: squeeze past the threshold → close, release → open.

```python
GRIPPER_THRESHOLD_DEG = 27.0  # in leader_agent.py
```

- SO-101 gripper reading **below** threshold → gripper **closes** (`+1`)
- SO-101 gripper reading **at or above** threshold → gripper **opens** (`−1`)

The simulation uses a **PandaGripper** attached to the UR5e arm. To change the threshold, edit `GRIPPER_THRESHOLD_DEG` in `leader_agent.py`.

## Simulation details

- **Robot:** UR5e arm + PandaGripper
- **Controller:** `JOINT_POSITION` in absolute mode — joint angle commands in radians are passed directly, no delta computation needed
- **Default task:** `Lift` (cube pick-and-place). Any robosuite manipulation task works: `--env Stack`, `--env PickPlace`, etc.
- **Control rate:** 100 Hz (adjustable with `--hz`)

## Architecture

```
SO-101 leader arm  (hardware)
        │
        │  get_action() → degrees per joint
        ▼
LeRobotLeaderAgent          (leader_agent.py)
  1. reorder by joint_indices
  2. add joint_offsets_deg
  3. multiply by joint_signs
  4. convert to radians
  5. binary gripper threshold
        │
        │  np.ndarray shape (7,)
        │  [0:6] arm joints in radians
        │  [6]   gripper in {-1, +1}
        ▼
RobosuiteURRobot            (robosuite_robot.py)
  - arm joints → JOINT_POSITION absolute controller
  - gripper    → PandaGripper GRIP controller
        │
        ▼
  robosuite UR5e simulation  (MuJoCo)
```
