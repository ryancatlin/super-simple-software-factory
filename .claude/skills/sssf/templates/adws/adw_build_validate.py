#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Build Validate — implement, then prove the running app behaves.

Usage:
    uv run adws/adw_build_validate.py "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> builder -> [code(provision) -> code(capture) -> validator -> code(teardown) -> builder(revise) ... bounded]

The validation cycle is the one from adw_validate.py, run after a build and
looped: when the validator's ruling is a fail, the findings go back to the
builder as an envelope and the whole cycle runs again — fresh server, fresh
evidence — a bounded number of times. Each iteration tears its server down
before the builder edits, so nothing is left serving stale code, and teardown
also sits in a `finally` so crash and kill paths leave no orphan either.

Requires the project's validation declaration to be enabled — see
cookbooks/setup_validation.md. Until then the run reports skipped-and-red.
"""

import argparse
import sys

from adw_modules import agents, gates, services, session, utils
from adw_modules.data_types import (AgentCall, BuildOutput, PhaseParams,
                                    ValidateOutput)
from adw_validate import declaration_gap

REQUIRED_AGENTS = ["builder", "validator"]
MAX_VALIDATION_LOOPS = 2

# The call site defines how an agent is used: the builder's identity lives in
# its system.md, but THIS chain also makes it the flow library's maintainer.
# Every feature ships with the flow that evidences it, and the same run
# executes that flow immediately — proven at birth, red if it rots.
FLOW_BRIEF = """

Flow maintenance (this chain validates the RUNNING app afterwards):
- FIND before you write: validation.yaml is the flow registry;
  `grep '^# Flow:' adws/adw_data/validation/flows/*.sh` is the catalogue;
  `grep '^# Step:' adws/adw_data/validation/flows/lib/*.sh` lists shared steps.
  Extend an existing flow when the journey already has one — never duplicate it.
- REUSE shared steps: flows `source` lib scripts (e.g.
  `source "$(dirname "$0")/lib/login.sh"`). When a second flow needs a step an
  existing flow already performs (login, seeded record), extract it into
  flows/lib/ with a `# Step: <name> — <what it does>` header instead of
  copying it. Lib scripts are never declared as flows.
- If your change adds or alters a user-visible journey, add or update the flow
  that evidences it: a bash script in adws/adw_data/validation/flows/, declared
  in adws/adw_data/validation/validation.yaml. Undeclared scripts never run and
  fail the library lint.
- One journey per flow. Its opening lines must carry
  `# Flow: <name> — <scenario it evidences>`.
- Flows are MECHANICAL evidence capture, run with $BASE_URL and $EVIDENCE_DIR
  set, cwd = $EVIDENCE_DIR; save evidence there and exit non-zero on any
  checkable failure. agent-browser is the primary instrument (open, snapshot -i,
  get text @ref, screenshot); curl is the degrade path. Judgement belongs to
  the validator, not the flow — and code enriches every screenshot afterwards
  (OCR sidecar, blank check, baseline drift), so capture, don't analyse.
- If your change intentionally alters how a page LOOKS, the old visual
  baseline is now stale: say so in notes_for_next_agent so the engineer can
  re-bless (adw_bless.py) after the run goes green.
- This run executes your flows immediately — a flow that cannot run comes
  straight back to you as a failure."""


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

    with run.phase(PhaseParams(name="build", kind="agent", owner="builder",
                               description="Implement the request")) as ph:
        ph.call(AgentCall(output_type=BuildOutput, prompt=prompt + FLOW_BRIEF,
                          gates=[gates.diff_matches_claims]))

    verdict = None
    for i in range(1, MAX_VALIDATION_LOOPS + 1):
        handle = None
        torn_down = False
        try:
            with run.phase(PhaseParams(name=f"provision_{i}", kind="code", owner="service",
                                       description="Start the declared service and wait for health, with a hard deadline")) as ph:
                handle = services.start(run, decl.service)
                ph.log(pid=handle.process.pid, health_url=decl.service.health_url)

            with run.phase(PhaseParams(name=f"capture_{i}", kind="code", owner="service",
                                       description="Drive the declared flows mechanically and save identical evidence red or green")) as ph:
                capture = services.capture(run, decl)
                ph.log(flows=len(capture.flows), passed=capture.passed,
                       failures=len(capture.failures))

            with run.phase(PhaseParams(name=f"validate_{i}", kind="agent", owner="validator",
                                       description="Rule on the captured evidence: does the running app do what was asked")) as ph:
                verdict = ph.call(AgentCall(output_type=ValidateOutput, prompt=prompt,
                                            previous=services.as_envelope(capture),
                                            gates=[gates.artifacts_exist,
                                                   gates.validation_verdict_consistent]))

            with run.phase(PhaseParams(name=f"teardown_{i}", kind="code", owner="service",
                                       description="Stop the service children-first and verify its port actually freed")) as ph:
                torn_down = True
                ph.log(port_freed=services.stop(run, handle))
        finally:
            if handle is not None and not torn_down:
                services.stop(run, handle)   # crash and kill paths leave no orphan

        if verdict.passed or i == MAX_VALIDATION_LOOPS:
            break

        with run.phase(PhaseParams(name=f"revise_{i}", kind="agent", owner="builder", retries=1,
                                   description="Close every blocking finding the validator's evidence named")) as ph:
            ph.call(AgentCall(output_type=BuildOutput, prompt=prompt + FLOW_BRIEF,
                              previous=verdict,
                              gates=[gates.diff_matches_claims]))

    return run.finish(accepted=verdict is not None and verdict.passed,
                      reason=f"the validator never passed the app after {MAX_VALIDATION_LOOPS} attempt(s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
