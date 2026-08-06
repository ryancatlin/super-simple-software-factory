#!/usr/bin/env bash
# Flow: home — mechanical evidence that the app serves its home page.
#
# Run by adw_modules/services.py with:
#   $BASE_URL       the running service's origin (from validation.yaml health_url)
#   $EVIDENCE_DIR   where every artifact must land (also the cwd)
#   $FLOW_LIB       the factory's verb library — source it, do not re-derive it
#
# The verbs are MACHINERY (adws/adw_modules/flow_lib/, protected and refreshed
# by `just update`). They already get right what hand-rolled curl gets wrong:
# exact status, non-empty body, required content, deadlines, locale-proof
# timing, and a degrade path that STILL ASSERTS when agent-browser is missing.
#
#   fetch_expect <url> <outfile> <status> [max_seconds] [required_string ...]
#   capture      <name> <url>                     # asserts 2xx, then snapshot + screenshot
#   capture_wait <name> <url> <pattern> [timeout] # polls a client-rendered page
#   have_browser / require_browser
#
# Exit non-zero on any mechanically-checkable failure — THE EXIT CODE IS THE
# VERDICT. What the evidence MEANS is the validator agent's job, not this
# script's. A flow that saves nothing is failed by services.py regardless of
# its exit code: an exit code is a verdict only when evidence stands behind it.
#
# This starter proves the loop end to end. Replace it with your real flows —
# one journey per flow (login, create-thing, checkout), each declared in
# validation.yaml, opening lines carrying this `# Flow:` header.
set -euo pipefail

source "$FLOW_LIB/http.sh"
source "$FLOW_LIB/browser.sh"

# Always-on baseline: the page answers 200 with a non-empty body, inside 30s.
# Add required strings once you know what this page must always say — a status
# code alone is the weakest assertion there is, and the validator's
# assertion-strength audit will say so.
fetch_expect "$BASE_URL/" home.html 200 30

# Visual + structural evidence. capture asserts the page served 2xx before it
# screenshots: a browser renders an error page perfectly happily, and a
# screenshot of one looks exactly like evidence.
if have_browser; then
  capture home "$BASE_URL/"
else
  # Visibly thinner, never silently thinner. If this project's validation
  # genuinely needs visual evidence, swap this for `require_browser` so a
  # missing browser fails the flow instead of quietly shrinking it.
  echo "agent-browser not installed; curl evidence only" > "$EVIDENCE_DIR/no-browser.note"
fi
