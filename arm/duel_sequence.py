"""Play a scripted duel (sim/showcase_duel.json): carriages apart -> charge in -> both salute -> apart, then one
charge-in pass per listed beat, each compiled as a calibrated pair (arm/charge_pair.py does one such pass).
Usage: python3 arm/duel_sequence.py [sim/showcase_duel.json] [scale=0.5] [--from N] [--no-opener] [--dry]
  --from N     start at pass N (1-based), e.g. to resume after an abort
  --dry        print the passes and check every contact pair has a calibration; move nothing"""
import json, os, subprocess, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); SIM = os.path.join(HERE, "..", "sim"); PY = os.path.join(HERE, "..", ".venv", "bin", "python")
args = [a for a in sys.argv[1:] if not a.startswith("--")]; flags = sys.argv[1:]
path = next((a for a in args if a.endswith(".json")), os.path.join(SIM, "showcase_duel.json")); scale = float(next((a for a in args if not a.endswith(".json")), 0.5))
start = int(flags[flags.index("--from") + 1]) if "--from" in flags else 1
D = json.load(open(path)); stops = json.load(open(os.path.join(SIM, "contact_stops.json")))
def daemon(p, body, timeout=300):
    req = urllib.request.Request("http://127.0.0.1:8766" + p, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=timeout))
def turn(mA, mB, overlap, apart_after=True):
    r = daemon("/turn", {"moveA": mA, "moveB": mB, "scale": scale, "overlap": overlap, "salute": False, "apart_after": apart_after})
    if not r.get("ok"): sys.exit(f"turn failed: {r}")
    return r
print(f"{len(D['passes'])} passes at x{scale}; opener: {D['opener']['a']} / {D['opener']['b']}")
for i, p in enumerate(D["passes"], 1):
    cal = p.get("contact"); mark = "calibrated" if cal in stops else ("NO CALIBRATION" if cal else "miss by design")
    print(f"  {i:2d}. A {p['a']:14s} B {p['b']:14s} {mark:16s} {p['note']}")
if "--dry" in flags: sys.exit(0)
missing = [p["contact"] for p in D["passes"] if p.get("contact") and p["contact"] not in stops]
if missing: sys.exit(f"missing calibrations: {missing}")
if start == 1 and "--no-opener" not in flags:
    print("== opener: charge in, salute, apart"); print(turn(D["opener"]["a"], D["opener"]["b"], overlap=False))
for i, p in enumerate(D["passes"], 1):
    if i < start: continue
    print(f"== pass {i}: A {p['a']} vs B {p['b']}  ({p['note']})")
    out = subprocess.run([PY, "chain.py", "pair", p["a"], "--", p["b"], "--no-render"], cwd=SIM, capture_output=True, text=True)
    if out.returncode: sys.exit("compile failed: " + out.stderr[-600:])
    print("   " + "\n   ".join(l for l in out.stdout.splitlines() if "closest" in l or "stops applied" in l))
    print("  ", turn("CHAIN_A", "CHAIN_B", overlap=True))
    time.sleep(0.5)
print("duel over: arms at rest, carriages apart")
