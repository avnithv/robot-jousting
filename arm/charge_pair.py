"""Charge-in duel: carriages apart -> charge in at the gantry's charge feed -> both arms play a compiled pair (calibrated stops applied).
Usage: python3 arm/charge_pair.py ATTACK_HIGH BLOCK_HIGH [scale=0.5] [--wait] [--salute] [--apart-after]
Arms start the moment the charge-in begins; --wait makes them wait until the carriages arrive (then --salute applies).
First move list is arm A's, second is arm B's (comma separated for chains)."""
import json, os, subprocess, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); SIM = os.path.join(HERE, "..", "sim"); PY = os.path.join(HERE, "..", ".venv", "bin", "python")
args = [a for a in sys.argv[1:] if not a.startswith("--")]; flags = [a for a in sys.argv[1:] if a.startswith("--")]
ours, theirs = args[0].split(","), args[1].split(","); scale = float(args[2]) if len(args) > 2 else 0.5
out = subprocess.run([PY, "chain.py", "pair", *ours, "--", *theirs], cwd=SIM, capture_output=True, text=True)
print(out.stdout.strip()); 
if out.returncode: sys.exit(out.stderr)
body = {"moveA": "CHAIN_A", "moveB": "CHAIN_B", "scale": scale, "salute": "--salute" in flags, "apart_after": "--apart-after" in flags, "overlap": "--wait" not in flags}
req = urllib.request.Request("http://127.0.0.1:8766/turn", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
print(json.load(urllib.request.urlopen(req, timeout=300)))
