#!/usr/bin/env python3
"""ADW Kill — stop a run: agent children first, then the workflow process.

Signals are sent only after verifying the pid still matches the command the
trace recorded — pids get recycled, and a recycled pid must not be killed.
The ADW's own SIGTERM handler (`_finalize_when_killed` in session.py)
finalizes the session as failed and closes its process rows, so the trace
never claims work is in flight that is already dead.

Usage:
    uv run adws/adw_kill.py --adw-id a1b2c3d4 [--grace 5]
"""

from __future__ import annotations

import argparse
import os
import signal
import sqlite3
import sys
import time
from pathlib import Path


def cmdline(pid: int) -> str:
    """What the pid is running right now ('' if it is gone)."""
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return ""
    return raw.replace(b"\0", b" ").decode(errors="replace").strip()


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(
        description="ADW Kill — stop a run: agent children first, then the workflow")
    ap.add_argument("--adw-id", required=True, help="the run to stop")
    ap.add_argument("--db", default="adws/adw_data/sssf.db",
                    help="trace db path (default: adws/adw_data/sssf.db)")
    ap.add_argument("--grace", type=float, default=5.0,
                    help="seconds between SIGTERM and SIGKILL (default 5)")
    args = ap.parse_args()

    db = Path(args.db)
    if not db.is_file():
        print(f"error: no trace db at {db}", file=sys.stderr)
        return 2
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

    rows = conn.execute(
        "SELECT kind, name, pid, command FROM processes"
        " WHERE adw_id=? AND ended_at IS NULL"
        " ORDER BY (kind = 'agent') DESC, id",  # children first, workflow last
        (args.adw_id,),
    ).fetchall()
    if not rows:
        print(f"no live processes recorded for {args.adw_id}")
        return 0

    targets = []
    for kind, name, pid, command in rows:
        actual = cmdline(pid)
        probe = (command or "").split()[0] if command else ""
        if not alive(pid):
            print(f"skip pid {pid}: already gone")
            continue
        if probe and probe not in actual:
            print(f"skip pid {pid}: recorded '{command}' but now running"
                  f" '{actual[:80]}' — recycled, not killing")
            continue
        targets.append((pid, kind, name))
        print(f"term {kind} {name or args.adw_id} pid {pid}")
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    deadline = time.monotonic() + max(0.0, args.grace)
    while time.monotonic() < deadline:
        if not any(alive(pid) for pid, _, _ in targets):
            break
        time.sleep(0.25)

    for pid, kind, name in targets:
        if alive(pid):
            print(f"kill -9 {kind} {name or args.adw_id} pid {pid}")
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
