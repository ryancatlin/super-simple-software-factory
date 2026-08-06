/**
 * Swim-lane construction — DESIGN_SPEC §5.3.2, parity with the former Vue
 * session-trace `lanes` / `ownerStart` / `laneContext` computeds.
 *
 * Lane order is doctrine: engineer first, then the code lane when code phases
 * exist, then one lane per distinct agent owner in the order phases first
 * mention them.
 */
import { parseAgentStart } from '@/lib/events'
import { ts } from '@/lib/format'
import type { AgentSession, AgentStartPayload, EventRow, Phase, PhaseKind, Session } from '@/lib/types'
import { CODE_COLOR, ENGINEER_COLOR, laneColor } from '@/theme/palette'

export interface LaneContext {
  used: number
  window: number
  /** 0–100, uncapped by the floor applied to the bar's width. */
  pct: number
}

export interface Lane {
  /** 'engineer' | 'code' | `agent:${owner}` */
  id: string
  label: string
  kind: PhaseKind
  /** Hex, from theme/palette. */
  color: string
  model: string | null
  context: LaneContext | null
  metaLines: string[]
  /** Phases with a real start — the ones that get a block on the axis. */
  phases: Phase[]
  /** Declared but never entered — they live in the queue gutter. */
  queued: Phase[]
}

/**
 * Occupancy for an agent lane. Null unless BOTH numbers are real — a bar
 * against an unknown ceiling would be decoration, not data.
 */
function laneContext(info: AgentSession | undefined): LaneContext | null {
  const used = info?.context_tokens ?? 0
  const window = info?.context_window ?? 0
  if (!used || !window) return null
  return { used, window, pct: Math.min(100, (used / window) * 100) }
}

/**
 * A live agent's model/color arrive on its agent_start event before any
 * agent_sessions row exists; attribute each start to its phase's owner.
 */
function ownerStarts(phases: Phase[], events: EventRow[]): Record<string, AgentStartPayload> {
  const ownerByPhase = new Map<string, string | null>(phases.map((p) => [p.phase_id, p.owner]))
  const meta: Record<string, AgentStartPayload> = {}
  for (const e of events) {
    if (e.type !== 'agent_start') continue
    const owner = (e.phase_id ? ownerByPhase.get(e.phase_id) : null) ?? e.name
    if (!owner || meta[owner]) continue
    const payload = parseAgentStart(e)
    if (payload) meta[owner] = payload
  }
  return meta
}

function timed(phases: Phase[]): Phase[] {
  return phases.filter((p) => Number.isFinite(ts(p.started_at)))
}

function queued(phases: Phase[]): Phase[] {
  return phases.filter((p) => !Number.isFinite(ts(p.started_at)))
}

export function buildLanes(
  session: Session | null,
  phases: Phase[],
  agents: AgentSession[],
  events: EventRow[],
): Lane[] {
  const starts = ownerStarts(phases, events)

  const agentOwners: string[] = []
  for (const p of phases) {
    if (p.kind === 'agent' && p.owner && !agentOwners.includes(p.owner)) agentOwners.push(p.owner)
  }

  const enginePhases = phases.filter((p) => p.kind === 'engineer')
  const codePhases = phases.filter((p) => p.kind === 'code')

  const out: Lane[] = [
    {
      id: 'engineer',
      label: session?.engineer ?? 'engineer',
      kind: 'engineer',
      color: ENGINEER_COLOR,
      model: null,
      context: null,
      metaLines: ['engineer'],
      phases: timed(enginePhases),
      queued: queued(enginePhases),
    },
  ]

  if (codePhases.length > 0) {
    out.push({
      id: 'code',
      label: 'code',
      kind: 'code',
      color: CODE_COLOR,
      model: null,
      context: null,
      metaLines: ['workspace'],
      phases: timed(codePhases),
      queued: queued(codePhases),
    })
  }

  for (const [i, owner] of agentOwners.entries()) {
    const info = agents.find((a) => a.agent === owner)
    const start = starts[owner]
    const mine = phases.filter((p) => p.kind === 'agent' && p.owner === owner)
    out.push({
      id: `agent:${owner}`,
      label: owner,
      kind: 'agent',
      color: laneColor(info?.color, start?.color, i),
      // The model is the lane's whole story; thinking level lives in the
      // phase detail's agent config section.
      model: info?.model ?? start?.model ?? null,
      context: laneContext(info),
      metaLines: [],
      phases: timed(mine),
      queued: queued(mine),
    })
  }

  return out
}

/** Sub-1% occupancy is common and real; round it away and the bar reads empty. */
export function contextLabel(ctx: LaneContext): string {
  return ctx.pct < 1 ? `${ctx.pct.toFixed(1)}%` : `${Math.round(ctx.pct)}%`
}

/** Keep a non-zero fill visible — the exact numbers ride in the label and title. */
export function contextFill(ctx: LaneContext): string {
  return `${Math.max(ctx.pct, 2)}%`
}
