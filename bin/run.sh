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
LOG_FILE="$LOG_DIR/dreamweaver.log"

mkdir -p "$LOG_DIR"

# Keep the caller's working directory so server.conf is read from there.
exec node "$ROOT_DIR/storyserver/server.js" "$@" >>"$LOG_FILE" 2>&1
