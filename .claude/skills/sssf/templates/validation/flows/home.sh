#!/usr/bin/env bash
# Flow: home — mechanical evidence that the app serves its home page.
#
# Run by adw_modules/services.py with:
#   $BASE_URL       the running service's origin (from validation.yaml health_url)
#   $EVIDENCE_DIR   where every artifact must land (also the cwd). Always pass
#                   agent-browser screenshot an explicit path — its default
#                   save location is its own tmp dir, NOT the cwd.
#
# agent-browser is the primary capture instrument: `snapshot -i` and `get text`
# produce TEXT evidence any validator can judge directly, and screenshots feed
# the mechanical toolkit (OCR sidecars, blank detection, baseline diffs — see
# services.py). curl is the degrade path, not the default.
#
# A flow is a KNOWN sequence: open, snapshot, screenshot. Exit non-zero on any
# mechanically-checkable failure (bad status, missing element). What the
# evidence MEANS is the validator agent's job, not this script's.
#
# This starter proves the loop end to end. Replace it with your real flows —
# one journey per flow (login, create-thing, checkout), declared in
# validation.yaml, opening lines carrying this `# Flow:` header.
set -euo pipefail

# Always-on baseline: the page answers 200, body saved (services.py adds a
# stripped-text sidecar next to it).
status=$(curl -sS -o "$EVIDENCE_DIR/home.html" -w '%{http_code}' "$BASE_URL/")
echo "GET $BASE_URL/ -> $status" > "$EVIDENCE_DIR/home.status"
[ "$status" = "200" ]

# Primary capture: element map + visual evidence via agent-browser.
if command -v agent-browser >/dev/null 2>&1 || npx --no-install agent-browser --version >/dev/null 2>&1; then
  npx agent-browser open "$BASE_URL/"
  npx agent-browser snapshot -i > "$EVIDENCE_DIR/home.snapshot.txt"
  npx agent-browser screenshot "$EVIDENCE_DIR/home.png"   # explicit path — the default saves to agent-browser's tmp dir
  npx agent-browser close
else
  # Degrading to curl-only evidence is a VISIBLE choice, never a silent one.
  # If this project's validation needs visual evidence, replace this branch
  # with `exit 1` so a missing browser fails the flow instead of thinning it.
  echo "agent-browser not installed; curl evidence only" > "$EVIDENCE_DIR/no-browser.note"
fi
