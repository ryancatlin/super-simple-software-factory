/**
 * Pure derivations behind the instrument panel — DESIGN_SPEC §8.5.
 *
 * Everything here is a straight port of the computed properties in the former
 * Vue phase detail: same filters, same sort keys, same defensive parsing. The
 * components below stay presentational so the parity contract lives in one
 * readable file.
 */

import { parseToolCall } from '@/lib/events'
import { ts } from '@/lib/format'
import type { AgentEndPayload, Envelope, EventRow, GateCheck, GateResult } from '@/lib/types'

/** en-US grouping — the token columns read as accounting, not as code. */
export const NUM = new Intl.NumberFormat('en-US')

export interface UsageRow {
  label: string
  tokens: number
  cost: number
  /** Total gets a rule above it; reasoning is indented under output. */
  kind?: 'total' | 'nested'
  title?: string
}

/**
 * Verbatim from the Vue phase detail. Thinking is a share of output, not a fifth
 * component — the wording is what stops the column being read as a sum error.
 */
export const THINKING_TITLE =
  'Thinking tokens — part of output above, billed at the output rate. Not added to the total.'

/** Per-component costs run to fractions of a cent; four places keeps them real. */
export function money(n: number): string {
  if (!n) return '$0'
  return n < 0.0001 ? '<$0.0001' : `$${n.toFixed(4)}`
}

export function fmtSize(n: number): string {
  return n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`
}

export function phaseEventsOf(events: EventRow[], phaseId: string): EventRow[] {
  return events.filter((e) => e.phase_id === phaseId).toSorted((a, b) => a.rowid - b.rowid)
}

export function phaseGatesOf(gates: GateResult[], phaseId: string): GateResult[] {
  return gates
    .filter((g) => g.phase_id === phaseId)
    .toSorted((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0) || a.id - b.id)
}

export function phaseOutputsOf(envelopes: Envelope[], phaseId: string): Envelope[] {
  return envelopes
    .filter((e) => e.phase_id === phaseId)
    .toSorted((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0))
}

/**
 * The engineer's incoming ask, logged by every ADW's request phase as a `log`
 * event with an `input` payload — surfaced as its own section.
 */
export function requestTextOf(events: EventRow[]): string | null {
  for (const e of events) {
    if (e.type !== 'log' || !e.payload_json) continue
    try {
      const p: unknown = JSON.parse(e.payload_json)
      if (p && typeof p === 'object' && 'input' in p) {
        const input = (p as { input?: unknown }).input
        if (typeof input === 'string' && input.trim()) return input
      }
    } catch {
      /* not JSON — skip */
    }
  }
  return null
}

/**
 * What this phase's agent run spent, off its `agent_end` event.
 *
 * Null for a run still in flight (no agent_end yet). Older runs recorded only a
 * lump `cost`, so the breakdown is optional and rows are built from whatever
 * was written.
 */
export function usageOf(events: EventRow[]): { rows: UsageRow[]; partial: boolean } | null {
  const end = events.find((e) => e.type === 'agent_end')
  if (!end) return null
  let payload: AgentEndPayload = {}
  try {
    payload = JSON.parse(end.payload_json ?? '{}') as AgentEndPayload
  } catch {
    // A malformed payload is a missing panel, never a broken detail view.
  }
  const u = payload.usage
  if (!u) {
    // Pre-breakdown run: the event's own token count and the lump cost still hold.
    return {
      partial: true,
      rows: [{ label: 'total', tokens: end.tokens ?? 0, cost: payload.cost ?? 0, kind: 'total' }],
    }
  }
  const rows: UsageRow[] = [
    { label: 'input', tokens: u.input_tokens, cost: u.input_cost },
    { label: 'output', tokens: u.output_tokens, cost: u.output_cost },
  ]
  if (u.reasoning_tokens) {
    // Thinking bills at the output rate, so its share of the output cost is
    // exact arithmetic — but it is already INSIDE the output row above.
    const share = u.output_tokens ? (u.output_cost * u.reasoning_tokens) / u.output_tokens : 0
    rows.push({
      label: 'thinking',
      tokens: u.reasoning_tokens,
      cost: share,
      kind: 'nested',
      title: THINKING_TITLE,
    })
  }
  rows.push(
    { label: 'cache read', tokens: u.cache_read_tokens, cost: u.cache_read_cost },
    { label: 'cache write', tokens: u.cache_write_tokens, cost: u.cache_write_cost },
    { label: 'total', tokens: u.total_tokens, cost: u.total_cost, kind: 'total' },
  )
  return { rows, partial: false }
}

export function violationsOf(g: GateResult): string[] {
  try {
    const v: unknown = JSON.parse(g.violations_json ?? '[]')
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  } catch {
    /* keep raw below */
  }
  return g.violations_json ? [g.violations_json] : []
}

/**
 * New-tracer gate rows carry per-item evidence in checks_json. null means no
 * evidence was recorded (legacy row → plain non-expandable line); "[]" means
 * the gate ran and inspected nothing — a real, different answer.
 */
export function gateChecksOf(g: GateResult): GateCheck[] | null {
  const raw = g.checks_json
  if (raw == null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
      .map((c) => ({
        item: typeof c.item === 'string' ? c.item : '',
        ok: c.ok === true,
        note: typeof c.note === 'string' ? c.note : '',
      }))
  } catch {
    return null
  }
}

/** Collapsed-row count label: mixed gates surface how many items failed. */
export function checksLabel(checks: GateCheck[]): string {
  const failed = checks.filter((c) => !c.ok).length
  return failed > 0 ? `${failed} of ${checks.length} failed` : String(checks.length)
}

export function eventDurationMs(e: EventRow): number {
  const a = ts(e.started_at)
  const b = ts(e.ended_at)
  if (Number.isFinite(a) && Number.isFinite(b)) return b - a
  // tool_call rows on older tracers have no ended_at — the payload's
  // duration_ms (when the coding agent reported one) is the source of truth.
  if (e.type === 'tool_call') {
    const call = parseToolCall(e)
    if (call?.duration_ms != null) return call.duration_ms
  }
  return Number.NaN
}

/**
 * The evidence dirs THIS phase's flows wrote, by basename (e.g. "02_vision").
 * Capture phases record each flow as a `flow:*` tool_call whose payload names
 * its evidence_dir. Sorted, so the array's join() is a stable effect key.
 */
export function flowDirsOf(events: EventRow[]): string[] {
  const dirs = new Set<string>()
  for (const e of events) {
    if (e.type !== 'tool_call' || !e.name?.startsWith('flow:') || !e.payload_json) continue
    try {
      const p = JSON.parse(e.payload_json) as { evidence_dir?: unknown }
      if (typeof p.evidence_dir === 'string' && p.evidence_dir) {
        dirs.add(p.evidence_dir.replace(/\/+$/, '').split('/').pop() ?? '')
      }
    } catch {
      /* not JSON — skip */
    }
  }
  dirs.delete('')
  return [...dirs].toSorted()
}
