#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <file|-> [slug]" >&2
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

FILE="$1"
if [[ $# -ge 2 ]]; then
  SLUG="$2"
else
  if [[ "$FILE" == "-" ]]; then
    echo "Slug required when reading from stdin" >&2
    exit 1
  fi
  BASENAME="$(basename "$FILE")"
  SLUG="${BASENAME%.*}"
fi

WORK_DIR="${PWD:-$(pwd)}"
CONF_FILE="$WORK_DIR/server.conf"

if [[ ! -f "$CONF_FILE" ]]; then
  echo "server.conf not found in $WORK_DIR" >&2
  exit 1
fi

get_conf_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$CONF_FILE" | head -n1 || true)"
  if [[ -n "$line" ]]; then
    echo "${line#*=}"
  fi
}

BASE_URL="$(get_conf_value url)"
if [[ -z "$BASE_URL" ]]; then
  BASE_URL="$(get_conf_value baseUrl)"
fi
PORT="$(get_conf_value port)"
if [[ -z "$BASE_URL" && -n "$PORT" ]]; then
  BASE_URL="http://localhost:${PORT}"
fi

TOKEN="$(get_conf_value importToken)"

if [[ -z "$BASE_URL" ]]; then
  echo "No url/baseUrl/port found in $CONF_FILE" >&2
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "importToken not found in $CONF_FILE" >&2
  exit 1
fi

if [[ "$FILE" == "-" ]]; then
  BODY=(--data-binary @-)
else
  if [[ ! -f "$FILE" ]]; then
    echo "File not found: $FILE" >&2
    exit 1
  fi
  BODY=(--data-binary @"$FILE")
fi

curl -X POST "${BASE_URL%/}/stories/${SLUG}" \
  -H "Content-Type: application/json" \
  -H "X-Story-Import-Token: ${TOKEN}" \
  "${BODY[@]}"
