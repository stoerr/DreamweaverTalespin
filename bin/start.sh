#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT_DIR/logs/dreamweaver.pid"
LOG_FILE="$ROOT_DIR/logs/dreamweaver.log"

mkdir -p "$(dirname "$PID_FILE")"

if [ -f "$PID_FILE" ] && ps -p "$(cat "$PID_FILE")" > /dev/null 2>&1; then
  echo "Server already running with PID $(cat "$PID_FILE")."
  exit 0
fi

nohup "$SCRIPT_DIR/run.sh" "$@" >/dev/null 2>&1 &
echo $! > "$PID_FILE"
echo "Started storyserver (PID $(cat "$PID_FILE")). Logging to $LOG_FILE"
