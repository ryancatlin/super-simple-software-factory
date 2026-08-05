"""Dev-server lifecycle + mechanical evidence capture for validation phases.

The walk-away rule shapes everything here: a run must be safe to kick off and
leave. So every step has a deadline, every spawned process is registered in the
`processes` table before it can hang, and teardown is guaranteed — the ADW calls
`stop()` in a `finally`, and a `just kill` lands on the registered pid anyway.

Split on purpose:
  - This module is MACHINERY. It lives in adw_modules/ (protected_files), so no
    agent can edit it.
  - The DECLARATION — what to start, what to capture — lives in
    adws/adw_data/validation/, which is user-owned and agent-writable. That is
    what lets the factory build a project's own validation: an agent proposes
    the declaration, this code executes it.

Capture is code, not an agent (hard rule 8): driving agent-browser through a
known flow is a known command. The only judgement call — "does this evidence
show the app doing what was asked" — belongs to the validator agent, which
receives the evidence as an envelope and can neither hang the server nor
forget to stop it, because it never touches either.
"""

from __future__ import annotations

import os
import shlex
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel

from .data_types import (CaptureOutput, CaptureResult, EventRecord, FlowResult,
                         FlowSpec, ServiceSpec, ValidationDecl)
from .utils import now_iso, operator_env

DECLARATION_PATH = "adws/adw_data/validation/validation.yaml"
TAIL_CHARS = 4_000                  # evidence that rides in the envelope, bounded
HEALTH_POLL_SECONDS = 1.0
PORT_FREE_TIMEOUT_SECONDS = 10


class ServiceHandle(BaseModel):
    """One started service: enough to health-check it, log it, and stop it."""

    model_config = {"arbitrary_types_allowed": True}

    spec: ServiceSpec
    process: object                 # subprocess.Popen — its group id is the kill target
    log_path: str


# ── declaration ──────────────────────────────────────────────────────────────

def load_declaration(path: str = DECLARATION_PATH) -> Optional[ValidationDecl]:
    """The project's validation declaration, or None when none exists.

    Missing and `enabled: false` mean the same thing to a caller — skipped —
    but they are kept distinct so the skip reason can say which.
    """
    p = Path(path)
    if not p.is_file():
        return None
    return ValidationDecl.model_validate(yaml.safe_load(p.read_text()) or {})


# ── lifecycle ────────────────────────────────────────────────────────────────

def start(run, spec: ServiceSpec) -> ServiceHandle:
    """Spawn the service, register its pid, and wait for health — or fail fast.

    The pid goes into the `processes` table BEFORE the health wait, so a server
    that hangs on boot is already findable and killable by adw_id. On a health
    timeout the process group is stopped before raising: a failed provision
    never leaves a server behind.
    """
    log_dir = run.context_handoff_dir / "validation"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "service.log"
    command = shlex.join(spec.command)
    env = {**operator_env(), **spec.env}

    run.console.note(f"service: {command}")
    with log_path.open("w") as log:
        log.write(f"$ {command}\nstarted_at: {now_iso()}\n\n")
        log.flush()
        process = subprocess.Popen(spec.command, cwd=run.repo_root, env=env,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    run.tracer.process_start(run.adw_id, "service", "dev_server", process.pid, command)
    handle = ServiceHandle(spec=spec, process=process, log_path=str(log_path))

    deadline = time.monotonic() + spec.startup_timeout_seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            run.tracer.process_end(run.adw_id, process.pid)
            raise RuntimeError(
                f"service exited (code {process.returncode}) before becoming healthy — "
                f"log tail:\n{_tail(log_path)}")
        if _healthy(spec.health_url):
            run.console.note(f"service healthy at {spec.health_url} (pid {process.pid})")
            return handle
        time.sleep(HEALTH_POLL_SECONDS)

    stop(run, handle)
    raise RuntimeError(
        f"service never answered {spec.health_url} within "
        f"{spec.startup_timeout_seconds}s — log tail:\n{_tail(log_path)}")


def stop(run, handle: Optional[ServiceHandle]) -> bool:
    """Stop the service's whole process group and verify its port is free.

    Safe to call twice and on a handle that already died — teardown sits in a
    `finally`, so it must never be the thing that raises. Returns whether the
    port actually came free, and the caller logs that answer; a False here is a
    finding, not an exception.
    """
    if handle is None:
        return True
    process = handle.process
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)   # start_new_session: pid == pgid
            _wait_exit(process, handle.spec.shutdown_grace_seconds)
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                _wait_exit(process, 5)
        except (OSError, ProcessLookupError):
            pass                    # already gone — exactly what we wanted
    run.tracer.process_end(run.adw_id, process.pid)
    freed = _port_free(handle.spec.health_url)
    run.console.note(f"service stopped (pid {process.pid}), "
                     f"port {'freed' if freed else 'STILL OCCUPIED'}")
    return freed


# ── flow library neatness (mechanical, not disciplinary) ────────────────────

FLOWS_DIR = "adws/adw_data/validation/flows"
HEADER_PREFIX = "# Flow:"
HEADER_SCAN_LINES = 5


def lint_flows(decl: ValidationDecl, repo_root) -> list[str]:
    """The rules that keep a growing flow library neat, enforced in code.

    Three rules, checked before any flow runs: validation.yaml is the ONLY
    registry (an undeclared script under flows/ is an orphan that never runs —
    flagged, not ignored); every declared script exists; every flow's opening
    lines carry a `# Flow: <name> — <scenario it evidences>` header, so
    `grep '^# Flow:'` over flows/ IS the catalogue. Violations fail the capture
    with named failures and ride back to the builder like any other red flow.
    """
    failures: list[str] = []
    declared: dict = {}
    seen_names: set[str] = set()
    for flow in decl.flows:
        if flow.name in seen_names:
            failures.append(f"{flow.name}: declared more than once in validation.yaml")
        seen_names.add(flow.name)
        script = Path(repo_root) / flow.script
        if not script.is_file():
            failures.append(f"{flow.name}: declared script {flow.script} does not exist")
            continue
        declared[script.resolve()] = flow.name
        head = script.read_text().splitlines()[:HEADER_SCAN_LINES]
        if not any(line.startswith(HEADER_PREFIX) for line in head):
            failures.append(
                f"{flow.name}: {flow.script} is missing its `{HEADER_PREFIX} <name> — "
                f"<scenario it evidences>` header in the first {HEADER_SCAN_LINES} lines")
    flows_dir = Path(repo_root) / FLOWS_DIR
    if flows_dir.is_dir():
        for script in sorted(flows_dir.rglob("*.sh")):
            if script.resolve() not in declared:
                rel = script.relative_to(repo_root)
                failures.append(
                    f"{rel}: orphan — not declared in validation.yaml, so it never "
                    f"runs. Declare it or delete it.")
    return failures


# ── capture ──────────────────────────────────────────────────────────────────

def capture(run, decl: ValidationDecl) -> CaptureResult:
    """Run every declared flow script mechanically and collect the evidence.

    Flows run from their own evidence dir (agent-browser screenshots save to
    the cwd) with BASE_URL and EVIDENCE_DIR set. Same evidence every run,
    red or green — a failed run can be read the next morning instead of rerun.

    The registry lint runs first and a dirty library fails the whole capture:
    flows that would silently not run are exactly the kind of quiet rot a
    walk-away factory cannot afford.
    """
    base_url = _base_url(decl.service.health_url) if decl.service else ""
    lint = lint_flows(decl, run.repo_root)
    if lint:
        run.console.note(f"flow library lint: {len(lint)} violation(s)")
        return CaptureResult(passed=False, base_url=base_url, flows=[],
                             failures=[f"flow library: {v}" for v in lint])
    seq = run.phases[-1].seq if run.phases else 0
    results = [_run_flow(run, flow, base_url, seq) for flow in decl.flows]
    failures = [
        f"{r.name}: `{r.command}` exited {r.returncode}\n{r.output_tail}".rstrip()
        for r in results if not r.passed
    ]
    return CaptureResult(
        passed=not failures,
        base_url=base_url,
        flows=results,
        failures=failures,
        artifacts=[r.evidence_dir for r in results],
    )


def as_envelope(result: CaptureResult) -> CaptureOutput:
    """Shape the capture for the validator — the one door every handoff uses."""
    return CaptureOutput(
        status="success" if result.passed else "fail",
        summary=(f"capture: all {len(result.flows)} flow(s) completed" if result.passed
                 else f"capture: {len(result.failures)} of {len(result.flows)} flow(s) failed"),
        artifacts=result.artifacts,
        notes_for_next_agent=(
            "Read every evidence dir below — flow.log for what ran, plus any "
            "screenshots and response bodies the flow saved. Rule on the "
            "evidence, never on this summary."),
        passed=result.passed,
        base_url=result.base_url,
        evidence_dirs=[r.evidence_dir for r in result.flows],
        failures=result.failures,
    )


def _run_flow(run, flow: FlowSpec, base_url: str, seq: int) -> FlowResult:
    phase = run.phases[-1]
    # Absolute on purpose: the flow's cwd IS this dir, and $EVIDENCE_DIR must
    # still resolve from inside it (a relative path would double-resolve).
    evidence_dir = (run.context_handoff_dir / "validation" / f"{seq:02d}_{flow.name}").resolve()
    evidence_dir.mkdir(parents=True, exist_ok=True)
    script = Path(run.repo_root) / flow.script
    argv = ["bash", str(script)]
    command = shlex.join(argv)
    env = {**operator_env(), "BASE_URL": base_url, "EVIDENCE_DIR": str(evidence_dir)}

    run.console.note(f"flow {flow.name}: {command}")
    started_at = now_iso()
    clock = time.monotonic()
    stdout = ""
    stderr = ""
    try:
        completed = subprocess.run(argv, cwd=evidence_dir, env=env,
                                   capture_output=True, text=True,
                                   timeout=flow.timeout_seconds)
        returncode = completed.returncode
        stdout, stderr = completed.stdout, completed.stderr
    except subprocess.TimeoutExpired as error:
        returncode = 124
        stdout = error.stdout or ""
        stderr = (error.stderr or "") + f"\nTimed out after {flow.timeout_seconds}s."
    except OSError as error:
        returncode = 127
        stderr = str(error)

    duration = time.monotonic() - clock
    (evidence_dir / "flow.log").write_text(
        f"$ {command}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n")
    passed = returncode == 0
    run.tracer.event(EventRecord(
        adw_id=run.adw_id, phase_id=phase.phase_id, type="tool_call",
        name=f"flow:{flow.name}",
        payload={"command": command, "returncode": returncode, "passed": passed,
                 "evidence_dir": str(evidence_dir)},
        started_at=started_at, ended_at=now_iso()))
    run.console.note(f"flow {flow.name}: {'passed' if passed else 'failed'} "
                     f"(exit {returncode}, {duration:.1f}s)")
    return FlowResult(name=flow.name, command=command, returncode=returncode,
                      passed=passed, duration_seconds=duration,
                      evidence_dir=str(evidence_dir),
                      output_tail=(stdout + stderr)[-TAIL_CHARS:])


# ── plumbing ─────────────────────────────────────────────────────────────────

def _healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status < 500
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _host_port(url: str) -> tuple[str, int]:
    parsed = urllib.parse.urlparse(url)
    return parsed.hostname or "localhost", parsed.port or \
        (443 if parsed.scheme == "https" else 80)


def _base_url(health_url: str) -> str:
    parsed = urllib.parse.urlparse(health_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _port_free(health_url: str) -> bool:
    """True once nothing is listening any more — the resource is actually released."""
    host, port = _host_port(health_url)
    deadline = time.monotonic() + PORT_FREE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                pass                # still answering — wait for the group to die
        except OSError:
            return True
        time.sleep(0.5)
    return False


def _wait_exit(process, seconds: float) -> None:
    try:
        process.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        pass


def _tail(log_path: str | Path, chars: int = TAIL_CHARS) -> str:
    try:
        return Path(log_path).read_text()[-chars:]
    except OSError:
        return "(no log)"
