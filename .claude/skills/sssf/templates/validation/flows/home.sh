#!/usr/bin/env bash
# Flow: home — mechanical evidence that the app serves its home page.
#
# Run by adw_modules/services.py with:
#   $BASE_URL       the running service's origin (from validation.yaml health_url)
#   $EVIDENCE_DIR   where every artifact must land (also the cwd — agent-browser
#                   screenshots save to the cwd, so they land here by default)
#
# A flow is a KNOWN sequence: fetch, click, screenshot. Exit non-zero on any
# mechanically-checkable failure (bad status, missing element). What the
# evidence MEANS is the validator agent's job, not this script's.
#
# This starter proves the loop end to end. Replace it with your real flows —
# one script per user journey worth evidence (login, create-thing, checkout).
set -euo pipefail

# 1. The home page answers 200, body saved as evidence.
status=$(curl -sS -o "$EVIDENCE_DIR/home.html" -w '%{http_code}' "$BASE_URL/")
echo "GET $BASE_URL/ -> $status" > "$EVIDENCE_DIR/home.status"
[ "$status" = "200" ]

# 2. Visual evidence via agent-browser, when it is installed. Guarded so the
#    curl evidence above stands alone on machines without it.
if command -v agent-browser >/dev/null 2>&1 || npx --no-install agent-browser --version >/dev/null 2>&1; then
  npx agent-browser open "$BASE_URL/"
  npx agent-browser snapshot -i > "$EVIDENCE_DIR/home.snapshot.txt"
  npx agent-browser screenshot            # saves into cwd == $EVIDENCE_DIR
  npx agent-browser close
else
  echo "agent-browser not installed; curl evidence only" > "$EVIDENCE_DIR/no-browser.note"
fi
