<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, Check, Copy } from 'lucide-vue-next'

// The command catalogue mirrors the stamped justfile — one entry per recipe,
// grouped the way the justfile groups them. When a recipe is added there, add
// it here: the justfile is the source of truth, this page is its shop window.

interface Command {
  cmd: string
  what: string
  example?: string
  note?: string
}

interface Group {
  title: string
  blurb: string
  accent: string
  commands: Command[]
}

const GROUPS: Group[] = [
  {
    title: 'First run',
    blurb: 'Prove the whole path works — config, session, agent, envelope, gates, trace. Read-only, costs a few cents.',
    accent: 'var(--green)',
    commands: [
      { cmd: 'just demo', what: 'Two cheap read-only runs end to end: one prompt, one recon.' },
    ],
  },
  {
    title: 'Run a workflow',
    blurb: 'Args pass straight through: an inline prompt or a path/to/prompt.md, plus --adw-id to join a session.',
    accent: 'var(--purple)',
    commands: [
      { cmd: 'just prompt', what: 'One agent, one prompt.', example: 'just prompt "summarize this repo"' },
      { cmd: 'just scout', what: 'Read-only recon; changes nothing.', example: 'just scout "where is auth handled"' },
      { cmd: 'just plan', what: 'Plan only — a spec the builder could implement without questions.', example: 'just plan "add a /health endpoint"' },
      { cmd: 'just plan-build', what: 'Planner, then builder, then commit.', example: 'just plan-build "add a /health endpoint"' },
      { cmd: 'just sdlc', what: 'Plan, build, test, commit.', example: 'just sdlc "add a /health endpoint"' },
      { cmd: 'just simple-sdlc', what: 'The full chain: review, docs, and — when a validation declaration is enabled — the running app must validate green before the code commits.', example: 'just simple-sdlc "add a /health endpoint"' },
    ],
  },
  {
    title: 'Validate the running app',
    blurb: 'Code provisions the dev server, drives declared flows, and tears down; the validator agent only rules on captured evidence. Needs adws/adw_data/validation/ enabled — until then runs report skipped-and-red, never green.',
    accent: 'var(--cyan)',
    commands: [
      { cmd: 'just setup-validation', what: 'The factory builds this project’s validation itself — scout, declare, prove green, commit. The setup builder is mechanically limited to the declaration.', example: 'just setup-validation "the journeys that matter are ..."' },
      { cmd: 'just validate', what: 'Provision, capture evidence, rule on it, teardown. Green only when the evidence supports it.', example: 'just validate "the home page renders"' },
      { cmd: 'just build-validate', what: 'Build a change, then prove the running app still behaves — bounded fix loop on red.', example: 'just build-validate "dedupe the double lookup; journeys stay green"' },
      { cmd: 'just bless', what: 'Accept a run’s screenshots as the visual baselines for future drift diffs.', example: 'just bless <adw_id>' },
      { cmd: 'just evidence', what: 'Open a run’s validation evidence on disk: screenshots, diffs, OCR sidecars.', example: 'just evidence <adw_id>' },
      { cmd: 'just flows', what: 'The flow catalogue — every journey and shared lib step in the library.' },
    ],
  },
  {
    title: 'Watch it',
    blurb: 'Reads never block a running workflow — the trace db is WAL. This UI polls the same tables.',
    accent: 'var(--blue)',
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
    accent: 'var(--violet)',
    commands: [{ cmd: 'just update', what: 'Hands-free, non-breaking refresh of the factory machinery.' }],
  },
]

const copied = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = null), 1400)
  } catch {
    // Clipboard unavailable (permissions, http) — the text is still selectable.
  }
}
</script>

<template>
  <div class="docs">
    <header class="docs-head">
      <BookOpen :size="22" class="docs-icon" />
      <div>
        <h1>Commands</h1>
        <p class="docs-sub">
          Every recipe the stamped <span class="mono">justfile</span> ships, runnable from the repo
          root. <span class="mono">SSSF_CONFIG=other.yaml</span> before any of them swaps the whole
          roster for one run. Click a command to copy it.
        </p>
      </div>
    </header>

    <section v-for="g in GROUPS" :key="g.title" class="group" :style="{ '--accent': g.accent }">
      <h2>{{ g.title }}</h2>
      <p class="blurb">{{ g.blurb }}</p>
      <div class="cmds">
        <div v-for="c in g.commands" :key="c.cmd" class="cmd">
          <button
            class="cmd-copy"
            :title="`copy: ${c.example ?? c.cmd}`"
            @click="copy(c.example ?? c.cmd)"
          >
            <code>{{ c.cmd }}</code>
            <component :is="copied === (c.example ?? c.cmd) ? Check : Copy" :size="15" class="copy-icon" />
          </button>
          <div class="cmd-body">
            <p class="what">{{ c.what }}</p>
            <code v-if="c.example" class="example">{{ c.example }}</code>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.docs {
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 28px 80px;
}

.docs-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 10px;
}

.docs-icon {
  color: var(--amber);
  margin-top: 6px;
  flex: none;
}

.docs-head h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.02em;
}

.docs-sub {
  margin: 4px 0 0;
  color: var(--dim);
  max-width: 72ch;
}

.mono {
  font-family: var(--mono);
  font-size: 0.92em;
  color: var(--cyan);
}

.group {
  margin-top: 30px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 18px 20px 8px;
  position: relative;
  overflow: hidden;
}

/* One accent hairline per group — the lane colors, reused as wayfinding. */
.group::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent);
  opacity: 0.75;
}

.group h2 {
  margin: 0;
  font-size: 19px;
  letter-spacing: 0.02em;
}

.blurb {
  margin: 6px 0 14px;
  color: var(--faint);
  font-size: 16px;
  max-width: 80ch;
}

.cmds {
  display: flex;
  flex-direction: column;
}

.cmd {
  display: flex;
  gap: 18px;
  align-items: flex-start;
  padding: 11px 0;
  border-top: 1px solid var(--border-soft);
}

.cmd-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  width: 240px;
  padding: 7px 12px;
  background: var(--panel-3);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 16px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.cmd-copy:hover {
  border-color: var(--accent);
  background: var(--panel-2);
}

.cmd-copy code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-icon {
  margin-left: auto;
  color: var(--faint);
  flex: none;
}

.cmd-copy:hover .copy-icon {
  color: var(--accent);
}

.cmd-body {
  min-width: 0;
  padding-top: 5px;
}

.what {
  margin: 0;
  color: var(--dim);
  font-size: 16px;
}

.example {
  display: inline-block;
  margin-top: 5px;
  font-family: var(--mono);
  font-size: 15px;
  color: var(--faint);
  background: var(--panel-3);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 2px 8px;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .cmd {
    flex-direction: column;
    gap: 8px;
  }

  .cmd-copy {
    width: 100%;
  }
}
</style>
