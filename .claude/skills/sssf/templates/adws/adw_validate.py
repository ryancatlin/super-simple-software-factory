#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Validate — run the app, capture evidence mechanically, rule on it.

Usage:
    uv run adws/adw_validate.py "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> code(provision) -> code(capture) -> validator -> code(teardown)

Validation is not testing (does the suite pass) and not review (is the code
right) — it answers "does the running app behave". The split follows hard
rule 8: starting the server and driving the browser through declared flows are
known commands, so CODE provisions, captures, and tears down. The validator
agent only reads the evidence and rules; it can neither hang the server nor
forget to stop it, because it never touches either.

Requires the project's validation declaration (adws/adw_data/validation/) to be
set up and enabled — see cookbooks/setup_validation.md. Until then this run
reports skipped-and-red, never green: a run that did not validate must not
read as validated.

Teardown is guaranteed: it runs as its own phase on the happy path and in a
`finally` on every crash path — including `just kill`, which session.ensure
turns into SystemExit, so even a killed run stops its own server.
"""

import argparse
import sys

from adw_modules import agents, gates, services, session, utils
from adw_modules.data_types import AgentCall, AuditOutput, PhaseParams

REQUIRED_AGENTS = ["validator"]

# The extend phase's brief, shared by every chain that proves a request against
# the running app. It is the ONE concentrated judgement point in the whole
# guarantee — translating the request's acceptance criteria into falsifiable
# probes — so its output is a committed, diffable artifact (probe scripts + a
# criterion->coverage mapping), audited by a different agent and checked for
# totality in code. Everything downstream is exit codes.
EXTEND_BRIEF = """Decide how this run's acceptance criteria will be PROVEN against the running app, and report the mapping. Your write access is MECHANICALLY limited to adws/adw_data/validation/ — you extend the measuring instrument, never the app. Any change outside it is rolled back and fails the phase.

For each acceptance criterion, cheapest first:
1. The FLOOR already covers it — an existing flow's evidence demonstrates it. Cite that flow's name. (`grep '^# Flow:' adws/adw_data/validation/flows/*.sh` is the catalogue.)
2. An existing PROBE covers it — cite its name. (`grep '^# Probe:' adws/adw_data/validation/flows/probes/*.sh` is the probe library; reuse beats re-authoring.)
3. Nothing covers it — WRITE a new probe: a small bash script in adws/adw_data/validation/flows/probes/, declared under `probes:` in validation.yaml (undeclared scripts never run and fail the lint), opening lines `# Probe: <name> — <criterion it discharges>`. Compose from flows/lib/ shared steps where they exist.

Probes carry the same mechanical contract as flows: run with $BASE_URL and $EVIDENCE_DIR set, cwd = $EVIDENCE_DIR; agent-browser is the primary instrument (open, snapshot -i, get text @ref, screenshot — ALWAYS an explicit path like "$EVIDENCE_DIR/<name>.png"; poll client-rendered pages until the expected content appears, bounded retries then fail); curl is the degrade path; save evidence and exit non-zero on any checkable failure. THE EXIT CODE IS THE VERDICT: assert the criterion itself, never less — a probe that opens the page but does not assert the promised behaviour proves nothing and will be failed by the audit.

Use the factory's verbs before hand-rolling anything: `source "$FLOW_LIB/http.sh"` gives you `fetch_expect <url> <outfile> <status> [max_seconds] [required_string ...]`; `source "$FLOW_LIB/browser.sh"` gives you `have_browser`, `require_browser`, `capture <name> <url>`, `capture_wait <name> <url> <pattern> [timeout]`. They assert status, non-empty body, content and deadline correctly, and their degrade path still asserts. Hand-rolled curl is where weak assertions come from.

Never: assert a frozen count or frozen prose ("42 results", a marketing sentence) — content changes and the probe reds for nothing; assert against anything under adws/adw_data/sessions/ (a past run's evidence is frozen and cannot fail — the lint rejects it); point a negative/unreachable-target probe at a REAL hostname (use an RFC 5737 address like 192.0.2.1 or 10.255.255.1 — a production host gets hammered by every run). A negative probe needs a positive control first: prove the instrument sees the real app working, or its failure proves nothing about anything.

Report `mapping` with every criterion VERBATIM and `covered_by` naming declared flows/probes; `new_probes` lists any scripts you wrote. Code checks the mapping for totality before the server boots, executes the floor plus every cited probe, and computes the verdict from exit codes. Do NOT start the service or run anything yourself.

"""


def declaration_gap(decl) -> str:
    """Why validation cannot run yet, or '' when it can."""
    if decl is None:
        return f"no declaration at {services.DECLARATION_PATH}"
    if not decl.enabled:
        return "declaration exists but enabled is false"
    if decl.service is None:
        return "enabled, but no service is declared"
    if not decl.flows:
        return "enabled, but no capture flows are declared"
    return ""


def main(prompt: str, config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    cfg = agents.load_config(config)
    agents.validate(cfg, REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)

    with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer,
                               description="Capture the incoming ask")) as ph:
        ph.log(input=prompt)

    decl = services.load_declaration()
    gap = declaration_gap(decl)
    if gap:
        with run.phase(PhaseParams(name="validate_skipped", kind="code", owner="service",
                                   description="Record that validation could not run, so a run that did not validate never reads as validated")) as ph:
            ph.log(status="skipped", reason=gap,
                   next_step="see cookbooks/setup_validation.md")
        return run.finish(accepted=False, reason=f"validation skipped: {gap}")

    verdict = None
    handle = None
    torn_down = False
    try:
        with run.phase(PhaseParams(name="provision", kind="code", owner="service",
                                   description="Start the declared service and wait for health, with a hard deadline")) as ph:
            handle = services.start(run, decl.service)
            ph.log(pid=handle.process.pid, health_url=decl.service.health_url)

        with run.phase(PhaseParams(name="capture", kind="code", owner="service",
                                   description="Drive the declared flows mechanically and save identical evidence red or green")) as ph:
            capture = services.capture(run, decl)
            ph.log(flows=len(capture.flows), passed=capture.passed,
                   failures=len(capture.failures))

        with run.phase(PhaseParams(name="audit", kind="agent", owner="validator",
                                   description="Audit the instrument and the evidence — exit codes already decided whether the app behaved; this veto catches dishonest or degraded evidence")) as ph:
            verdict = ph.call(AgentCall(output_type=AuditOutput, prompt=prompt,
                                        previous=services.as_envelope(capture),
                                        gates=[gates.artifacts_exist,
                                               gates.validation_verdict_consistent]))

        with run.phase(PhaseParams(name="teardown", kind="code", owner="service",
                                   description="Stop the service children-first and verify its port actually freed")) as ph:
            torn_down = True
            ph.log(port_freed=services.stop(run, handle))
    finally:
        if handle is not None and not torn_down:
            services.stop(run, handle)   # crash and kill paths leave no orphan

    # Exit codes prove; the audit only vetoes. Green here means every flow's
    # falsifiable statement held against the running app AND the audit found
    # the evidence honest — never that an agent "felt" the app behaved.
    return run.finish(accepted=capture.passed and verdict is not None and verdict.passed,
                      reason=("a declared flow's assertion failed against the running app"
                              if not capture.passed
                              else "the audit vetoed: the evidence was dishonest or degraded"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    # Optional: bare `just validate` means "the declared journeys behave".
    parser.add_argument("prompt", nargs="?",
                        default="Every declared flow's journey completes and the captured evidence shows the app behaving.",
                        help="inline text or a path to a prompt file (optional)")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
