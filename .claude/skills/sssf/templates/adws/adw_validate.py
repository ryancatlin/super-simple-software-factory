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
from adw_modules.data_types import AgentCall, PhaseParams, ValidateOutput

REQUIRED_AGENTS = ["validator"]


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

        with run.phase(PhaseParams(name="validate", kind="agent", owner="validator",
                                   description="Rule on the captured evidence: does the running app do what was asked")) as ph:
            verdict = ph.call(AgentCall(output_type=ValidateOutput, prompt=prompt,
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

    return run.finish(accepted=verdict is not None and verdict.passed,
                      reason="the evidence did not support a pass")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
