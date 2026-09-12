#!/bin/zsh
# Joust move studio UI:  ./studio.sh   then open http://localhost:8765
cd "$(dirname "$0")" && exec .venv/bin/python ui/server.py 8765
