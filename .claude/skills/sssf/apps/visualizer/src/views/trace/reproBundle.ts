/**
 * The repro bundle — DESIGN_SPEC §6.4.
 *
 * One markdown document that carries a phase's whole story out of the trace and
 * into a fresh Claude session: what happened, what ran, what the gates said,
 * what blew up, and the exact prompt the agent was handed. It is assembled from
 * recorded trace data only — nothing here is inferred beyond the opening
 * paragraph, which is composed from the same fields the sections below print.
 *
 * The module is pure and framework-free so both callers can share it: the
 * triage panel (views/trace) and the phase header (views/phase). That second
 * import is the sanctioned cross-view edge for this feature — see §6.4.
 */

import { eventLabel } from '@/lib/events'
import { fmtDuration, payloadOk, prettyJson, ts } from '@/lib/format'
import type { Envelope, EventRow, GateResult, Phase, Session } from '@/lib/types'
import { modelName } from '@/lib/models'
import {
  NUM,
  eventDurationMs,
  gateChecksOf,
  phaseEventsOf,
  phaseGatesOf,
  phaseOutputsOf,
  violationsOf,
} from '@/views/phase/phaseData'

/**
 * Per-section ceiling. A single failing test can carry a megabyte of stdout in
 * its gate note, and a bundle that blows the clipboard (or the context window
 * it was assembled for) helps nobody. Every fenced section is capped here and
 * says so in place, so the reader knows material was removed rather than never
 * recorded.
 */
export const SECTION_LIMIT = 15_000

/** How many of the phase's own events ride along as context for the failure. */
const EVENT_TAIL = 40

/** Excerpt ceiling for the agent's final report, in the panel and the summary. */
export const EXCERPT_LIMIT = 480

// ── event taxonomy ───────────────────────────────────────────────────────────

/**
 * The error-class members of `EventType` (shared/types.ts). `error` is a raised
 * exception; `gate_fail` is a verdict the machinery reached. Nothing else in
 * the taxonomy means "went wrong".
 */
export const ERROR_EVENT_TYPES: ReadonlySet<string> = new Set(['error', 'gate_fail'])

export function isErrorEvent(e: EventRow): boolean {
  return e.type != null && ERROR_EVENT_TYPES.has(e.type)
}

/**
 * A tool the coding agent reported as failed. The tracer types it `tool_call`,
 * so it is not error-class — but it is the same evidence, and a run that died
 * on a bad bash call has its root cause here and nowhere else.
 */
export function isFailedToolCall(e: EventRow): boolean {
  return e.type === 'tool_call' && !payloadOk(e.payload_json)
}

/** Everything that counts as evidence of failure, in trace order. */
export function failureEventsOf(events: EventRow[]): EventRow[] {
  return events.filter((e) => isErrorEvent(e) || isFailedToolCall(e))
}

// ── gates ────────────────────────────────────────────────────────────────────

/**
 * The newest attempt of every (phase, gate) pair.
 *
 * A gate that failed on attempt 1 and passed on attempt 2 was retried and
 * resolved; carrying the stale failure forward would stamp a red plate across
 * a run that is green, which is the one thing triage must never do.
 */
export function latestGates(gates: GateResult[]): GateResult[] {
  const best = new Map<string, GateResult>()
  for (const g of gates) {
    const key = `${g.phase_id ?? ''}::${g.gate ?? ''}`
    const prev = best.get(key)
    const newer =
      !prev ||
      (g.attempt ?? 0) > (prev.attempt ?? 0) ||
      ((g.attempt ?? 0) === (prev.attempt ?? 0) && g.id > prev.id)
    if (newer) best.set(key, g)
  }
  return [...best.values()].toSorted((a, b) => a.id - b.id)
}

/** Gates that are still failing after every retry they were given. */
export function failedGates(gates: GateResult[]): GateResult[] {
  return latestGates(gates).filter((g) => !g.passed)
}

// ── the agent's own words ────────────────────────────────────────────────────

/**
 * Field names an output envelope may carry its prose under, in the order a
 * reader would want them. The tracer stores whatever the phase's data_types
 * model declared, so this is a preference list, not a schema.
 */
const REPORT_KEYS = [
  'summary',
  'report',
  'message',
  'reason',
  'notes',
  'details',
  'error',
  'output',
] as const

function trimTo(text: string, limit: number): string {
  const flat = text.trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()}…`
}

/** An excerpt, and whether it is the agent's prose or a fallback data dump. */
export interface ReportExcerpt {
  text: string
  /** True when the agent wrote this sentence; false when it is serialised data. */
  prose: boolean
}

/**
 * A short excerpt of an agent's final report. Prose fields win over the raw
 * envelope, because "tests failed on the auth module" is a better first line
 * than a pretty-printed object the reader has to parse themselves. The `prose`
 * flag exists so the reader is not shown a paragraph in a monospace well —
 * mono is for ids, code and data, never for the UI's voice.
 */
export function reportExcerpt(
  envelope: Envelope | undefined,
  limit: number = EXCERPT_LIMIT,
): ReportExcerpt | null {
  const raw = envelope?.payload_json
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { text: trimTo(raw, limit), prose: false }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>
    for (const key of REPORT_KEYS) {
      const v = rec[key]
      if (typeof v === 'string' && v.trim()) return { text: trimTo(v, limit), prose: true }
    }
  }
  return { text: trimTo(prettyJson(raw), limit), prose: false }
}

/**
 * The last report this phase produced, excerpted.
 *
 * Exported so the triage panel never has to reach into `views/phase` itself —
 * this module is the single edge between the two view directories.
 */
export function phaseReportExcerpt(
  envelopes: Envelope[],
  phaseId: string,
  limit: number = EXCERPT_LIMIT,
): ReportExcerpt | null {
  return reportExcerpt(phaseOutputsOf(envelopes, phaseId).at(-1), limit)
}

/** This phase's failure evidence, in trace order. */
export function phaseFailureEvents(events: EventRow[], phaseId: string): EventRow[] {
  return failureEventsOf(phaseEventsOf(events, phaseId))
}

// ── markdown assembly ────────────────────────────────────────────────────────

function clamp(text: string): string {
  if (text.length <= SECTION_LIMIT) return text
  return `${text.slice(0, SECTION_LIMIT)}\n[truncated ${text.length - SECTION_LIMIT} chars]`
}

/**
 * A fence long enough to survive its own content. Compiled prompts are markdown
 * and routinely contain ``` blocks; a three-backtick fence around one of those
 * splits the section in half when it is pasted back.
 */
function fence(body: string, lang = ''): string {
  let longest = 0
  for (const run of body.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  const bar = '`'.repeat(Math.max(3, longest + 1))
  return `${bar}${lang}\n${clamp(body)}\n${bar}`
}

function fact(label: string, value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  return `- **${label}** ${value}`
}

function facts(rows: (string | null)[]): string {
  return rows.filter((r): r is string => r != null).join('\n')
}

/** Phase wall-clock. A running phase has no duration yet — it has an age, and
 *  an age would change under the reader on every poll. */
function phaseDurationMs(phase: Phase): number {
  const start = ts(phase.started_at)
  const end = ts(phase.ended_at)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN
  return end - start
}

function stamp(iso: string | null | undefined): string {
  return iso ?? '—'
}

function eventLine(e: EventRow): string {
  const type = (e.type ?? 'event').padEnd(12)
  const d = eventDurationMs(e)
  const dur = Number.isFinite(d) ? ` · ${fmtDuration(d)}` : ''
  const bad = isFailedToolCall(e) ? ' · TOOL ERROR' : ''
  return `${stamp(e.started_at)}  ${type} ${eventLabel(e)}${dur}${bad}`
}

function gateBlock(g: GateResult): string {
  const lines: string[] = [
    `${g.passed ? '✓' : '✗'} ${g.gate ?? 'gate'} · attempt ${g.attempt ?? 0} · ${stamp(g.created_at)}`,
  ]
  for (const check of gateChecksOf(g) ?? []) {
    if (check.ok && !g.passed) continue // a failing gate's story is its failures
    lines.push(`    ${check.ok ? '✓' : '✗'} ${check.item}`)
    for (const noteLine of check.note.split('\n')) {
      if (noteLine.trim()) lines.push(`        ${noteLine}`)
    }
  }
  for (const v of violationsOf(g)) lines.push(`    violation: ${v}`)
  return lines.join('\n')
}

// ── the bundle ───────────────────────────────────────────────────────────────

/** One compiled prompt panel. Structurally what `usePrompts` already produces. */
export interface ReproPrompt {
  title: string
  text: string
}

export interface ReproBundleInput {
  /** The run this phase belongs to. Null before the first poll lands. */
  session: Session | null
  phase: Phase
  /** All of the session's events; the builder filters to the phase. */
  events: EventRow[]
  /** All of the session's envelopes. */
  envelopes: Envelope[]
  /** All of the session's gate results. */
  gates: GateResult[]
  /** The phase agent's compiled prompts. Empty for non-agent phases. */
  prompts: readonly ReproPrompt[]
  /** Resolved model id for the phase's agent, when one is known. */
  model: string | null
}

const STATUS_VERB: Record<string, string> = {
  fail: 'failed',
  success: 'completed',
  running: 'is still running',
  queued: 'never started',
}

/**
 * The opening paragraph. Composed, not templated onto one shape: a phase that
 * failed with no gates and no error events must still read as a sentence, and
 * a green phase copied from its header must not read as an incident report.
 */
function whatHappened(
  input: ReproBundleInput,
  gates: GateResult[],
  errors: EventRow[],
  durationMs: number,
): string {
  const { phase, session, model } = input
  const name = phase.name ?? phase.phase_id
  const who = phase.owner
    ? model
      ? ` (agent \`${phase.owner}\`, model \`${modelName(model)}\`)`
      : ` (agent \`${phase.owner}\`)`
    : ''
  const workflow = session?.adw_name ? ` of workflow \`${session.adw_name}\`` : ''
  const verb = STATUS_VERB[phase.status ?? ''] ?? `ended \`${phase.status ?? 'unknown'}\``
  const took = Number.isFinite(durationMs) ? ` after ${fmtDuration(durationMs)}` : ''
  const attempt = phase.attempt ? ` on attempt ${phase.attempt} of ${phase.retries ?? phase.attempt}` : ''

  const out: string[] = [
    `Phase \`${name}\`${who} in run \`${phase.adw_id}\`${workflow} ${verb}${took}${attempt}.`,
  ]

  if (phase.error) {
    const firstLine = phase.error.split('\n').find((l) => l.trim()) ?? phase.error
    out.push(`It recorded the error "${trimTo(firstLine, 240)}".`)
  }

  const bad = failedGates(gates)
  if (bad.length > 0) {
    const names = bad.map((g) => `\`${g.gate ?? 'gate'}\``).join(', ')
    const plural = bad.length === 1 ? 'is' : 'are'
    out.push(
      `${bad.length} of ${latestGates(gates).length} gates ${plural} still failing after every retry: ${names}.`,
    )
  } else if (gates.length > 0) {
    out.push(`All ${latestGates(gates).length} gates passed on their latest attempt.`)
  }

  if (errors.length > 0) {
    const types = [...new Set(errors.map((e) => (isFailedToolCall(e) ? 'failed tool_call' : (e.type ?? 'error'))))]
    out.push(`${errors.length} failure events were logged (${types.join(', ')}).`)
  } else {
    out.push('No error events were logged against the phase.')
  }

  if (session?.status === 'fail' && phase.status !== 'fail') {
    out.push('The run as a whole is marked `fail`, so the cause may lie in another phase.')
  }

  if (session?.request) {
    // Requests run to several paragraphs. This is one paragraph by contract, so
    // the ask is flattened here and printed in full under `## Run`.
    out.push(`The engineer's request was: "${trimTo(session.request.replaceAll(/\s+/g, ' '), 300)}".`)
  }

  return out.join(' ')
}

/**
 * Assemble the markdown document. Order is deliberate: the reader (human or
 * model) gets the story, then the identifying facts, then the evidence, and
 * only then the two large blobs — the report and the compiled prompt — which
 * would otherwise push everything else below the fold.
 */
export function buildReproBundle(input: ReproBundleInput): string {
  const { phase, session, model } = input
  const events = phaseEventsOf(input.events, phase.phase_id)
  const gates = phaseGatesOf(input.gates, phase.phase_id)
  const outputs = phaseOutputsOf(input.envelopes, phase.phase_id)
  const errors = failureEventsOf(events)
  const durationMs = phaseDurationMs(phase)

  const parts: string[] = [
    `# SSSF repro bundle — ${phase.name ?? phase.phase_id}`,
    `## What happened\n\n${whatHappened(input, gates, errors, durationMs)}`,
    `## Run\n\n${facts([
      fact('session', `\`${phase.adw_id}\``),
      fact('workflow', session?.adw_name ? `\`${session.adw_name}\`` : '`—`'),
      fact('status', `\`${session?.status ?? 'unknown'}\``),
      fact('started', stamp(session?.started_at)),
      fact('ended', stamp(session?.ended_at)),
      fact(
        'spend',
        `${session?.total_cost == null ? '—' : `$${session.total_cost.toFixed(4)}`} · ${
          session?.total_tokens == null ? '—' : NUM.format(session.total_tokens)
        } tokens`,
      ),
    ])}${
      // The ask is routinely several paragraphs; as a list item it would break
      // the list it sits in, so it gets its own block.
      session?.request ? `\n\n**Request**\n\n${fence(session.request, 'text')}` : ''
    }`,
    `## Phase\n\n${facts([
      fact('name', `\`${phase.name ?? '—'}\``),
      fact('phase id', `\`${phase.phase_id}\``),
      fact('kind', `\`${phase.kind ?? '—'}\``),
      fact('agent', phase.owner ? `\`${phase.owner}\`` : '`—`'),
      fact('model', model ? `\`${model}\`` : '`—`'),
      fact('status', `\`${phase.status ?? '—'}\``),
      fact('attempt', `${phase.attempt ?? 0} of ${phase.retries ?? 0}`),
      fact('started', stamp(phase.started_at)),
      fact('ended', stamp(phase.ended_at)),
      fact('duration', Number.isFinite(durationMs) ? fmtDuration(durationMs) : '—'),
      // Flattened: a list item that contains a newline stops being a list item.
      fact('description', phase.description?.replaceAll(/\s+/g, ' ') ?? '—'),
    ])}`,
  ]

  if (phase.error) {
    parts.push(`## Phase error\n\n${fence(phase.error, 'text')}`)
  }

  if (gates.length > 0) {
    parts.push(
      `## Gates\n\n${fence(latestGates(gates).map((g) => gateBlock(g)).join('\n\n'), 'text')}`,
    )
  }

  if (errors.length > 0) {
    parts.push(`## Failure events\n\n${fence(errors.map((e) => eventLine(e)).join('\n'), 'text')}`)
  }

  if (events.length > 0) {
    const tail = events.slice(-EVENT_TAIL)
    const head =
      tail.length < events.length
        ? `[${events.length - tail.length} earlier events omitted]\n`
        : ''
    parts.push(
      `## Event tail (last ${tail.length} of ${events.length})\n\n${fence(
        head + tail.map((e) => eventLine(e)).join('\n'),
        'text',
      )}`,
    )
  }

  for (const [i, envelope] of outputs.entries()) {
    const label = `${envelope.output_type ?? 'output'} · attempt ${envelope.attempt ?? 0} · ${
      envelope.valid ? 'valid' : 'invalid'
    }`
    parts.push(
      `## Phase report ${i + 1} — ${label}\n\n${fence(prettyJson(envelope.payload_json), 'json')}`,
    )
  }

  for (const prompt of input.prompts) {
    parts.push(`## Compiled ${prompt.title}\n\n${fence(prompt.text, 'text')}`)
  }

  parts.push(
    `---\n\nAssembled by the SSSF visualizer from \`sssf.db\`. ` +
      `Sections over ${SECTION_LIMIT.toLocaleString('en-US')} characters are truncated in place.`,
  )

  return `${parts.join('\n\n')}\n`
}
