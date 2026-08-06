# shellcheck shell=bash
# Factory-owned browser-capture verbs for validation flows. MACHINERY: lives
# under adws/adw_modules/ (protected_files), so no agent can edit it.
#
# Source it from a flow or probe:
#   source "$FLOW_LIB/browser.sh"
# $FLOW_LIB is exported beside $BASE_URL and $EVIDENCE_DIR by services.py.
#
# The rule these verbs exist to enforce: A DEGRADED PATH STILL ASSERTS. A
# hand-rolled `if browser; then ...; else echo "no browser"; fi` returns 0 with
# the journey's only assertion skipped — two green runs once shipped a search
# funnel whose single check never ran. Here, a missing browser costs the
# SCREENSHOT, never the assertion.

# shellcheck source=./http.sh
if ! declare -f fetch_expect >/dev/null 2>&1; then
  source "${FLOW_LIB:-$(dirname "${BASH_SOURCE[0]}")}/http.sh"
fi

# Step: have_browser — true when agent-browser can actually run. Cached per flow.
#
# The probe costs an npx resolution, so the answer is remembered: a flow that
# captures six pages should not pay for it six times.
have_browser() {
  if [ -z "${_FLOW_LIB_HAVE_BROWSER:-}" ]; then
    if npx --no-install agent-browser --version >/dev/null 2>&1; then
      _FLOW_LIB_HAVE_BROWSER=yes
    else
      _FLOW_LIB_HAVE_BROWSER=no
    fi
  fi
  [ "$_FLOW_LIB_HAVE_BROWSER" = yes ]
}

# Step: require_browser — fail the flow when agent-browser is absent.
#
# For journeys whose evidence is meaningless without a real browser (anything
# client-rendered, anything visual). Prefer capture_wait when a curl-level
# assertion would still be honest.
require_browser() {
  if have_browser; then
    return 0
  fi
  echo "require_browser: FAILED — agent-browser is not installed, and this flow's evidence is meaningless without it." >&2
  echo "  Install it (npx agent-browser --version to check), or rewrite this flow around capture_wait, whose degrade path still asserts." >&2
  return 1
}

# Step: capture — open a URL, assert it serves 2xx, and save snapshot + screenshot.
#
#   capture <name> <url>
#
# The status assert is the point: a browser happily renders a 404 or a 500
# error page, and a screenshot of one looks like evidence. Checked over HTTP
# before the browser is driven, so a broken page fails here rather than
# producing a plausible-looking capture of the wrong thing.
capture() {
  if [ "$#" -lt 2 ]; then
    echo "capture: usage: capture <name> <url>" >&2
    return 2
  fi
  local name=$1 url=$2
  require_browser || return 1

  local code
  code=$(LC_ALL=C curl -sS -o "$EVIDENCE_DIR/$name.html" -w '%{http_code}' "$url") || {
    echo "capture: FAILED — curl could not reach $url" >&2
    return 1
  }
  echo "GET $url -> $code" > "$EVIDENCE_DIR/$name.status"
  case "$code" in
    2??) ;;
    *)
      echo "capture: FAILED — $url served $code, not 2xx; a screenshot of an error page is not evidence" >&2
      return 1
      ;;
  esac

  npx agent-browser open "$url"
  npx agent-browser snapshot -i > "$EVIDENCE_DIR/$name.snapshot.txt"
  npx agent-browser screenshot "$EVIDENCE_DIR/$name.png"   # explicit path — the default lands in agent-browser's tmp dir
  npx agent-browser close
  echo "capture: ok — $name ($code) -> $name.snapshot.txt, $name.png"
}

# Step: capture_wait — open a URL, wait for <pattern> to appear, assert it either way.
#
#   capture_wait <name> <url> <pattern> [timeout_seconds]
#
# The browser path polls the snapshot until <pattern> appears — the correct
# shape for a client-rendered page, where a snapshot raced against a fetch
# evidences nothing. Without a browser it DEGRADES rather than skipping: the
# page is fetched over HTTP and <pattern> must still be present in the markup,
# failing the flow if it is not. What is lost is the screenshot and the
# post-hydration DOM, and degraded.note in the evidence dir says exactly that,
# so a validator can see the evidence was thinner and rule accordingly.
capture_wait() {
  if [ "$#" -lt 3 ]; then
    echo "capture_wait: usage: capture_wait <name> <url> <pattern> [timeout_seconds]" >&2
    return 2
  fi
  local name=$1 url=$2 pattern=$3 timeout=${4:-20}

  if ! have_browser; then
    echo "capture_wait: agent-browser absent — degrading to an HTTP assertion" >&2
    {
      echo "DEGRADED EVIDENCE for '$name'"
      echo "agent-browser was not installed, so this journey has:"
      echo "  - NO screenshot and no post-hydration DOM"
      echo "  - the required pattern asserted against the SERVER-RENDERED markup only"
      echo "required pattern: $pattern"
      echo "url: $url"
      echo "Content this app renders client-side would not appear here; treat a pass as weaker evidence than a browser capture."
    } > "$EVIDENCE_DIR/degraded.note"
    # The assertion still runs — that is the whole point of this branch.
    fetch_expect "$url" "$name.html" 200 0 "$pattern" || {
      echo "capture_wait: FAILED — '$pattern' is absent from $url (degraded HTTP path)" >&2
      return 1
    }
    echo "capture_wait: ok (DEGRADED, no screenshot) — '$pattern' present at $url"
    return 0
  fi

  npx agent-browser open "$url"
  local deadline=$(( SECONDS + timeout ))
  local found=no
  while [ "$SECONDS" -lt "$deadline" ]; do
    npx agent-browser snapshot -i > "$EVIDENCE_DIR/$name.snapshot.txt" 2>/dev/null || true
    if grep -qF -- "$pattern" "$EVIDENCE_DIR/$name.snapshot.txt" 2>/dev/null; then
      found=yes
      break
    fi
    sleep 1
  done
  npx agent-browser screenshot "$EVIDENCE_DIR/$name.png"   # captured either way: a failure's screenshot is the finding
  npx agent-browser close

  if [ "$found" != yes ]; then
    echo "capture_wait: FAILED — '$pattern' never appeared at $url within ${timeout}s" >&2
    echo "  last snapshot: $EVIDENCE_DIR/$name.snapshot.txt, screenshot: $EVIDENCE_DIR/$name.png" >&2
    return 1
  fi
  echo "capture_wait: ok — '$pattern' present at $url -> $name.snapshot.txt, $name.png"
}
