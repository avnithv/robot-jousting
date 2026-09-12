import time
from pathlib import Path
from lerobot.teleoperators.so_leader import SOLeader, SOLeaderTeleopConfig

def get_leader_port():
    """Extracts the leader arm port from arm_config.md"""
    config_path = Path("arm_config.md")
    if not config_path.exists():
        return None
    
    with open(config_path, "r") as f:
        for line in f:
            if "LEADER_BUS:" in line:
                return line.split("LEADER_BUS:")[1].strip()
    return None

def main():
    port = get_leader_port()
    if not port:
        print("Error: LEADER_BUS not found in arm_config.md")
        return

    print(f"Connecting to leader arm on {port}...")
    
    # Configure the leader arm
    # We point to the local calibration directory and use 'pi_leader' as the ID
    # to match calibration/teleoperators/so_leader/pi_leader.json
    try:
        config = SOLeaderTeleopConfig(
            port=port,
            id="pi_leader",
            calibration_dir=Path("calibration/teleoperators/so_leader")
        )
        
        leader = SOLeader(config)
        
        print("Initializing connection...")
        leader.connect()
        
        if not leader.is_calibrated:
            print("Warning: Leader arm is not calibrated. Positions might be raw.")
        
        print("\nConnected! Press Ctrl+C to stop.")
        print("-" * 50)
        
        while True:
            # get_action() returns the current joint positions (usually in degrees)
            action = leader.get_action()
            
            # Format the output for readability
            # The keys are usually 'joint_name.pos'
            pos_str = " | ".join([f"{k.split('.')[0]}: {v:6.1f}°" for k, v in action.items()])
            print(f"\r{pos_str}", end="", flush=True)
            
            time.sleep(0.01)
            
    except KeyboardInterrupt:
        print("\n\nStopping...")
    except Exception as e:
        print(f"\n\nError: {e}")
    finally:
        if 'leader' in locals() and leader.is_connected:
            leader.disconnect()

if __name__ == "__main__":
    main()
