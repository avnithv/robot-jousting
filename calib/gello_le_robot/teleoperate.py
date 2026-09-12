import subprocess
from pathlib import Path

def get_config():
    """Extracts the arm ports from arm_config.md"""
    config_path = Path("arm_config.md")
    config = {}
    if not config_path.exists():
        return None
    
    with open(config_path, "r") as f:
        for line in f:
            if "LEADER_BUS:" in line:
                config["leader_port"] = line.split("LEADER_BUS:")[1].strip()
            if "FOLLOWER_BUS:" in line:
                config["follower_port"] = line.split("FOLLOWER_BUS:")[1].strip()
    return config

def main():
    config = get_config()
    if not config or "leader_port" not in config or "follower_port" not in config:
        print("Error: Could not find LEADER_BUS or FOLLOWER_BUS in arm_config.md")
        return

    command = [
        "lerobot-teleoperate",
        "--robot.type=so101_follower",
        f"--robot.port={config['follower_port']}",
        "--robot.id=pi_bot",
        "--robot.calibration_dir=calibration/robots/so_follower",
        "--teleop.type=so101_leader",
        f"--teleop.port={config['leader_port']}",
        "--teleop.id=pi_leader",
        "--teleop.calibration_dir=calibration/teleoperators/so_leader"
    ]

    print("Running teleoperation command:")
    print(" ".join(command))
    
    try:
        subprocess.run(command, check=True)
    except KeyboardInterrupt:
        print("\nStopping teleoperation...")
    except subprocess.CalledProcessError as e:
        print(f"\nError running teleoperation: {e}")

if __name__ == "__main__":
    main()
