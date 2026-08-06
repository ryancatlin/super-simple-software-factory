/**
 * The waterfall's time mapping — DESIGN_SPEC §5.3.2.
 *
 * The Vue version faked positions: a fixed 16% "request zone" plus a cumulative
 * right-shift that widened short blocks and pushed every later block along. It
 * read as a timeline while lying about one. This module maps blocks to their
 * true time instead, and cuts dead air out *explicitly* — every elision is a
 * labelled break band on the axis, so nothing is silently compressed.
 *
 * Pure and dependency-free so the geometry can be reasoned about (and tested)
 * without a DOM.
 */
import { axisTicks, fmtOffset, ts } from '@/lib/format'
import type { Phase } from '@/lib/types'

export interface Segment {
  t0: number
  t1: number
  /** 0..100 across the track. */
  x0: number
  x1: number
}

export interface Break {
  t0: number
  t1: number
  /** Left edge of the band, 0..100. The band is always BREAK_PCT wide. */
  x: number
}

export interface TimeScale {
  t0: number
  t1: number
  segments: Segment[]
  breaks: Break[]
  /** ms → percentage across the track. Monotonic, clamped to [0, 100]. */
  x: (t: number) => number
  /** Percentage width for a duration. Never negative. */
  w: (tStart: number, tEnd: number) => number
  ticks: { x: number; label: string }[]
}

/** Track width each elided gap consumes. Fixed, so a break never reads as duration. */
export const BREAK_PCT = 2.2

const MAX_BREAKS = 3
const MIN_SPAN_MS = 1000
/** A gap must beat both of these to be worth cutting. */
const MIN_GAP_MS = 30_000
const GAP_SHARE = 0.18
/** Tick budget across the whole axis, split between segments by their width. */
const TICK_BUDGET = 7
/** Two ticks closer than this in track-% would print on top of each other. */
const TICK_MIN_GAP_PCT = 4

interface Interval {
  t0: number
  t1: number
}

/**
 * When a phase's block ends: its recorded end, else now while it runs, else its
 * own start (a zero-width mark rather than a block running to the axis end).
 */
export function phaseEnd(p: Phase, nowMs: number): number {
  const start = ts(p.started_at)
  if (!Number.isFinite(start)) return Number.NaN
  const end = ts(p.ended_at)
  if (Number.isFinite(end)) return Math.max(end, start)
  return p.status === 'running' ? Math.max(nowMs, start) : start
}

/** Wall-clock length of a phase's block, NaN when it never started. */
export function phaseDurationMs(p: Phase, nowMs: number): number {
  const start = ts(p.started_at)
  if (!Number.isFinite(start)) return Number.NaN
  return phaseEnd(p, nowMs) - start
}

function mergeIntervals(raw: Interval[]): Interval[] {
  const sorted = raw.toSorted((a, b) => a.t0 - b.t0)
  const merged: Interval[] = []
  for (const iv of sorted) {
    const last = merged[merged.length - 1]
    // Adjacent counts as overlapping: back-to-back phases are one activity run.
    if (last && iv.t0 <= last.t1) last.t1 = Math.max(last.t1, iv.t1)
    else merged.push({ t0: iv.t0, t1: iv.t1 })
  }
  return merged
}

/**
 * @param running whether the session itself is still running — the Vue range
 *   used `session.status === 'running'` for this, which the four-argument
 *   signature in the spec cannot express without guessing from `sessionEnd`.
 */
export function buildTimeScale(
  phases: Phase[],
  sessionStart: number,
  sessionEnd: number,
  nowMs: number,
  running: boolean,
): TimeScale {
  // ── 1. bounds ──────────────────────────────────────────────────────────────
  let t0 = Number.POSITIVE_INFINITY
  let t1 = Number.NEGATIVE_INFINITY
  if (Number.isFinite(sessionStart)) {
    t0 = Math.min(t0, sessionStart)
    t1 = Math.max(t1, sessionStart)
  }
  if (Number.isFinite(sessionEnd)) t1 = Math.max(t1, sessionEnd)

  let live = running
  for (const p of phases) {
    const a = ts(p.started_at)
    if (Number.isFinite(a)) {
      t0 = Math.min(t0, a)
      t1 = Math.max(t1, a)
      if (p.status === 'running') live = true
    }
    const b = ts(p.ended_at)
    if (Number.isFinite(b)) t1 = Math.max(t1, b)
  }
  if (live) t1 = Math.max(t1, nowMs)

  if (!Number.isFinite(t0)) {
    t0 = nowMs
    t1 = nowMs + MIN_SPAN_MS
  }
  if (!Number.isFinite(t1) || t1 - t0 < MIN_SPAN_MS) t1 = t0 + MIN_SPAN_MS

  const span = t1 - t0
  const clamp = (t: number) => Math.min(Math.max(t, t0), t1)

  // ── 2. activity intervals ──────────────────────────────────────────────────
  const activity: Interval[] = []
  for (const p of phases) {
    const start = ts(p.started_at)
    if (!Number.isFinite(start)) continue
    activity.push({ t0: clamp(start), t1: clamp(Math.max(phaseEnd(p, nowMs), start)) })
  }
  const merged = mergeIntervals(activity)

  // ── 3. gaps worth eliding ──────────────────────────────────────────────────
  const threshold = Math.max(GAP_SHARE * span, MIN_GAP_MS)
  const gaps: Interval[] = []
  for (let i = 1; i < merged.length; i += 1) {
    const prev = merged[i - 1]
    const cur = merged[i]
    if (cur.t0 - prev.t1 > threshold) gaps.push({ t0: prev.t1, t1: cur.t0 })
  }
  const cuts = gaps
    .toSorted((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))
    .slice(0, MAX_BREAKS)
    .toSorted((a, b) => a.t0 - b.t0)

  // ── 4. segments ────────────────────────────────────────────────────────────
  // With no qualifying gap this is exactly one segment spanning 0..100 — the
  // common case, and a plain linear axis.
  const bounds: Interval[] = []
  let edge = t0
  for (const cut of cuts) {
    bounds.push({ t0: edge, t1: cut.t0 })
    edge = cut.t1
  }
  bounds.push({ t0: edge, t1 })

  const liveMs = bounds.reduce((sum, b) => sum + Math.max(b.t1 - b.t0, 0), 0)
  const avail = 100 - cuts.length * BREAK_PCT

  const segments: Segment[] = []
  const breaks: Break[] = []
  /** Segments and break bands interleaved, left to right — what x() walks. */
  const spans: Segment[] = []

  let x = 0
  bounds.forEach((bound, i) => {
    const dur = Math.max(bound.t1 - bound.t0, 0)
    const width = liveMs > 0 ? (dur / liveMs) * avail : avail / bounds.length
    const seg: Segment = { t0: bound.t0, t1: bound.t1, x0: x, x1: x + width }
    segments.push(seg)
    spans.push(seg)
    x = seg.x1

    const cut = cuts[i]
    if (cut) {
      breaks.push({ t0: cut.t0, t1: cut.t1, x })
      spans.push({ t0: cut.t0, t1: cut.t1, x0: x, x1: x + BREAK_PCT })
      x += BREAK_PCT
    }
  })

  const xOf = (t: number): number => {
    if (!Number.isFinite(t)) return 0
    if (t <= t0) return 0
    if (t >= t1) return 100
    for (const sp of spans) {
      if (t > sp.t1) continue
      const dur = sp.t1 - sp.t0
      if (dur <= 0) return sp.x0
      return sp.x0 + ((t - sp.t0) / dur) * (sp.x1 - sp.x0)
    }
    return 100
  }

  // ── 5. ticks, labelled as cumulative offsets from the run start ────────────
  const ticks: { x: number; label: string }[] = []
  for (const seg of segments) {
    const dur = seg.t1 - seg.t0
    const width = seg.x1 - seg.x0
    if (dur <= 0 || width <= 0) continue
    const budget = Math.max(1, Math.ceil(TICK_BUDGET * (width / 100)))
    for (const tick of axisTicks(dur, budget)) {
      const at = seg.x0 + (tick.pct / 100) * width
      const last = ticks[ticks.length - 1]
      if (last && at - last.x < TICK_MIN_GAP_PCT) continue
      ticks.push({ x: at, label: fmtOffset(seg.t0 - t0 + (tick.pct / 100) * dur) })
    }
  }

  return {
    t0,
    t1,
    segments,
    breaks,
    x: xOf,
    w: (tStart: number, tEnd: number) => Math.max(xOf(tEnd) - xOf(tStart), 0),
    ticks,
  }
}

// ── block geometry ───────────────────────────────────────────────────────────

export interface BlockGeometry {
  /** Track-%, both. */
  left: number
  width: number
}

/** Below this the block cannot hold its own name; the lane floats it instead. */
export const LABEL_MIN_PX = 120

/** Where a timed phase sits on the axis, or null when it never started. */
export function blockGeometry(p: Phase, scale: TimeScale, nowMs: number): BlockGeometry | null {
  const start = ts(p.started_at)
  if (!Number.isFinite(start)) return null
  return { left: scale.x(start), width: scale.w(start, phaseEnd(p, nowMs)) }
}

/** True when the block is too narrow to carry its own name. */
export function blockIsCompact(width: number, trackPx: number): boolean {
  if (trackPx <= 0) return false
  return (width / 100) * trackPx < LABEL_MIN_PX
}

/**
 * Below this the glyph, the name and the runtime chip cannot all sit on line 1
 * without the name being ellipsised down to a letter — "t…" beside a perfectly
 * legible "1m 10s" is the wrong datum surviving. The chip is the one that goes:
 * the duration is on the block's `title` for every block, the name is not
 * recoverable from anywhere else on screen.
 */
export const DURATION_MIN_PX = 190

/** True when line 1 has room for the runtime chip as well as the name. */
export function blockShowsDuration(width: number, trackPx: number): boolean {
  if (trackPx <= 0) return true
  return (width / 100) * trackPx >= DURATION_MIN_PX
}
