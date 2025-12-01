#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

WORK_DIR="${PWD:-$(pwd)}"
LOG_DIR="$WORK_DIR/logs"
PID_FILE="$LOG_DIR/dreamweaver.pid"
LOG_FILE="$LOG_DIR/dreamweaver.log"

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ] && ps -p "$(cat "$PID_FILE")" > /dev/null 2>&1; then
  echo "Server already running with PID $(cat "$PID_FILE")."
  exit 0
fi

nohup "$SCRIPT_DIR/run.sh" "$@" >/dev/null 2>&1 &
echo $! > "$PID_FILE"
echo "Started storyserver (PID $(cat "$PID_FILE")). Logging to $LOG_FILE"
