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

CONF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$CONF_DIR/server.conf"

URL="$(grep -E '^port=' "$CONF_FILE" | sed 's/^url=//')"
TOKEN="$(grep -E '^importToken=' "$CONF_FILE" | sed 's/^importToken=//')"

if [[ -z "$URL" ]]; then
  echo "Url not found in $CONF_FILE" >&2
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "importToken not found in $CONF_FILE" >&2
  exit 1
fi

if [[ "$FILE" == "-" ]]; then
  BODY="--data-binary @-"
else
  if [[ ! -f "$FILE" ]]; then
    echo "File not found: $FILE" >&2
    exit 1
  fi
  BODY="--data-binary @$FILE"
fi

curl -X POST "${URL}/stories/${SLUG}" \
  -H "Content-Type: application/json" \
  -H "X-Story-Import-Token: ${TOKEN}" \
  $BODY
