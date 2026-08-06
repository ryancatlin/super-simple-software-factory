#!/usr/bin/env -S uv run
# /// script
# dependencies = ["pydantic", "python-dotenv", "pyyaml", "rich"]
# ///
"""ADW Simple SDLC — plan, build, test, review, document, committing as it goes.

Usage:
    uv run adws/adw_simple_sdlc.py "<prompt or path/to/prompt.md>" [--config adws/adw_sssf_config/sssf.config.yaml] [--adw-id a1b2c3d4]

Phases: engineer(request) -> planner -> git(commit_plan)
        -> builder -> code(test) [-> builder(fix) -> code(test) ... bounded]
        -> reviewer [-> builder(revise) -> reviewer ... bounded]
        -> code(retest, only if a revision changed code)
        -> [builder(extend, instrument-scoped) -> code(coverage)
            -> code(provision: build + start) -> code(capture: floor + probes)
            -> validator(audit) -> code(teardown),
            only when adws/adw_data/validation/ is enabled; a visible
            validate_skipped otherwise. Exit codes + mapping totality ARE the
            verdict; the audit is a veto on dishonest instruments.]
        -> git(commit_build) -> code(changes) -> documenter -> git(commit_docs)

Three commits, three work products, three authors. The plan, the code, and the
write-up each land in their own commit, and each commit message is the words of
the agent that produced it — `commit_message` on PlanOutput describes the spec,
on BuildOutput the code, on DocumentOutput the write-up. No agent's sentence is
ever reused for another agent's diff.

Testing is CODE, not an agent. `bun test` is a command, not a judgement call:
an agent rediscovering it every run costs a million tokens to learn what a
subprocess already knows. Failures travel back to the builder as an envelope,
so the repair loop is unchanged — only the runner became free and repeatable.

Three different questions get asked, in order. The suite asks "does it run";
the reviewer asks "is this what was asked for", against `plan.md`; validation
asks "does the running app behave" — and none can answer another's. A revision
that closes a review finding re-enters the suite, so the tree that gets
committed is the tree that was both tested and approved.

Validation gates the commit only when the project has declared it (enabled
adws/adw_data/validation/ — see cookbooks/setup_validation.md). Without a
declaration the chain stays useful and skips VISIBLY: a `validate_skipped`
phase in the trace, never a silent green. It is one-shot here — a red verdict
stops the commit and the working tree holds the attempt; `just build-validate`
is the fix-until-green shape, and it commits the tree once it is green.

The code commit lands after verification, not straight after the build: fixes
and revisions are part of the same work product, and red code has no business
on the branch. A run that fails verification therefore leaves the plan
committed and the working tree dirty — the spec is a real artifact either way,
and the unfinished code stays where the engineer can see it. `build-validate`
is how that attempt is finished and landed; this chain REFUSES to start on a
dirty tree, because its whole-tree commits would otherwise carry someone
else's work under an agent's message.

The plan commit is the exception: the planner is write-scoped to `specs/`, so
that commit names its pathspec and takes only what the planner wrote.

The documenter measures against the commit this SESSION started from, not
against `main`, because by then the run has moved `main` itself. That baseline
is pinned on the session's first invocation and reused by every re-invocation
of the same adw_id, so a session run in several rounds is documented whole.
The request phase prints it, and whether it was pinned or resumed.
"""

import argparse
import os
import sys

from adw_modules import (agents, changes, gates, git_helper, permissions,
                         quality, services, session, utils)
from adw_modules.data_types import (AgentCall, AuditOutput, BuildOutput,
                                    ChangeCapture, DocumentOutput, ExtendOutput,
                                    PhaseParams, PlanOutput, ReviewOutput)
from adw_validate import EXTEND_BRIEF, declaration_gap

REQUIRED_AGENTS = ["planner", "builder", "reviewer", "documenter"]
MAX_FIX_LOOPS = 3
MAX_REVISION_LOOPS = 2

# The extend phase writes the measuring instrument, so like the setup builder
# it is mechanically barred from the thing being measured: probes and the
# registry only, never the app (permissions.enforce rolls back anything else).
VALIDATION_WRITES = ["adws/adw_data/validation/"]

# The planner's only repo-visible output is the spec copy — plan.md itself
# lands in the gitignored session handoff, which every agent may write. Bounding
# it here is what makes commit_plan's pathspec authoritative.
PLAN_WRITES = ["specs/"]

DOCUMENT_NOTES = ("Read diff_path in full before writing. Document only what the "
                  "diff shows, then copy the write-up into app_docs/ as your task "
                  "describes.")


def dirty_tree_refusal() -> str:
    """The refusal to print when the tree is not this run's to commit, else "".

    Two of this chain's three commits stage the whole tree, so a path that was
    already dirty lands in whichever fires first, under another agent's message
    — observed live: a spec commit that swallowed the previous attempt's
    application code. Never stash: an engineer's uncommitted work is not the
    factory's to move somewhere they cannot see it.
    """
    if not (git_helper.is_repo() and git_helper.is_dirty()):
        return ""
    paths = git_helper.changed_files()
    listed = "\n".join(f"  - {p}" for p in paths[:5])
    extra = f"\n  - ... and {len(paths) - 5} more" if len(paths) > 5 else ""
    return (f"refusing to start: {len(paths)} uncommitted path(s) in the working "
            f"tree\n{listed}{extra}\n\n"
            "This chain commits the whole tree, so that work would land inside "
            "one of its commits, described by an agent that never wrote it. "
            "Finish or clear it first:\n"
            '  just build-validate "<what is still missing>"   # finishes an '
            "unfinished attempt and commits it on green\n"
            "  git commit / git restore                       # land or drop it "
            "yourself\n"
            "Do not stash — a stashed attempt is invisible to the next run.")


def main(prompt: str, config: str = "adws/adw_sssf_config/sssf.config.yaml", adw_id: str | None = None) -> int:
    refusal = dirty_tree_refusal()
    if refusal:
        print(refusal, file=sys.stderr)      # before any session exists to record
        return 2
    cfg = agents.load_config(config)
    # Judged as the BUILDER because the builder is who would have to write it:
    # a request naming machinery it may never touch is lost before it starts.
    refusal = permissions.barred_request_refusal(
        prompt, agents.resolve(cfg, "builder"), cfg)
    if refusal:
        print(refusal, file=sys.stderr)      # before any session exists to record
        return 2
    # The declaration this run starts under decides whether validation gates
    # the commit — and whether the roster must hold a validator. Pinned here:
    # a mid-run edit to the declaration never changes what this run enforces.
    decl = services.load_declaration()
    validation_on = decl is not None and decl.enabled
    agents.validate(cfg, REQUIRED_AGENTS + (["validator"] if validation_on else []))
    run = session.ensure(cfg, adw_id)
    # This chain IS the gated door: every commit it makes sits behind
    # verification by construction, so the pre-commit guard hook (installed by
    # setup-validation) lets its git phases through. Chains without the gate,
    # and hand commits, are blocked by that hook once validation is enabled.
    os.environ["SSSF_VALIDATED_CHAIN"] = run.adw_id
    # Pinned before this run commits anything, and stored against the SESSION:
    # a re-invoked adw_id reuses the first invocation's baseline, so the
    # documenter still sees the whole session's work rather than the last round.
    baseline, pinned = session.baseline(run, git_helper.rev("HEAD"))

    def commit(ph, envelope, paths: list[str] | None = None) -> None:
        """Commit what the preceding phase produced, in that agent's own words.

        `paths` scopes the commit to a write-restricted phase's own surface.
        permissions.enforce has already proven the agent touched nothing else,
        which makes the pathspec the authoritative file list — anything else
        dirty is not this phase's to sweep in. Unscoped, the whole tree is the
        work product.
        """
        message = envelope.commit_message or f"sssf({run.adw_id}): {envelope.summary}"
        sha = (git_helper.commit_paths(message, paths) if paths
               else git_helper.commit_all(message))
        ph.log(sha=sha, message=message)

    def record(ph, result) -> None:
        """Log a deterministic block's verdict — the same shape every ADW uses."""
        passed = sum(1 for check in result.checks if check.passed)
        ph.log(passed=result.passed, checks=f"{passed}/{len(result.checks)}",
               artifacts=", ".join(result.artifacts))

    with run.phase(PhaseParams(name="request", kind="engineer", owner=run.engineer,
                               description="Capture the incoming ask")) as ph:
        ph.log(input=prompt,
               baseline=f"{git_helper.short_sha(baseline)} "
                        f"{'pinned' if pinned else 'resumed'}")

    with run.phase(PhaseParams(name="plan", kind="agent", owner="planner",
                               description="Turn the request into an implementable plan")) as ph:
        plan = ph.call(AgentCall(output_type=PlanOutput, prompt=prompt,
                                 writes=PLAN_WRITES,
                                 gates=[gates.artifacts_exist, gates.files_non_empty,
                                        gates.criteria_present]))

    with run.phase(PhaseParams(name="commit_plan", kind="code", owner="git",
                               description="Put the spec on record before any code exists to blur it")) as ph:
        commit(ph, plan, PLAN_WRITES)

    with run.phase(PhaseParams(name="build", kind="agent", owner="builder",
                               description="Implement the plan exactly")) as ph:
        build = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt, previous=plan,
                                  gates=[gates.diff_matches_claims]))

    test = None
    for i in range(1, MAX_FIX_LOOPS + 1):
        with run.phase(PhaseParams(name=f"test_{i}", kind="code", owner="quality",
                                   description="Run the suite — a known command, so code runs "
                                               "it and no agent has to rediscover it")) as ph:
            test = quality.run_tests(run)
            record(ph, test)

        if test.passed:
            break

        with run.phase(PhaseParams(name=f"fix_{i}", kind="agent", owner="builder", retries=1,
                                   description="Repair what the suite reported, from its "
                                               "verbatim output")) as ph:
            build = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt,
                                      previous=quality.as_envelope(test, "tests"),
                                      gates=[gates.diff_matches_claims]))

    review = None
    revised = False
    for i in range(1, MAX_REVISION_LOOPS + 1):
        with run.phase(PhaseParams(name=f"review_{i}", kind="agent", owner="reviewer",
                                   description="Confirm the build matches the plan")) as ph:
            review = ph.call(AgentCall(output_type=ReviewOutput, prompt=prompt, previous=build,
                                       gates=[gates.artifacts_exist, gates.verdict_consistent]))

        if review.approved or i == MAX_REVISION_LOOPS:
            break

        with run.phase(PhaseParams(name=f"revise_{i}", kind="agent", owner="builder", retries=1,
                                   description="Close the reviewer's blocking findings")) as ph:
            build = ph.call(AgentCall(output_type=BuildOutput, prompt=prompt, previous=review,
                                      gates=[gates.diff_matches_claims]))
            revised = True

    # A revision edited code after the suite last ran, so the green light is
    # stale. Re-run it rather than commit on a result that predates the change.
    if revised and review is not None and review.approved:
        with run.phase(PhaseParams(name="retest", kind="code", owner="quality",
                                   description="Re-run the suite — the revision changed code "
                                               "after the last green result")) as ph:
            test = quality.run_tests(run)
            record(ph, test)

    # Red tests or a rejected review stop the chain here: the code stays
    # uncommitted and nothing is documented, because there is nothing worth
    # describing yet. The plan commit stands — it is a record of what was asked.
    verified = (test is not None and test.passed
                and review is not None and review.approved)

    # The third question — does the RUNNING app behave — asked only when the
    # project declared validation. One shot: a red stops the commit and the
    # tree holds the attempt (build-validate is the fix loop). A project
    # without a declaration skips VISIBLY and continues; a declaration that is
    # enabled but cannot run is a broken promise and fails.
    #
    # The verdict is COMPUTED, not opined: every acceptance criterion must map
    # to a declared flow or probe (extend authors any that are missing, write-
    # scoped to the instrument), code checks the mapping for totality before a
    # server boots, executes the floor plus the cited probes, and green means
    # every exit code was 0. The audit only vetoes — it checks the instrument
    # and the evidence for honesty, and adds nothing to a proof it likes.
    validated = not validation_on
    validation_reason = ""
    if verified and validation_on:
        gap = declaration_gap(decl)
        if gap:
            with run.phase(PhaseParams(name="validate_skipped", kind="code", owner="service",
                                       description="Record that declared validation could not run — an enabled declaration that cannot execute must fail, not pass")) as ph:
                ph.log(status="skipped", reason=gap,
                       next_step="see cookbooks/setup_validation.md")
            validation_reason = f"declared validation could not run: {gap}"
        else:
            criteria = plan.acceptance_criteria
            with run.phase(PhaseParams(name="extend", kind="agent", owner="builder",
                                       description="Map every acceptance criterion to a flow or probe, authoring new probes where nothing covers the change — write-scoped to the instrument, never the app")) as ph:
                extend = ph.call(AgentCall(
                    output_type=ExtendOutput,
                    prompt=(EXTEND_BRIEF + "Acceptance criteria to cover:\n"
                            + "\n".join(f"- {c}" for c in criteria)
                            + "\n\nThe original request follows.\n\n" + prompt),
                    previous=build, writes=VALIDATION_WRITES,
                    gates=[gates.diff_matches_claims]))

            # extend may have added probes, so the registry is re-read; whether
            # validation gates AT ALL stays pinned to the declaration this run
            # started under.
            live_decl = services.load_declaration()
            with run.phase(PhaseParams(name="coverage", kind="code", owner="service",
                                       description="Check the criterion->probe mapping for totality — a hole fails here, before a server ever boots")) as ph:
                cov_gaps = services.coverage_gaps(criteria, extend.mapping, live_decl)
                probes = services.select_probes(live_decl, extend.mapping)
                ph.log(criteria=len(criteria), probes_cited=len(probes),
                       new_probes=len(extend.new_probes), gaps="; ".join(cov_gaps) or "none")

            if cov_gaps:
                validation_reason = ("coverage gap — the requested change has no live "
                                     "evidence mapped: " + " | ".join(cov_gaps))
            else:
                handle = None
                torn_down = False
                verdict = None
                try:
                    with run.phase(PhaseParams(name="provision", kind="code", owner="service",
                                               description="Build the shippable artifact and start it, waiting for health with a hard deadline")) as ph:
                        handle = services.start(run, live_decl.service)
                        ph.log(pid=handle.process.pid, health_url=live_decl.service.health_url)

                    with run.phase(PhaseParams(name="capture", kind="code", owner="service",
                                               description="Execute the floor plus every cited probe mechanically — the exit codes are the verdict")) as ph:
                        capture = services.capture(run, live_decl, probes=probes)
                        ph.log(flows=len(capture.flows), passed=capture.passed,
                               failures=len(capture.failures))

                    with run.phase(PhaseParams(name="audit", kind="agent", owner="validator",
                                               description="Audit the instrument and the evidence — a veto on dishonest probes or degraded captures, never the proof itself")) as ph:
                        verdict = ph.call(AgentCall(
                            output_type=AuditOutput,
                            prompt=(prompt + "\n\nAcceptance criteria and claimed coverage:\n"
                                    + "\n".join(f"- {m.criterion} -> {', '.join(m.covered_by)}"
                                                for m in extend.mapping)),
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
                validated = capture.passed and verdict is not None and verdict.passed
                if not validated:
                    validation_reason = ("a flow or probe's assertion failed against the "
                                         "running app" if not capture.passed
                                         else "the audit vetoed the instrument or evidence")
    elif verified:
        # No declaration (or disabled): the chain stays useful, but the skip is
        # on the record — a run that did not validate must never read as if it did.
        with run.phase(PhaseParams(name="validate_skipped", kind="code", owner="service",
                                   description="Record that this project has no enabled validation declaration")) as ph:
            ph.log(status="skipped",
                   reason="no enabled declaration" if decl is None or not decl.enabled else "",
                   next_step="just setup-validation")

    if verified and validated:
        with run.phase(PhaseParams(name="commit_build", kind="code", owner="git",
                                   description="Land the code only now: green suite, approved review"
                                               + (", validated app" if validation_on else ""))) as ph:
            commit(ph, build)

        with run.phase(PhaseParams(name="changes", kind="code", owner="git",
                                   description="Diff the whole run against its pinned baseline, for the documenter")) as ph:
            changeset = changes.capture(run, ChangeCapture(base=baseline))
            ph.log(base=f"{changeset.base.label} @ {changeset.base.commit[:7]}",
                   reason=changeset.base.reason,
                   files=len(changeset.files) + len(changeset.untracked),
                   lines=f"+{changeset.insertions} -{changeset.deletions}",
                   diff=changeset.diff_path)
            if changeset.empty:
                raise RuntimeError(
                    f"nothing changed since {changeset.base.label} "
                    f"({changeset.base.reason}) — there is nothing to document.")

        with run.phase(PhaseParams(name="document", kind="agent", owner="documenter", retries=1,
                                   description="Write up the completed change")) as ph:
            document = ph.call(AgentCall(output_type=DocumentOutput, prompt=prompt,
                                         previous=changes.as_envelope(changeset, DOCUMENT_NOTES),
                                         gates=[gates.artifacts_exist, gates.files_non_empty]))

        with run.phase(PhaseParams(name="commit_docs", kind="code", owner="git",
                                   description="Ship the write-up in its own commit, beside the code it describes")) as ph:
            commit(ph, document)

    return run.finish(accepted=verified and validated,
                      reason=("the suite or the review never came back clean" if not verified
                              else (validation_reason or "declared validation did not come back green")
                              + " — the code was not committed; the working tree holds the "
                                "attempt, and `just build-validate` finishes and lands it"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="inline text or a path to a prompt file")
    parser.add_argument("--config", default="adws/adw_sssf_config/sssf.config.yaml")
    parser.add_argument("--adw-id", default=None, help="join or pin an existing session")
    args = parser.parse_args()
    sys.exit(main(utils.resolve_prompt(args.prompt), args.config, args.adw_id))
