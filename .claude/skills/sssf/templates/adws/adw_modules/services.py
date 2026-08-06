"""Dev-server lifecycle + mechanical evidence capture for validation phases.

The walk-away rule shapes everything here: a run must be safe to kick off and
leave. So every step has a deadline, every spawned process is registered in the
`processes` table before it can hang, and teardown is guaranteed — the ADW calls
`stop()` in a `finally`, and a `just kill` lands on the registered pid anyway.

Split on purpose:
  - This module is MACHINERY. It lives in adw_modules/ (protected_files), so no
    agent can edit it. So does flow_lib/ — the verbs flows source ($FLOW_LIB,
    exported below beside $BASE_URL and $EVIDENCE_DIR): asserting a status
    code or waiting for a page to render is a known command, and every flow
    hand-rolling its own was where the weak assertions came from.
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
import re
import shlex
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from io import StringIO
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
    log_path.write_text("")         # fresh log per provision, prepare included
    command = shlex.join(spec.command)
    env = {**operator_env(), **spec.env}

    # The prod pipeline's build step, run to completion before the server
    # starts. Its own deadline, its own honest failure: a build that breaks
    # is a red finding here, never a server that silently serves stale code.
    if spec.prepare:
        prepare_cmd = shlex.join(spec.prepare)
        run.console.note(f"prepare: {prepare_cmd}")
        started = time.monotonic()
        try:
            prep = subprocess.run(spec.prepare, cwd=run.repo_root, env=env,
                                  capture_output=True, text=True,
                                  timeout=spec.prepare_timeout_seconds)
        except subprocess.TimeoutExpired as error:
            tail = ((error.stdout or "") + (error.stderr or ""))[-TAIL_CHARS:]
            raise RuntimeError(
                f"prepare `{prepare_cmd}` timed out after "
                f"{spec.prepare_timeout_seconds}s — tail:\n{tail}")
        with log_path.open("a") as log:
            log.write(f"$ {prepare_cmd}\nexit: {prep.returncode} "
                      f"({time.monotonic() - started:.1f}s)\n\n"
                      f"{prep.stdout}\n{prep.stderr}\n\n")
        if prep.returncode != 0:
            raise RuntimeError(
                f"prepare `{prepare_cmd}` exited {prep.returncode} — the "
                f"shippable artifact does not build. Tail:\n"
                f"{(prep.stdout + prep.stderr)[-TAIL_CHARS:]}")

    run.console.note(f"service: {command}")
    with log_path.open("a") as log:
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

FLOW_LIB_DIR = "adws/adw_modules/flow_lib"        # factory-owned verbs, agent-unwritable
FLOWS_DIR = "adws/adw_data/validation/flows"
LIB_DIR = "adws/adw_data/validation/flows/lib"    # shared steps, sourced by flows
PROBES_DIR = "adws/adw_data/validation/flows/probes"  # request-scoped acceptance journeys
HEADER_PREFIX = "# Flow:"
LIB_HEADER_PREFIX = "# Step:"
PROBE_HEADER_PREFIX = "# Probe:"
HEADER_SCAN_LINES = 5
RUN_ARTIFACTS_MARKER = "adw_data/sessions/"


def _run_artifact_violation(text: str, label: str) -> str | None:
    """A script asserting on a past run's evidence instead of on the product.

    Session dirs are frozen output: a probe pointed at one keeps passing long
    after the feature it "proves" is gone, and keeps passing if the app is not
    even running. Observed live — a probe pinned to a dead session directory.

    Comment lines are skipped: flows legitimately DOCUMENT where their evidence
    lands, and a lint that fires on prose gets worked around rather than obeyed.
    Only executable text counts.
    """
    code = "\n".join(line for line in text.splitlines()
                     if not line.lstrip().startswith("#"))
    if RUN_ARTIFACTS_MARKER not in code:
        return None
    return (f"{label}: references run artifacts under {RUN_ARTIFACTS_MARKER} — probes "
            f"assert the product, not the trace. A past run's evidence is frozen: it "
            f"cannot fail when the feature breaks. Assert against $BASE_URL instead.")


def lint_flows(decl: ValidationDecl, repo_root) -> list[str]:
    """The rules that keep a growing flow library neat, enforced in code.

    Three rules, checked before any flow runs: validation.yaml is the ONLY
    registry (an undeclared script under flows/ is an orphan that never runs —
    flagged, not ignored); every declared script exists; every flow's opening
    lines carry a `# Flow: <name> — <scenario it evidences>` header, so
    `grep '^# Flow:'` over flows/ IS the catalogue. Violations fail the capture
    with named failures and ride back to the builder like any other red flow.

    flows/lib/ is the reuse tier: shared steps (a login, a seeded record) that
    flows `source`, never run directly. Lib scripts are exempt from the
    registry rule but carry their own `# Step: <name> — <what it does>` header
    — so `grep '^# Step:'` over lib/ is the shared-step catalogue, and a
    declared flow living under lib/ is itself a violation.

    A fourth rule is about honesty rather than neatness: no script may assert
    against adw_data/sessions/. See _run_artifact_violation.
    """
    failures: list[str] = []
    declared: dict = {}
    seen_names: set[str] = set()
    lib_dir = (Path(repo_root) / LIB_DIR).resolve()
    probes_dir = (Path(repo_root) / PROBES_DIR).resolve()
    for tier, header, specs in (("flow", HEADER_PREFIX, decl.flows),
                                ("probe", PROBE_HEADER_PREFIX, decl.probes)):
        for flow in specs:
            if flow.name in seen_names:
                failures.append(f"{flow.name}: declared more than once in validation.yaml")
            seen_names.add(flow.name)
            script = Path(repo_root) / flow.script
            if not script.is_file():
                failures.append(f"{flow.name}: declared script {flow.script} does not exist")
                continue
            if script.resolve().is_relative_to(lib_dir):
                failures.append(
                    f"{flow.name}: {flow.script} lives under flows/lib/ — lib holds "
                    f"shared steps flows source, never flows themselves. Move it up.")
            in_probes = script.resolve().is_relative_to(probes_dir)
            if tier == "flow" and in_probes:
                failures.append(
                    f"{flow.name}: {flow.script} is declared as a floor flow but lives "
                    f"under flows/probes/ — promote it properly (adw_promote.py moves "
                    f"the file and the declaration entry together).")
            if tier == "probe" and not in_probes:
                failures.append(
                    f"{flow.name}: {flow.script} is declared as a probe but lives "
                    f"outside flows/probes/ — probes live there so the floor stays "
                    f"visibly minimal.")
            declared[script.resolve()] = flow.name
            text = script.read_text()
            violation = _run_artifact_violation(text, f"{flow.name}: {flow.script}")
            if violation:
                failures.append(violation)
            head = text.splitlines()[:HEADER_SCAN_LINES]
            if not any(line.startswith(header) for line in head):
                failures.append(
                    f"{flow.name}: {flow.script} is missing its `{header} <name> — "
                    f"<what it evidences>` header in the first {HEADER_SCAN_LINES} lines")
    flows_dir = Path(repo_root) / FLOWS_DIR
    if flows_dir.is_dir():
        for script in sorted(flows_dir.rglob("*.sh")):
            if script.resolve().is_relative_to(lib_dir):
                text = script.read_text()
                violation = _run_artifact_violation(
                    text, str(script.relative_to(repo_root)))
                if violation:
                    failures.append(violation)
                head = text.splitlines()[:HEADER_SCAN_LINES]
                if not any(line.startswith(LIB_HEADER_PREFIX) for line in head):
                    failures.append(
                        f"{script.relative_to(repo_root)}: shared step is missing its "
                        f"`{LIB_HEADER_PREFIX} <name> — <what it does>` header in the "
                        f"first {HEADER_SCAN_LINES} lines")
                continue
            if script.resolve() not in declared:
                rel = script.relative_to(repo_root)
                registry = "probes:" if script.resolve().is_relative_to(probes_dir) else "flows:"
                failures.append(
                    f"{rel}: orphan — not declared under `{registry}` in "
                    f"validation.yaml, so it never runs. Declare it, delete it, or "
                    f"move it to flows/lib/ if it is a shared step other flows source.")
    return failures


# ── coverage (the proof obligation, checked in code) ─────────────────────────

def _norm(text: str) -> str:
    return " ".join(text.split()).casefold()


def coverage_gaps(criteria: list[str], mapping, decl: ValidationDecl) -> list[str]:
    """Totality check on the extend phase's mapping — pure code, milliseconds.

    Every acceptance criterion must be mapped to at least one DECLARED flow or
    probe; a criterion with no coverage, or coverage citing a name nothing
    declares, is a hole the run fails on before a server ever boots. This is
    the check run 2ab14be3 was missing: honest work with no live evidence for
    the thing that actually changed.
    """
    known = {f.name for f in decl.flows} | {p.name for p in decl.probes}
    claimed = {_norm(m.criterion): list(m.covered_by) for m in mapping}
    gaps: list[str] = []
    for criterion in criteria:
        covered_by = claimed.get(_norm(criterion))
        if not covered_by:
            gaps.append(f"criterion has no coverage: {criterion!r} — map it to a "
                        f"declared flow or probe (author one if none fits)")
            continue
        unknown = [n for n in covered_by if n not in known]
        if unknown:
            gaps.append(f"criterion {criterion!r} cites undeclared name(s): "
                        f"{', '.join(unknown)} — declare them in validation.yaml")
    return gaps


def select_probes(decl: ValidationDecl, mapping) -> list["FlowSpec"]:
    """The probes this run's mapping cites — only those execute this pass.

    The floor always runs in full; probes are additive acceptance evidence, so
    an uncited probe stays on the shelf and costs nothing.
    """
    cited = {name for m in mapping for name in m.covered_by}
    return [p for p in decl.probes if p.name in cited]


# ── capture ──────────────────────────────────────────────────────────────────

def capture(run, decl: ValidationDecl,
            probes: Optional[list[FlowSpec]] = None) -> CaptureResult:
    """Run the floor (every declared flow) plus any selected probes; keep evidence.

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
    results = [_run_flow(run, flow, base_url, seq)
               for flow in [*decl.flows, *(probes or [])]]
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


def _rel(path: str) -> str:
    """Repo-relative when the path is under the repo, else unchanged.

    Execution keeps absolute paths (a flow's cwd IS its evidence dir), but
    agents run from the repo root — handing them absolute paths just makes
    every model open its bash calls with a needless `cd`. Relativize at the
    handoff door, nowhere else.
    """
    try:
        return str(Path(path).resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return path


def as_envelope(result: CaptureResult) -> CaptureOutput:
    """Shape the capture for the validator — the one door every handoff uses."""
    return CaptureOutput(
        status="success" if result.passed else "fail",
        summary=(f"capture: all {len(result.flows)} flow(s) completed" if result.passed
                 else f"capture: flow library lint failed ({len(result.failures)} violation(s))"
                 if not result.flows
                 else f"capture: {len(result.failures)} of {len(result.flows)} flow(s) failed"),
        artifacts=[_rel(a) for a in result.artifacts],
        notes_for_next_agent=(
            "Read every evidence dir below — flow.log for what ran, plus any "
            "screenshots and response bodies the flow saved. Rule on the "
            "evidence, never on this summary. Paths are relative to the repo "
            "root, which is already your working directory — no cd needed."),
        passed=result.passed,
        base_url=result.base_url,
        evidence_dirs=[_rel(r.evidence_dir) for r in result.flows],
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
    # FLOW_LIB points at the factory's own verbs (fetch_expect, capture_wait…),
    # which flows `source` instead of hand-rolling curl and browser assertions.
    # Absolute, like EVIDENCE_DIR, because the flow's cwd is its evidence dir.
    env = {**operator_env(), "BASE_URL": base_url, "EVIDENCE_DIR": str(evidence_dir),
           "FLOW_LIB": str((Path(run.repo_root) / FLOW_LIB_DIR).resolve())}

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

    # Counted BEFORE flow.log and the toolkit sidecars land, so what remains is
    # exactly what the FLOW saved. An exit code is the verdict only when there
    # is evidence behind it: a script that asserted nothing and touched nothing
    # exits 0 just as cheerfully as one that proved the journey.
    saved = sorted(p.name for p in evidence_dir.iterdir() if p.is_file())
    if returncode == 0 and not saved:
        stderr += ("\nEVIDENCE CHECK FAILED: exit 0 but no evidence saved — a flow "
                   "that recorded nothing proved nothing. Write your response "
                   "bodies, snapshots and screenshots to $EVIDENCE_DIR.")

    (evidence_dir / "flow.log").write_text(
        f"$ {command}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"evidence_files: {', '.join(saved) or 'NONE'}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n")
    _enrich_evidence(flow.name, evidence_dir, run.repo_root)
    passed = returncode == 0 and bool(saved)
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


# ── evidence toolkit (mechanical enrichment, best-effort, never fails a flow) ─
#
# Everything here exists because of a measured failure mode: a text-only
# validator, handed raw pixels, improvised its own OCR pipeline for 442k
# tokens. Extraction is a known command, so it runs HERE, once, in
# milliseconds — the validator judges the extracted text. Each processor is
# guarded (a missing binary is noted, never fatal) and every action or skip
# lands in toolkit.txt, so thin evidence is visibly thin instead of silently
# thin.

BASELINES_DIR = "adws/adw_data/validation/baselines"
BLANK_STDDEV = 0.01                 # pixel stddev below this = uniform image


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = StringIO()
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.out.write(data.strip() + "\n")


def _enrich_evidence(flow_name: str, evidence_dir: Path, repo_root) -> None:
    """Post-process a flow's evidence: OCR, blank check, baseline diff, html→text."""
    notes: list[str] = []
    have_magick = bool(shutil.which("magick"))
    have_tesseract = bool(shutil.which("tesseract"))
    baselines = Path(repo_root) / BASELINES_DIR / flow_name

    for png in sorted(evidence_dir.glob("*.png")):
        if png.name.endswith(".diff.png"):
            continue
        # dimensions + blank detection — a solid-colour "screenshot" is the
        # classic silent capture failure, flagged in the evidence itself
        if have_magick:
            probe = _cmd(["magick", "identify", "-format",
                          "%wx%h %[fx:standard_deviation]", str(png)])
            if probe is not None:
                size, _, stddev = probe.partition(" ")
                blank = _to_float(stddev) is not None and _to_float(stddev) < BLANK_STDDEV
                notes.append(f"{png.name}: {size}"
                             + (" — LIKELY BLANK (uniform pixels), treat this "
                                "capture as failed evidence" if blank else ""))
        else:
            notes.append(f"{png.name}: magick not installed — no size/blank check")
        # OCR sidecar: pixels become judgeable text
        if have_tesseract:
            text = _cmd(["tesseract", str(png), "-"])
            if text is not None:
                png.with_suffix(".ocr.txt").write_text(text)
                notes.append(f"{png.name}: OCR -> {png.with_suffix('.ocr.txt').name}")
        else:
            notes.append(f"{png.name}: tesseract not installed — no OCR sidecar")
        # baseline diff: drift score + diff image, when a blessed baseline exists
        baseline = baselines / png.name
        if not baseline.is_file():
            notes.append(f"{png.name}: no baseline at "
                         f"{BASELINES_DIR}/{flow_name}/{png.name} — bless one with "
                         f"adw_bless.py to enable visual regression")
        elif have_magick:
            diff_png = png.with_suffix(".diff.png")
            result = subprocess.run(
                ["magick", "compare", "-metric", "RMSE", str(baseline), str(png),
                 str(diff_png)], capture_output=True, text=True, timeout=60)
            match = re.search(r"\(([\d.eE+-]+)\)", result.stderr)
            if result.returncode in (0, 1) and match:
                drift = float(match.group(1))
                notes.append(f"{png.name}: baseline drift {drift:.4f} "
                             f"(0=identical, 1=every pixel) -> {diff_png.name}")
            else:
                notes.append(f"{png.name}: baseline compare failed "
                             f"({result.stderr.strip()[:120]})")

    for html in sorted(evidence_dir.glob("*.html")):
        extractor = _TextExtractor()
        try:
            extractor.feed(html.read_text(errors="replace"))
            html.with_suffix(".txt").write_text(extractor.out.getvalue())
            notes.append(f"{html.name}: text -> {html.with_suffix('.txt').name}")
        except Exception as error:                          # noqa: BLE001
            notes.append(f"{html.name}: text extraction failed ({error})")

    if notes:
        (evidence_dir / "toolkit.txt").write_text(
            "Mechanical evidence toolkit — what ran, what was skipped, and why.\n"
            "Judge from the sidecars; do not re-derive them.\n\n"
            + "\n".join(notes) + "\n")


def bless_baselines(adw_id: str, data_dir: str = "adws/adw_data",
                    repo_root: str | Path = ".") -> list[str]:
    """Accept a run's screenshots as the baselines future runs diff against.

    Copies every non-diff PNG from the session's flow evidence dirs into
    BASELINES_DIR/<flow>/, mirroring names. Returns what it blessed. Baselines
    are user-owned project source — commit them like the flows.
    """
    root = Path(repo_root)
    validation_dir = root / data_dir / "sessions" / adw_id / "context_handoff" / "validation"
    blessed: list[str] = []
    for evidence_dir in sorted(validation_dir.glob("[0-9][0-9]_*")):
        flow_name = evidence_dir.name.split("_", 1)[1]
        for png in sorted(evidence_dir.glob("*.png")):
            if png.name.endswith(".diff.png"):
                continue
            target = root / BASELINES_DIR / flow_name / png.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(png, target)
            blessed.append(str(target.relative_to(root)))
    return blessed


def _cmd(argv: list[str], timeout: int = 60) -> Optional[str]:
    """Run a toolkit command; None on any failure — enrichment never raises."""
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def _to_float(text: str) -> Optional[float]:
    try:
        return float(text)
    except ValueError:
        return None


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
