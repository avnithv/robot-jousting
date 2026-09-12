"""Copy the just-compiled CHAIN_A / CHAIN_B to NAME (arm A) and NAME@B (arm B) in arm/motions_tuned.json, so a show can
compile every pair up front and then play them back to back with no compile in between.  Usage: python stash_pair.py NAME"""
import json, os, sys, fcntl
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "arm", "motions_tuned.json")
name = sys.argv[1]; lock = open(OUT + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX); T = json.load(open(OUT))
T[name] = dict(T["CHAIN_A"]); T[name + "@B"] = dict(T["CHAIN_B"])
json.dump(T, open(OUT + ".tmp", "w")); os.replace(OUT + ".tmp", OUT); fcntl.flock(lock, fcntl.LOCK_UN); print(f"stashed {name} / {name}@B")
