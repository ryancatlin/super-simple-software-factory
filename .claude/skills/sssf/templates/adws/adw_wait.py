#!/usr/bin/env python3
"""ADW Wait — block until a run finishes, without burning agent tokens.

The orchestrator launches the ADW in the background (so the run stays
observable and killable), then runs THIS script as one blocking tool call.
Code polls the trace db — free — while the agent waits. When the run goes
terminal the script prints a compact summary and exits with the run's
outcome (0 success, 1 fail).

The run's own stdout already narrates everything live; the visualizer is
the human's live view. This script exists so the AGENT never has to poll.

Usage:
    uv run adws/adw_wait.py --adw-id a1b2c3d4 [--poll-ms 2000] [--timeout 0]
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from pathlib import Path


def report(conn: sqlite3.Connection, adw_id: str, status: str) -> int:
    """Print the compact post-run summary and map status to an exit code."""
    s = conn.execute(
        "SELECT total_tokens, total_cost, request FROM sessions WHERE adw_id=?",
        (adw_id,),
    ).fetchone()
    phases = conn.execute(
        "SELECT seq, name, kind, owner, status FROM phases"
        " WHERE adw_id=? ORDER BY seq",
        (adw_id,),
    ).fetchall()
    print(f"run {adw_id}: {status}")
    for seq, name, kind, owner, pstatus in phases:
        print(f"  {seq:>2}  {name:<14} {kind:<10} {owner or '':<12} {pstatus}")
    if s:
        print(f"  tokens {s[0] or 0}  cost ${(s[1] or 0.0):.4f}"
              + (f"  request: {(s[2] or '')[:60]}" if s[2] else ""))
    return 0 if status == "success" else 1


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ADW Wait — block until a run finishes without burning tokens")
    ap.add_argument("--adw-id", required=True, help="the run to wait on")
    ap.add_argument("--db", default="adws/adw_data/sssf.db",
                    help="trace db path (default: adws/adw_data/sssf.db)")
    ap.add_argument("--poll-ms", type=int, default=2000,
                    help="db poll cadence in ms (default 2000)")
    ap.add_argument("--timeout", type=float, default=0.0,
                    help="give up after N seconds and exit 3 (0 = wait forever)")
    args = ap.parse_args()

    db = Path(args.db)
    if not db.is_file():
        print(f"error: no trace db at {db}", file=sys.stderr)
        return 2
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    row = conn.execute(
        "SELECT status FROM sessions WHERE adw_id=?", (args.adw_id,)).fetchone()
    if row is None:
        print(f"error: no session {args.adw_id} in {db}", file=sys.stderr)
        return 2
    if row[0] != "running":
        # already terminal — report and leave immediately
        return report(conn, args.adw_id, row[0])

    poll = max(0.1, args.poll_ms / 1000.0)
    started = time.monotonic()
    print(f"waiting on {args.adw_id} (poll {args.poll_ms}ms)...", flush=True)

    while True:
        row = conn.execute(
            "SELECT status FROM sessions WHERE adw_id=?", (args.adw_id,)).fetchone()
        if row is None:
            print(f"error: session {args.adw_id} vanished from the trace",
                  file=sys.stderr)
            return 2
        status = row[0]
        if status != "running":
            return report(conn, args.adw_id, status)

        # Dead-run detection: the ADW process row is written at startup and
        # only closed by finalize (SIGTERM handler) or session end. If every
        # process row is closed but the session still reads `running`, the
        # workflow died hard (crash/SIGKILL) without finalizing — do not wait
        # forever on a corpse.
        live = conn.execute(
            "SELECT COUNT(*) FROM processes"
            " WHERE adw_id=? AND ended_at IS NULL", (args.adw_id,)).fetchone()[0]
        ever = conn.execute(
            "SELECT COUNT(*) FROM processes WHERE adw_id=?", (args.adw_id,)).fetchone()[0]
        if ever > 0 and live == 0:
            print(f"run {args.adw_id} died without finalizing"
                  " (no live processes, status still 'running')")
            return report(conn, args.adw_id, "fail")

        if args.timeout and time.monotonic() - started > args.timeout:
            print(f"timeout after {args.timeout:g}s — run still {status}",
                  file=sys.stderr)
            return 3
        time.sleep(poll)


if __name__ == "__main__":
    sys.exit(main())
