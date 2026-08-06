// The command catalogue mirrors the stamped justfile — one entry per recipe,
// grouped the way the justfile groups them. When a recipe is added there, add
// it here: the justfile is the source of truth, this page is its shop window.

export interface Command {
  cmd: string
  what: string
  example?: string
  note?: string
}

export interface Group {
  title: string
  blurb: string
  accent: string
  commands: Command[]
}

export const GROUPS: Group[] = [
  {
    title: 'First run',
    blurb: 'Prove the whole path works — config, session, agent, envelope, gates, trace. Read-only, costs a few cents.',
    accent: 'var(--pass)',
    commands: [
      { cmd: 'just demo', what: 'Two cheap read-only runs end to end: one prompt, one recon.' },
    ],
  },
  {
    title: 'Run a workflow',
    blurb: 'Args pass straight through: an inline prompt or a path/to/prompt.md, plus --adw-id to join a session.',
    accent: 'var(--lane-orchid)',
    commands: [
      { cmd: 'just prompt', what: 'One agent, one prompt.', example: 'just prompt "summarize this repo"' },
      { cmd: 'just scout', what: 'Read-only recon; changes nothing.', example: 'just scout "where is auth handled"' },
      { cmd: 'just plan', what: 'Plan only — a spec the builder could implement without questions.', example: 'just plan "add a /health endpoint"' },
      { cmd: 'just plan-build', what: 'Planner, then builder, then commit.', example: 'just plan-build "add a /health endpoint"' },
      { cmd: 'just sdlc', what: 'Plan, build, test, commit.', example: 'just sdlc "add a /health endpoint"' },
      { cmd: 'just simple-sdlc', what: 'The full chain: review, docs, and — when validation is enabled — every acceptance criterion must map to a probe and prove itself by exit code against the shippable build before the code commits. Refuses to start on a dirty tree; finish that attempt with just build-validate first.', example: 'just simple-sdlc "add a /health endpoint"' },
    ],
  },
  {
    title: 'Validate the running app',
    blurb: 'Code builds the shippable artifact, serves it, executes the flow library, and computes the verdict from exit codes; the audit agent only vetoes dishonest instruments. The floor (flows/) always runs; probes (flows/probes/) run when a request cites them. Needs adws/adw_data/validation/ enabled — until then runs report skipped-and-red, never green.',
    accent: 'var(--lane-steel)',
    commands: [
      { cmd: 'just setup-validation', what: 'The factory builds this project’s validation itself — scout, declare, prove green, commit. The setup builder is mechanically limited to the declaration.', example: 'just setup-validation "the journeys that matter are ..."' },
      { cmd: 'just validate', what: 'Provision, capture evidence, rule on it, teardown. Green only when the evidence supports it.', example: 'just validate "the home page renders"' },
      { cmd: 'just build-validate', what: 'Build a change, then prove the running app still behaves — bounded fix loop on red, and the validated tree is committed on green. Also how an attempt another run left uncommitted gets finished and landed.', example: 'just build-validate "dedupe the double lookup; journeys stay green"' },
      { cmd: 'just bless', what: 'Accept a run’s screenshots as the visual baselines for future drift diffs.', example: 'just bless <adw_id>' },
      { cmd: 'just evidence', what: 'Open a run’s validation evidence on disk: screenshots, diffs, OCR sidecars.', example: 'just evidence <adw_id>' },
      { cmd: 'just flows', what: 'The catalogue — floor journeys, request probes, and shared lib steps.' },
      { cmd: 'just promote', what: 'A proven probe joins the always-on floor — deliberate, never automatic, so the floor stays curated.', example: 'just promote <probe_name>' },
      { cmd: 'just guard', what: 'Install the pre-commit guard: once validation is enabled, app code only ships through a validated chain (override: git commit --no-verify).' },
    ],
  },
  {
    title: 'Watch it',
    blurb: 'Reads never block a running workflow — the trace db is WAL. This UI polls the same tables.',
    accent: 'var(--lane-slate)',
    commands: [
      { cmd: 'just sessions', what: 'The last 10 runs: status, request, tokens, cost.' },
      { cmd: 'just phases', what: 'Phase status in sequence for one run.', example: 'just phases <adw_id>' },
      { cmd: 'just tail', what: 'The live event tail for one run.', example: 'just tail <adw_id>' },
      { cmd: 'just procs', what: 'What a run has alive right now, with pids.', example: 'just procs <adw_id>' },
      { cmd: 'just obs', what: 'Boot this trace UI (http://localhost:4601).' },
    ],
  },
  {
    title: 'Wait & intervene',
    blurb: 'Code polls the trace, agents never do — zero tokens while waiting.',
    accent: 'var(--amber)',
    commands: [
      { cmd: 'just wait', what: 'Block until a run finishes, then print its summary.', example: 'just wait <adw_id>' },
      { cmd: 'just kill', what: 'Stop a run — agent children first, then the workflow. A killed validation still tears down its own server.', example: 'just kill <adw_id>' },
    ],
  },
  {
    title: 'Update',
    blurb: 'Refreshes unmodified stamped files and adds new ones. Anything the project edited — config, prompts, harness, declarations, .env — is never overwritten.',
    accent: 'var(--lane-rust)',
    commands: [{ cmd: 'just update', what: 'Hands-free, non-breaking refresh of the factory machinery.' }],
  },
]
