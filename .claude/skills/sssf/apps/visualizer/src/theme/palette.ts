/**
 * Machine Shop colour adapter — DESIGN_SPEC.md §4.
 *
 * lib/events.ts is untouchable, but its EVENT_DOT_COLORS and
 * AGENT_FALLBACK_COLORS are the old neon palette. This module is a thin
 * additive wrapper: same precedence rules, same "only mapped types get a dot"
 * contract, machine-shop hues. Every view imports colours from here — never
 * from events.ts directly.
 */

/** Machine-shop lane fallbacks, in assignment order. Hex, so hexAlpha() accepts them. */
export const LANE_FALLBACK: readonly string[] = [
  '#b094e2', // orchid
  '#7ec180', // oxide
  '#77b9e8', // slate
  '#e47c75', // rust
  '#48bfbf', // steel
  '#f3a52b', // amber
]

/** Fixed lane colour for the engineer lane — --lane-amber. */
export const ENGINEER_COLOR = '#f3a52b'

/** Fixed lane colour for the code lane — --lane-steel. */
export const CODE_COLOR = '#48bfbf'

/**
 * Lane colour with the original precedence: config colour → agent_start payload
 * colour → machine-shop fallback by index. Mirrors events.agentColor() but with
 * this palette's fallbacks.
 */
export function laneColor(
  configColor: string | null | undefined,
  payloadColor: string | null | undefined,
  index: number,
): string {
  return (
    configColor ??
    payloadColor ??
    LANE_FALLBACK[index % LANE_FALLBACK.length] ??
    LANE_FALLBACK[0] ??
    ENGINEER_COLOR
  )
}

// Only these six types earn a dot. Everything else is deliberately unmapped —
// dropping the rule would turn the trace strips into noise.
const EVENT_DOT: Record<string, string> = {
  agent_start: '#b094e2', // orchid
  agent_end: '#7ec180', // oxide
  tool_call: '#48bfbf', // steel
  handoff: '#77b9e8', // slate
  error: '#da6057', // fail
  gate_fail: '#da6057', // fail
}

/**
 * Event-type dot colour, machine-shop remap. Returns null for untyped/unmapped
 * events — exactly like events.dotColor(), so the "only mapped types get dots"
 * rule survives.
 */
export function eventDotColor(type: string | null): string | null {
  if (!type) return null
  return EVENT_DOT[type] ?? null
}

const EVENT_TYPE_VAR: Record<string, string> = {
  gate_fail: 'var(--fail)',
  error: 'var(--fail)',
  gate_pass: 'var(--pass)',
  agent_end: 'var(--pass)',
  tool_call: 'var(--lane-steel)',
  handoff: 'var(--lane-slate)',
  agent_start: 'var(--lane-orchid)',
}

/**
 * CSS colour for an event type's label in the phase-detail event list.
 * Replaces the Vue `typeClass` map.
 */
export function eventTypeVar(type: string | null): string {
  if (!type) return 'var(--text-dim)'
  return EVENT_TYPE_VAR[type] ?? 'var(--text-dim)'
}
