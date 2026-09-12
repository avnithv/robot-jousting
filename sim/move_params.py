"""Move parameters: one folder per ARM, one JSON file per move. params/ = arm A (SO-100), params_B/ = arm B (SO-101).
Nothing is shared between arms."""
import json, os, glob
_HERE = os.path.dirname(os.path.abspath(__file__))
def load(arm="A"):
    d = os.path.join(_HERE, "params" if arm == "A" else f"params_{arm}"); P = {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        name = os.path.splitext(os.path.basename(f))[0]; p = json.load(open(f)); p.pop("_doc", None); p.pop("_help", None); P[name] = p
    return P
PARAMS = load("A"); PARAMS_B = load("B")
