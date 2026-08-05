#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Setup Validation — the factory builds this project's validation itself.

Usage:
    uv run adws/adw_setup_validation.py "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> scout -> builder(declare) -> [code(provision) -> code(capture) -> validator -> code(teardown) -> builder(revise) ... bounded] -> code(commit)

The scout finds how the app starts and which journeys matter. The builder
writes the declaration — validation.yaml plus flows — which is legal because
adws/adw_data/validation/ is user-owned and agent-writable; the machinery that
executes it (adw_modules/services.py) stays protected. Then the run's own
acceptance is the validation it just wrote going green: provision, capture,
rule, teardown. The declaration is only committed once it has been PROVEN —
agent proposes the config, code disposes by executing it.

The prompt is the engineer's steer: which journeys matter most, anything the
scout should know (a seed script, a login, a port). "set up validation" alone
is enough for a first pass.
"""

import argparse
import sys

from adw_modules import agents, gates, git_helper, services, session, utils
from adw_modules.data_types import (AgentCall, BuildOutput, GenericOutput,
                                    PhaseParams, ScoutOutput, ValidateOutput)
from adw_validate import declaration_gap

REQUIRED_AGENTS = ["scout", "builder", "validator"]
MAX_SETUP_LOOPS = 3

# The setup builder writes the measuring instrument, so it must not be able to
# edit the thing being measured: mechanically narrowed to the declaration for
# declare/revise (permissions.enforce rolls back and aborts on any src/ write),
# and the commit stages exactly this bound — the enforcement is what makes the
# pathspec an authoritative file list (see git_helper.commit_paths).
VALIDATION_WRITES = ["adws/adw_data/validation/"]

SCOUT_BRIEF = """Recon this project's local dev story for validation setup. Report:
1. The exact command that serves the app for local development (argv, bare binary names), and any prerequisite that must already be running (database, docker compose service) — name it, do not start it.
2. The port and a URL that answers only once the app is genuinely up, and roughly how long a cold start takes.
3. The 2-4 user-visible routes or journeys most worth mechanical evidence (fetch, click, screenshot), most load-bearing first.
Change nothing. Engineer's steer, if any, follows.

"""

DECLARE_BRIEF = """Using the scout's findings in the previous envelope, set up this project's validation declaration. Your write access is MECHANICALLY limited to adws/adw_data/validation/ — any change outside it is rolled back and fails the phase. If the app's CURRENT behaviour looks wrong (a bug your probe uncovers), do not fix the app and do not encode the wish: probe reality so the capture is honest, and name the suspected product bug in notes_for_next_agent — the engineer routes it to a `just build-validate` run, where fixing the app is the builder's actual job.

1. Edit adws/adw_data/validation/validation.yaml: the real service command (argv list, never a shell string, bare binary names), a health_url that answers only when genuinely up, a startup_timeout_seconds a cold start fits inside, and set `enabled: true` — this run will prove it before anything is committed.
2. Write one flow per journey worth evidence in adws/adw_data/validation/flows/, replacing or extending the stamped home.sh. Every flow: declared in validation.yaml (undeclared scripts never run and fail the library lint); opening lines carry `# Flow: <name> — <scenario it evidences>`; one journey per flow; MECHANICAL capture only, run with $BASE_URL and $EVIDENCE_DIR set and cwd = $EVIDENCE_DIR; save evidence there; exit non-zero on any checkable failure. agent-browser is the primary instrument (open, snapshot -i, get text @ref, screenshot — screenshots save to cwd); curl is the degrade path. Code enriches every screenshot afterwards (OCR sidecar, blank check, baseline drift), so capture, don't analyse. Judgement belongs to the validator, not the flow. Steps several flows share (a login, a seeded record) go in flows/lib/ with a `# Step: <name> — <what it does>` header and are `source`d by flows, never declared as flows themselves.
3. Do NOT start the server or run the flows yourself — this run provisions, captures, and tears down in code immediately after you report.

Engineer's steer, if any, follows.

"""


def main(prompt: str, config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    cfg = agents.load_config(config)
    agents.validate(cfg, REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)

    with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer,
                               description="Capture the engineer's steer for the validation setup")) as ph:
        ph.log(input=prompt)

    with run.phase(PhaseParams(name="recon", kind="agent", owner="scout",
                               description="Find how the app starts, when it is healthy, and which journeys earn evidence")) as ph:
        recon = ph.call(AgentCall(output_type=ScoutOutput, prompt=SCOUT_BRIEF + prompt,
                                  gates=[gates.artifacts_exist]))

    with run.phase(PhaseParams(name="declare", kind="agent", owner="builder",
                               description="Write the validation declaration this run must then prove")) as ph:
        build = ph.call(AgentCall(output_type=BuildOutput, prompt=DECLARE_BRIEF + prompt,
                                  previous=recon, writes=VALIDATION_WRITES,
                                  gates=[gates.diff_matches_claims]))

    verdict = None
    for i in range(1, MAX_SETUP_LOOPS + 1):
        decl = services.load_declaration()
        gap = declaration_gap(decl)
        if gap:
            # The declaration cannot even run — that is a finding for the
            # builder, through the same door a validator's fail would use.
            verdict = None
            feedback = GenericOutput(status="fail",
                                     summary=f"declaration unusable: {gap}",
                                     notes_for_next_agent=f"Fix the declaration: {gap}")
        else:
            handle = None
            torn_down = False
            verdict = None
            try:
                with run.phase(PhaseParams(name=f"provision_{i}", kind="code", owner="service",
                                           description="Start the declared service and wait for health, with a hard deadline")) as ph:
                    handle = services.start(run, decl.service)
                    ph.log(pid=handle.process.pid, health_url=decl.service.health_url)

                with run.phase(PhaseParams(name=f"capture_{i}", kind="code", owner="service",
                                           description="Lint the flow library, then drive every declared flow and save the evidence")) as ph:
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
            except RuntimeError as exc:
                # Provision or capture failed fast (health deadline, dead
                # flow runner). That is a finding for the builder — it owns
                # health_url, the timeout, and the service env — through the
                # same door a validator's fail would use. If the cause is a
                # prerequisite only the engineer can start (a stopped
                # database), the loop exhausts with this reason instead of a
                # traceback.
                feedback = GenericOutput(status="fail",
                                         summary=f"provision/capture failed: {exc}",
                                         notes_for_next_agent=f"The declaration could not be executed: {exc}")
            else:
                if verdict is not None and verdict.passed:
                    break
                feedback = verdict
            finally:
                if handle is not None and not torn_down:
                    services.stop(run, handle)   # crash and kill paths leave no orphan

        if i == MAX_SETUP_LOOPS:
            break

        with run.phase(PhaseParams(name=f"revise_{i}", kind="agent", owner="builder", retries=1,
                                   description="Fix the declaration so the validation it describes can go green")) as ph:
            build = ph.call(AgentCall(output_type=BuildOutput, prompt=DECLARE_BRIEF + prompt,
                                      previous=feedback, writes=VALIDATION_WRITES,
                                      gates=[gates.diff_matches_claims]))

    proven = verdict is not None and verdict.passed
    if proven:
        with run.phase(PhaseParams(name="commit", kind="code", owner="git",
                                   description="Commit the declaration only now that a green run has proven it")) as ph:
            message = build.commit_message or f"sssf({run.adw_id}): enable app validation"
            # Only the declaration — the enforced write bound makes this
            # pathspec exact, and anything else dirty is the operator's.
            ph.log(sha=git_helper.commit_paths(message, VALIDATION_WRITES),
                   message=message)

    return run.finish(accepted=proven,
                      reason=f"the validation never went green after {MAX_SETUP_LOOPS} attempt(s); "
                             f"nothing was committed — the working tree holds the last attempt")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    # Optional on purpose: a bare `just setup-validation` is the natural first
    # command, and the scout discovers what the engineer did not say.
    parser.add_argument("prompt", nargs="?",
                        default="Set up validation for this project's most load-bearing user journeys.",
                        help="inline text or a path to a prompt file (optional)")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
