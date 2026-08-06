# shellcheck shell=bash
# Factory-owned HTTP verbs for validation flows. MACHINERY, not project source:
# this lives under adws/adw_modules/ (protected_files), so no agent can edit it
# — verbs are code (hard rule 8), and a flow that hand-rolls its own curl
# assertions is re-deriving, badly, what this file already gets right.
#
# Source it from a flow or probe:
#   source "$FLOW_LIB/http.sh"
# $FLOW_LIB is exported beside $BASE_URL and $EVIDENCE_DIR by services.py.
#
# Every verb here PRINTS what failed and returns non-zero. Flows run under
# `set -euo pipefail`, so a non-zero return ends the flow and the exit code
# becomes the verdict.

# Resolve an evidence file name against $EVIDENCE_DIR (absolute paths pass through).
_flow_lib_evidence_path() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *)  printf '%s/%s' "${EVIDENCE_DIR:-.}" "$1" ;;
  esac
}

# Step: fetch_expect — GET a URL and assert its status, body, content and deadline.
#
#   fetch_expect <url> <outfile> <expected_code> [max_seconds] [required_string ...]
#
# Saves the body to $EVIDENCE_DIR/<outfile> and a one-line summary to
# $EVIDENCE_DIR/<outfile>.status, then asserts, in order:
#   - curl completed at all (DNS, connection, TLS),
#   - the status code is EXACTLY <expected_code>,
#   - the body is non-empty (a 200 serving nothing is not a working page),
#   - every <required_string> appears in the body (literal match, grep -qF),
#   - the request finished within <max_seconds> (0, the default, means no deadline).
#
# LC_ALL=C at the curl site AND the awk site: curl's %{time_total} is written
# with the locale's decimal separator, so a comma locale yields "1,234" and any
# naive numeric comparison silently misreads it. Belt and braces, because this
# bug ships green.
fetch_expect() {
  if [ "$#" -lt 3 ]; then
    echo "fetch_expect: usage: fetch_expect <url> <outfile> <expected_code> [max_seconds] [required_string ...]" >&2
    return 2
  fi
  local url=$1 outfile=$2 expected=$3
  local max_seconds=0
  shift 3
  if [ "$#" -gt 0 ]; then
    max_seconds=$1
    shift
  fi

  local body status_file metrics code elapsed curl_status
  body=$(_flow_lib_evidence_path "$outfile")
  status_file="$body.status"
  mkdir -p "$(dirname "$body")"

  # Restore the CALLER's errexit rather than forcing it on: flows run under
  # `set -e`, but a probe testing a failure case wraps this in `if`, and
  # switching -e on underneath it would kill the flow at the next false.
  local errexit=off
  case $- in *e*) errexit=on ;; esac
  # Deadlines are not optional (the walk-away rule): an unroutable host would
  # otherwise sit in curl's default connect timeout for ~100s per attempt, and
  # a negative probe aimed at a black hole is exactly the normal case.
  local -a limits=(--connect-timeout "${FLOW_LIB_CONNECT_TIMEOUT:-10}")
  if [ "$max_seconds" != "0" ]; then
    limits+=(--max-time "$max_seconds")
  fi
  set +e
  metrics=$(LC_ALL=C curl -sS "${limits[@]}" -o "$body" \
              -w '%{http_code} %{time_total}' "$url" 2>"$body.curl.err")
  curl_status=$?
  if [ "$errexit" = on ]; then set -e; fi

  if [ "$curl_status" -ne 0 ]; then
    echo "GET $url -> curl exited $curl_status (no response)" > "$status_file"
    if [ "$curl_status" -eq 28 ]; then
      echo "fetch_expect: FAILED — GET $url did not complete within the ${max_seconds}s deadline" >&2
    else
      echo "fetch_expect: FAILED — curl could not complete GET $url (exit $curl_status)" >&2
    fi
    sed 's/^/  /' "$body.curl.err" >&2 2>/dev/null || true
    return 1
  fi

  code=${metrics%% *}
  elapsed=${metrics##* }
  elapsed=${elapsed//,/.}          # comma locale slipped through: normalise
  echo "GET $url -> $code in ${elapsed}s" > "$status_file"

  if [ "$code" != "$expected" ]; then
    echo "fetch_expect: FAILED — GET $url returned $code, expected $expected" >&2
    return 1
  fi

  if [ ! -s "$body" ]; then
    echo "fetch_expect: FAILED — GET $url returned $code with an EMPTY body; a status code alone proves nothing about the page" >&2
    return 1
  fi

  local needle
  for needle in "$@"; do
    if ! grep -qF -- "$needle" "$body"; then
      echo "fetch_expect: FAILED — GET $url ($code) does not contain the required string: $needle" >&2
      echo "  body saved at $body — check whether the feature rendered at all" >&2
      return 1
    fi
  done

  if [ "$max_seconds" != "0" ]; then
    if ! LC_ALL=C awk -v t="$elapsed" -v m="$max_seconds" 'BEGIN { exit !(t <= m) }'; then
      echo "fetch_expect: FAILED — GET $url took ${elapsed}s, over the ${max_seconds}s deadline" >&2
      return 1
    fi
  fi

  rm -f "$body.curl.err"
  echo "fetch_expect: ok — GET $url -> $code in ${elapsed}s, $# required string(s) matched"
}
