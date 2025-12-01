#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${PWD:-$(pwd)}"
PID_FILE="$WORK_DIR/logs/dreamweaver.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found at $PID_FILE."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if ps -p "$PID" > /dev/null 2>&1; then
  kill "$PID" && echo "Stopped storyserver (PID $PID)."
else
  echo "No running process with PID $PID."
fi

rm -f "$PID_FILE"
