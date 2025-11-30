#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/dreamweaver.log"

mkdir -p "$LOG_DIR"

# Keep the caller's working directory so server.conf is read from there.
node "$ROOT_DIR/storyserver/server.js" "$@" >>"$LOG_FILE" 2>&1
