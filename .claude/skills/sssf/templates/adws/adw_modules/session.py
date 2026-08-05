"""Session lifecycle: pin-or-create an adw_id, build the Run object.

`ensure(cfg, adw_id)` joins the session if it exists or creates it under
exactly that id (pinned ids for repeatable runs); omitted, a fresh id is
minted and printed so the next ADW can pick it up.
"""

from __future__ import annotations

import os
import signal
import sys
from pathlib import Path

from .data_types import SSSFConfig
from .runner import Run
from .tracer import Tracer
from .utils import engineer_name, new_id, now_iso


def _reconcile_dead_runs(tracer: Tracer, current_adw_id: str) -> None:
    """Mark 'running' sessions whose workflow process no longer exists.

    SIGKILL and a closed terminal never reach _finalize_when_killed, so a
    hard-killed run leaves an immortal 'running' row claiming work is in
    flight. Every new run sweeps: a session is dead when its recorded adw pid
    is gone or recycled (cmdline no longer matches). Genuinely live runs are
    untouched — /proc says so, not a timeout.
    """
    rows = tracer.conn.execute(
        "SELECT s.adw_id, p.pid, p.command FROM sessions s"
        " JOIN processes p ON p.adw_id = s.adw_id AND p.kind = 'adw'"
        " WHERE s.status = 'running' AND s.adw_id != ?",
        (current_adw_id,)).fetchall()
    for adw_id, pid, command in rows:
        try:
            actual = (Path(f"/proc/{pid}/cmdline").read_bytes()
                      .replace(b"\0", b" ").decode(errors="replace"))
        except OSError:
            actual = ""
        probe = (command or "").split()[0] if command else ""
        if actual and (not probe or probe in actual):
            continue                                  # genuinely still alive
        ts = now_iso()
        tracer.conn.execute(
            "UPDATE sessions SET status='fail', ended_at=?"
            " WHERE adw_id=? AND status='running'", (ts, adw_id))
        tracer.conn.execute(
            "UPDATE phases SET status='fail', ended_at=?,"
            " error='process died without finalizing (hard kill or crash)'"
            " WHERE adw_id=? AND status='running'", (ts, adw_id))
        tracer.processes_end_all(adw_id)


def _finalize_when_killed(run: Run) -> None:
    """A killed run still closes its own trace.

    Python's default SIGTERM handling exits without unwinding, so `just kill`
    (or any `kill <pid>`) would leave the session reading `running` forever and
    its process rows open — the trace would claim work is in flight that is
    already dead. Turning the signal into SystemExit both finalizes here and
    lets the phase context manager record the phase as failed on the way out.
    """
    def handler(signum, _frame):
        run.tracer.session_finish(run.adw_id, ok=False)   # also closes process rows
        raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, handler)


def ensure(cfg: SSSFConfig, adw_id: str | None = None) -> Run:
    adw_id = adw_id or new_id(8)
    tracer = Tracer(cfg.observability.db,
                    f"{cfg.defaults.data_dir}/sessions/{adw_id}/events.jsonl")
    run = Run(cfg=cfg, adw_id=adw_id, tracer=tracer, engineer=engineer_name())
    tracer.session_start(adw_id, run.engineer, adw_name=Path(sys.argv[0]).stem)
    _reconcile_dead_runs(tracer, adw_id)   # hard-killed runs stop reading 'running'
    # This process is the run. Record it before any phase opens, so a run that
    # hangs in its first agent call is still killable by adw_id.
    tracer.process_start(adw_id, "adw", "", os.getpid(),
                         " ".join([Path(sys.argv[0]).name, *sys.argv[1:]]))
    _finalize_when_killed(run)
    run.console.session_started(adw_id, run.engineer)
    return run
