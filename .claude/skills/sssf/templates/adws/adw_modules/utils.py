"""Small shared helpers. Anything bigger belongs in its own module."""

from __future__ import annotations

import os
import secrets
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEFAULT_STALL_SECONDS = 600


def stall_seconds() -> int:
    """Silence budget for a coding agent's stream, in seconds (0 disables).

    600s is deliberate, not conservative: pi and claude only emit a tool event
    when a tool RETURNS, so a single long tool call is legitimately silent for
    its whole duration. SSSF_AGENT_STALL_SECONDS is the escape hatch for repos
    where one honest step really does run longer than that.
    """
    try:
        return int(os.environ.get("SSSF_AGENT_STALL_SECONDS", "")
                   or DEFAULT_STALL_SECONDS)
    except ValueError:
        return DEFAULT_STALL_SECONDS


class StallWatchdog:
    """Kills a coding-agent subprocess that has gone silent, and its children.

    A wedged agent is otherwise a blocking readline that never returns: the ADW
    sits at 0% CPU until a human notices and hunts the pid. The reader loop
    bumps this on every line; a daemon thread kills the process GROUP once the
    silence exceeds the budget, which ends the stream and unblocks the loop.

    The group matters as much as the timeout — the wedge that motivated this
    was an HTTP server the agent spawned as a CHILD, so signalling the agent
    alone would have left the real offender running. The caller must therefore
    Popen with ``start_new_session=True``; without it this signals the ADW's
    own group and takes the run down with it.
    """

    def __init__(self, process, label: str = "agent", seconds: int | None = None) -> None:
        self.process = process
        self.label = label
        self.seconds = stall_seconds() if seconds is None else seconds
        try:
            self.pgid = os.getpgid(process.pid)
        except OSError:
            self.pgid = process.pid
        self._last = time.monotonic()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.fired = False

    def start(self) -> "StallWatchdog":
        if self.seconds > 0:
            self._thread = threading.Thread(target=self._watch, daemon=True,
                                            name=f"sssf-stall-{self.label}")
            self._thread.start()
        return self

    def bump(self) -> None:
        self._last = time.monotonic()

    def stop(self) -> None:
        """Always call this — a live watchdog can still fire after success."""
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)
            self._thread = None

    def stall_error(self) -> RuntimeError:
        return RuntimeError(f"{self.label} stalled — no output for "
                            f"{self.seconds}s; killed process group {self.pgid}")

    def kill_group(self, grace: float = 5.0) -> None:
        """SIGTERM the group, escalating to SIGKILL if anything survives grace."""
        try:
            os.killpg(self.pgid, signal.SIGTERM)
        except OSError:
            return
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            time.sleep(0.1)
            self.process.poll()   # reap the leader, else its zombie holds the group open
            try:
                os.killpg(self.pgid, 0)
            except OSError:
                return
        try:
            os.killpg(self.pgid, signal.SIGKILL)
        except OSError:
            pass

    def _watch(self) -> None:
        interval = max(0.25, min(5.0, self.seconds / 10.0))
        while not self._stop.wait(interval):
            if self.process.poll() is not None:
                return
            if time.monotonic() - self._last < self.seconds:
                continue
            self.fired = True
            self.kill_group()
            return


def operator_env() -> dict[str, str]:
    """The engineer's own environment, as their shell would hand it over.

    Agents and quality blocks are meant to see exactly what the operator sees:
    their PATH, their toolchains, their globally installed packages. Copying
    os.environ gets almost all the way there — but ADWs launch under `uv run`,
    which prepends its ephemeral venv's bin to PATH and sets VIRTUAL_ENV. That
    venv holds the ADW's OWN dependencies (pydantic, pyyaml), not the
    operator's, so anything a subprocess resolves through it — `python3`,
    `pip`, every globally pip-installed CLI — silently becomes the wrong one.

    Stripping the venv restores parity: `python3` in an agent's bash is the
    same `python3` the engineer gets in their terminal. The ADW's own imports
    are unaffected; this env is only ever handed to child processes.
    """
    env = os.environ.copy()
    venv = env.pop("VIRTUAL_ENV", "")
    if not venv:
        return env
    venv_bin = str(Path(venv) / "bin")
    parts = [p for p in env.get("PATH", "").split(os.pathsep) if p and p != venv_bin]
    env["PATH"] = os.pathsep.join(parts)
    return env


def new_id(length: int = 8) -> str:
    return secrets.token_hex(length // 2)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def resolve_prompt(arg: str) -> str:
    """CLI prompt arg: a file path resolves to its contents, else inline text."""
    try:
        p = Path(arg)
        if p.is_file():
            return p.read_text()
    except OSError:
        pass
    return arg


def engineer_name() -> str:
    name = os.environ.get("ENGINEER_NAME", "").strip()
    if name:
        return name
    try:
        out = subprocess.run(["git", "config", "user.name"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except OSError:
        pass
    return os.environ.get("USER", "engineer")
