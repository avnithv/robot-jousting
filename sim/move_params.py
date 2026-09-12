"""Move parameters live in params/<MOVE>.json (one file per move, see params/README.md). This module just loads them."""
import json, os, glob
_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "params")
def load():
    P = {}
    for f in sorted(glob.glob(os.path.join(_DIR, "*.json"))):
        name = os.path.splitext(os.path.basename(f))[0]; d = json.load(open(f)); d.pop("_doc", None); d.pop("_help", None); P[name] = d
    return P
PARAMS = load()
