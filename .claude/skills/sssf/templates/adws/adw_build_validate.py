#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Build Validate — implement, then prove the running app behaves.

Usage:
    uv run adws/adw_build_validate.py "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> builder
        -> [builder(extend, instrument-scoped) -> code(coverage)
            -> code(provision: build + start) -> code(capture: floor + probes)
            -> validator(audit) -> code(teardown) -> builder(revise) ... bounded]
        -> git(commit_build), on green

Each cycle: the extend phase maps the change's acceptance criteria to flows
and probes (authoring any that are missing, write-scoped to the declaration),
code checks the mapping for totality, executes the floor plus the cited
probes against the shippable build, and computes the verdict from exit codes;
the audit only vetoes. On red the findings go back to the builder and the
whole cycle runs again — fresh server, fresh evidence — a bounded number of
times. Each iteration tears its server down before the builder edits, so
nothing is left serving stale code, and teardown also sits in a `finally` so
crash and kill paths leave no orphan either.

This is also the chain that FINISHES an attempt someone else left in the tree.
simple-sdlc leaves a rejected round uncommitted and refuses to start on a dirty
tree, so on green this chain commits — the whole tree, because the whole
validated tree is the work product here and the loop may well be finishing work
it did not write. A green run that landed nothing would leave that work stranded
behind the pre-commit guard, which is what makes re-running simple-sdlc on a
dirty tree look tempting.

Requires the project's validation declaration to be enabled — see
cookbooks/setup_validation.md. Until then the run reports skipped-and-red.
"""

import argparse
import os
import sys

from adw_modules import (agents, gates, git_helper, permissions, services,
                         session, utils)
from adw_modules.data_types import (AgentCall, AuditOutput, BuildOutput,
                                    ExtendOutput, GenericOutput, PhaseParams)
from adw_validate import EXTEND_BRIEF, declaration_gap

REQUIRED_AGENTS = ["builder", "validator"]
MAX_VALIDATION_LOOPS = 2

# The instrument-maker split: the builder builds the APP; a separate extend
# call — the same agent, write-scoped in code to the declaration — decides how
# the change is proven and authors any missing probes. One hand does the work,
# a different (mechanically bounded) hand builds the measure of it.
VALIDATION_WRITES = ["adws/adw_data/validation/"]

BUILD_BRIEF = """

This chain proves the RUNNING app afterwards — code provisions the shippable
build, executes the flow library, and computes the verdict from exit codes:
- Do NOT start the service, install browsers, or run validation flows
  yourself; everything mechanical runs the moment you report.
- Do NOT edit adws/adw_data/validation/ — a separate instrument-scoped phase
  owns the probes and the registry.
- If your change intentionally alters how a page LOOKS, the old visual
  baseline is now stale: say so in notes_for_next_agent so the engineer can
  re-bless (adw_bless.py) after the run goes green."""

# Unlike simple-sdlc there is no plan here, so the extend phase also STATES the
# acceptance criteria it maps — the audit then checks both against the request.
BV_CRITERIA_NOTE = ("No plan precedes you: derive the acceptance criteria from the "
                    "request yourself — user-observable, falsifiable — and map every "
                    "one. An empty mapping fails the coverage check.\n\n")


def main(prompt: str, config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    cfg = agents.load_config(config)
    # Judged as the BUILDER because the builder is who would have to write it:
    # a request naming machinery it may never touch is lost before it starts.
    refusal = permissions.barred_request_refusal(
        prompt, agents.resolve(cfg, "builder"), cfg)
    if refusal:
        print(refusal, file=sys.stderr)      # before any session exists to record
        return 2
    agents.validate(cfg, REQUIRED_AGENTS)
    run = session.ensure(cfg, adw_id)
    # A validated chain — its one commit runs only after a green verdict, so
    # the pre-commit guard hook lets that git phase through.
    os.environ["SSSF_VALIDATED_CHAIN"] = run.adw_id

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
        build = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt + BUILD_BRIEF,
                                  gates=[gates.diff_matches_claims]))

    passed = False
    previous = build
    for i in range(1, MAX_VALIDATION_LOOPS + 1):
        with run.phase(PhaseParams(name=f"extend_{i}", kind="agent", owner="builder",
                                   description="Map the change's acceptance criteria to flows and probes, authoring any that are missing — write-scoped to the instrument, never the app")) as ph:
            extend = ph.call(AgentCall(output_type=ExtendOutput,
                                       prompt=EXTEND_BRIEF + BV_CRITERIA_NOTE + prompt,
                                       previous=previous, writes=VALIDATION_WRITES,
                                       gates=[gates.diff_matches_claims]))

        live_decl = services.load_declaration()
        criteria = [m.criterion for m in extend.mapping]
        with run.phase(PhaseParams(name=f"coverage_{i}", kind="code", owner="service",
                                   description="Check the criterion->probe mapping for totality — a hole fails here, before a server ever boots")) as ph:
            cov_gaps = (services.coverage_gaps(criteria, extend.mapping, live_decl)
                        if extend.mapping else
                        ["empty mapping — state the criteria this change must "
                         "demonstrate and the flows/probes that cover them"])
            probes = services.select_probes(live_decl, extend.mapping)
            ph.log(criteria=len(criteria), probes_cited=len(probes),
                   new_probes=len(extend.new_probes), gaps="; ".join(cov_gaps) or "none")

        if cov_gaps:
            feedback = GenericOutput(status="fail",
                                     summary=f"coverage gaps: {len(cov_gaps)}",
                                     notes_for_next_agent="The proof obligation is not total: "
                                                          + " | ".join(cov_gaps))
        else:
            handle = None
            torn_down = False
            verdict = None
            try:
                with run.phase(PhaseParams(name=f"provision_{i}", kind="code", owner="service",
                                           description="Build the shippable artifact and start it, waiting for health with a hard deadline")) as ph:
                    handle = services.start(run, live_decl.service)
                    ph.log(pid=handle.process.pid, health_url=live_decl.service.health_url)

                with run.phase(PhaseParams(name=f"capture_{i}", kind="code", owner="service",
                                           description="Execute the floor plus every cited probe mechanically — the exit codes are the verdict")) as ph:
                    capture = services.capture(run, live_decl, probes=probes)
                    ph.log(flows=len(capture.flows), passed=capture.passed,
                           failures=len(capture.failures))

                with run.phase(PhaseParams(name=f"audit_{i}", kind="agent", owner="validator",
                                           description="Audit the instrument and the evidence — a veto on dishonest probes or degraded captures, never the proof itself")) as ph:
                    verdict = ph.call(AgentCall(
                        output_type=AuditOutput,
                        prompt=(prompt + "\n\nAcceptance criteria and claimed coverage:\n"
                                + "\n".join(f"- {m.criterion} -> {', '.join(m.covered_by)}"
                                            for m in extend.mapping)),
                        previous=services.as_envelope(capture),
                        gates=[gates.artifacts_exist,
                               gates.validation_verdict_consistent]))

                with run.phase(PhaseParams(name=f"teardown_{i}", kind="code", owner="service",
                                           description="Stop the service children-first and verify its port actually freed")) as ph:
                    torn_down = True
                    ph.log(port_freed=services.stop(run, handle))
            except RuntimeError as exc:
                # Provision or capture failed fast. The declaration was proven
                # when it was set up, so the likely cause is the change under
                # validation breaking the build, startup, or the health
                # endpoint — a finding for the builder through the same door.
                feedback = GenericOutput(status="fail",
                                         summary=f"provision/capture failed: {exc}",
                                         notes_for_next_agent="Validation could not even run — the proven "
                                                              f"declaration failed to execute: {exc}. If your change "
                                                              "broke the build, startup, the port, or the health "
                                                              "endpoint, fix that.")
            else:
                passed = capture.passed and verdict is not None and verdict.passed
                if passed:
                    break
                feedback = (verdict if capture.passed
                            else services.as_envelope(capture))
            finally:
                if handle is not None and not torn_down:
                    services.stop(run, handle)   # crash and kill paths leave no orphan

        if i == MAX_VALIDATION_LOOPS:
            break

        with run.phase(PhaseParams(name=f"revise_{i}", kind="agent", owner="builder", retries=1,
                                   description="Close every finding the exit codes or the audit named")) as ph:
            previous = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt + BUILD_BRIEF,
                                         previous=feedback,
                                         gates=[gates.diff_matches_claims]))

    if passed:
        with run.phase(PhaseParams(name="commit_build", kind="code", owner="git",
                                   description="Land the validated tree — the loop that finishes an attempt must also land it, or the guard strands the work")) as ph:
            message = (previous.commit_message
                       or f"sssf({run.adw_id}): {previous.summary}")
            if git_helper.is_dirty():
                ph.log(sha=git_helper.commit_all(message), message=message)
            else:
                # Green on a clean tree: the work is already committed, or the
                # builder changed nothing. Neither is a failure — but a commit
                # phase that quietly did nothing must still say so.
                ph.log(sha=git_helper.short_sha("HEAD"),
                       message="nothing to commit — the tree was already clean")

    return run.finish(accepted=passed,
                      reason=f"the app never proved its criteria after {MAX_VALIDATION_LOOPS} attempt(s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
