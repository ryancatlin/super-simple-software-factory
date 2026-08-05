# Set Up Validation — the factory builds it, then proves it

Turn the stamped, disabled validation declaration into this project's own
working validation stage. The factory does this itself: one ADW scouts the
project, writes the declaration, proves it green, and only then commits it.

**The split, before anything else:** the machinery (`adw_modules/services.py`)
is protected — nobody edits it. What gets set up is the DECLARATION under
`adws/adw_data/validation/` — service command, health URL, capture flows. It
is user-owned and agent-writable on purpose. Agent proposes the declaration,
code executes it.

**Walk-away rules the machinery already enforces** (nothing to add): every
step has a hard deadline; the server pid is registered in the trace's
`processes` table before the health wait; teardown runs in a `finally` and
verifies the port freed — crash, kill, and red runs all included.

## The one command

```bash
uv run adws/adw_setup_validation.py "set up validation; the journeys that matter most are <...>"
```

(or `just setup-validation "..."`). Launch it, then wait in code —
`just wait <adw_id>` — never poll the trace.

The chain: scout finds the dev command, health URL, and load-bearing journeys
→ builder writes `validation.yaml` (with `enabled: true`) and one flow per
journey → code provisions, lints the flow library, captures, tears down → the
validator rules on the evidence → red findings loop back to the builder,
bounded → **commit happens only after a green run has proven the declaration**.
A run that never goes green commits nothing and leaves the last attempt in the
working tree with the reason on the banner.

Put anything the scout cannot discover into the prompt: a seed script, login
credentials, a prerequisite (database, docker compose service) that must be
running, a non-default port.

## The flow library, and how it stays neat

Flows accumulate into this project's ready-to-go journey library. Neatness is
mechanical — `services.lint_flows` runs before any capture and FAILS it on:

- an undeclared `*.sh` under `flows/` (orphans never run; declare or delete),
- a declared script that does not exist, or a name declared twice,
- a flow whose opening lines lack `# Flow: <name> — <scenario it evidences>`.

So: `validation.yaml` is the ONLY registry, one journey per flow, and
`grep '^# Flow:' adws/adw_data/validation/flows/*.sh` is the catalogue.

The library maintains itself from here: `adw_build_validate`'s builder brief
requires every change that touches a user-visible journey to add or update its
flow, and the same run executes it immediately — proven at birth, red when it
rots. A flow for a removed feature goes red on the next run and gets updated
or deleted; staleness cannot accumulate silently.

## Manual path (small edit, no agents)

Edit `adws/adw_data/validation/validation.yaml` yourself — service `command`
(argv list, bare binary names), `health_url`, a `startup_timeout_seconds` a
cold boot fits inside — write your flows per the rules above, set
`enabled: true`, then prove it: `just validate "<a real scenario>"`. Commit
only on green.

## Reading a red run, in order

1. **provision failed** — wrong command, or the timeout is shorter than a cold
   boot. The phase error carries the server's own log tail.
2. **capture failed with `flow library:` failures** — the lint: orphan,
   missing script, or missing header. Fix the library, not the app.
3. **a flow failed** — read `flow.log` in that flow's evidence dir under the
   session's `context_handoff/validation/`.
4. **the validator failed it** — read its `validation_report.md`; the evidence
   exists but does not show the scenario.

## Sharp edges

- **Port collision:** if the health URL's port is already serving something,
  provision "succeeds" against the WRONG app. A prior run's teardown said
  `port_freed=False` if it left one behind — `just procs <adw_id>`, then
  `just kill <adw_id>`, then rerun.
- **Prerequisites are not the service.** `service.command` is only "serve" —
  a database or compose stack must already be up; the scout reports these,
  it does not start them.
- **agent-browser is optional in the stamped flow** — `home.sh` degrades to
  curl-only evidence and says so. If validation NEEDS visual evidence, make a
  missing browser exit non-zero instead of quietly thinning the evidence.
- **The validator rules on evidence only.** If it keeps failing scenarios for
  lack of evidence, the fix is a better flow, never a more lenient prompt.
