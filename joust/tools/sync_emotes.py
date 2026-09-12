#!/usr/bin/env python3
"""Copy the two-arm emote scenes (robot-jousting/sim/out/emotes: manifest + clips + filmstrips) into the Playhouse.
    python3 tools/sync_emotes.py                # repo = the parent folder (joust/ lives inside it), or $JOUST_REPO
Writes dashboard/data/emotes.json and dashboard/videos/emotes/*.mp4|*_strip.png (re-runnable, overwrites)."""
import json, os, shutil, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); JOUST = os.path.dirname(HERE)
REPO = os.path.expanduser(os.environ.get("JOUST_REPO", "") or os.path.join(JOUST, "..") if os.path.exists(os.path.join(JOUST, "..", "arm", "motions_tuned.json")) else os.path.join(JOUST, "..", "robot-jousting"))   # joust/ lives inside the repo
SRC = os.path.join(REPO, "sim", "out", "emotes"); DST = os.path.join(JOUST, "dashboard", "videos", "emotes"); DATA = os.path.join(JOUST, "dashboard", "data", "emotes.json")
man = json.load(open(os.path.join(SRC, "manifest.json"))); os.makedirs(DST, exist_ok=True)
n = 0
for s in man["scenes"]:
    for f in (s["video"], s["strip"]):
        p = os.path.join(SRC, f)
        if os.path.exists(p): shutil.copy2(p, os.path.join(DST, f)); n += 1
reel = os.path.join(SRC, "reel_emotes.mp4")
if os.path.exists(reel): shutil.copy2(reel, os.path.join(DST, "reel_emotes.mp4")); man["reel"] = "reel_emotes.mp4"
man["synced"] = time.strftime("%Y-%m-%d %H:%M:%S"); json.dump(man, open(DATA, "w"), indent=1)
print(f"{len(man['scenes'])} scenes, {n} files -> dashboard/videos/emotes, data/emotes.json")
