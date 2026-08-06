import type { CSSProperties } from 'react'
import { cx } from '@/components/cx'
import { StatChip } from '@/components/StatChip'
import { fmtDuration, ts } from '@/lib/format'
import type { Phase } from '@/lib/types'
import {
  blockGeometry,
  blockIsCompact,
  blockShowsDuration,
  phaseDurationMs,
  phaseEnd,
  type TimeScale,
} from './timeScale'
import s from './PhaseBlock.module.css'

export interface PhaseBlockProps {
  phase: Phase
  laneColor: string
  scale: TimeScale
  nowMs: number
  /** Measured track width in px — drives the label-overflow rule. */
  trackPx: number
  selected: boolean
  verdictFail: boolean
  ticks: { t: number; ok: boolean }[]
  onSelect: (phaseId: string) => void
  /** Keyboard cursor within the focused lane. Additive to the spec's props. */
  cursor?: boolean
}

const STATUS_GLYPH: Record<string, string> = {
  success: '✓',
  fail: '✗',
  running: '●',
  queued: '○',
}

function statusGlyph(status: string | null, verdictFail: boolean): string {
  if (verdictFail) return '✗'
  return STATUS_GLYPH[status ?? ''] ?? '○'
}

/**
 * A machined segment on the lane's track. Position and width are true time —
 * the only thing the block is allowed to lie about is a sub-pixel minimum
 * width, so a git commit that took 40ms still has something to click.
 */
export function PhaseBlock({
  phase,
  laneColor,
  scale,
  nowMs,
  trackPx,
  selected,
  verdictFail,
  ticks,
  onSelect,
  cursor,
}: PhaseBlockProps) {
  const geom = blockGeometry(phase, scale, nowMs)
  if (!geom) return null

  const start = ts(phase.started_at)
  const end = phaseEnd(phase, nowMs)
  const durationMs = phaseDurationMs(phase, nowMs)
  const status = phase.status ?? ''
  const compact = blockIsCompact(geom.width, trackPx)

  // A compact block trades its body for a glyph, so the tooltip is the only
  // place its runtime and description survive — both belong in the string
  // unconditionally rather than only when the block is wide enough to repeat
  // them.
  const title = `${phase.name} — ${phase.status}${verdictFail ? ' (verdict: fail)' : ''}${
    Number.isFinite(durationMs) ? ` · ${fmtDuration(durationMs)}` : ''
  }${phase.description ? `\n${phase.description}` : ''}`

  // Tool calls mark the block's own span, not the axis: a tick at 50% means
  // halfway through this phase.
  const span = Math.max(end - start, 1)
  const marks = ticks
    .filter((mark) => Number.isFinite(mark.t))
    .map((mark, i) => ({
      key: `${mark.t}-${i}`,
      x: Math.min(Math.max(((mark.t - start) / span) * 100, 1), 99),
      ok: mark.ok,
    }))

  return (
    <button
      type="button"
      className={cx(
        s.block,
        s[status],
        verdictFail && s.verdictFail,
        selected && s.selected,
        cursor && s.cursor,
      )}
      style={
        {
          '--lane': laneColor,
          left: `${geom.left}%`,
          width: `${geom.width}%`,
        } as CSSProperties
      }
      title={title}
      onClick={() => onSelect(phase.phase_id)}
    >
      <span className={s.face} aria-hidden="true" />
      {compact ? (
        <>
          <span className={cx(s.glyph, s[status], verdictFail && s.verdictFail)}>
            {statusGlyph(phase.status, verdictFail)}
          </span>
          <span className={s.srOnly}>{phase.name}</span>
        </>
      ) : (
        <span className={s.body}>
          <span className={s.top}>
            <span className={cx(s.glyph, s[status], verdictFail && s.verdictFail)}>
              {statusGlyph(phase.status, verdictFail)}
            </span>
            <span className={s.name}>{phase.name}</span>
            {Number.isFinite(durationMs) && blockShowsDuration(geom.width, trackPx) ? (
              <StatChip className={s.duration} kind="runtime" value={durationMs} compact />
            ) : null}
          </span>
          {phase.description ? <span className={s.desc}>{phase.description}</span> : null}
        </span>
      )}
      {verdictFail && !compact ? <span className={cx('stamp', s.verdictStamp)}>verdict</span> : null}
      {marks.map((mark) => (
        <span
          key={mark.key}
          className={cx(s.tick, !mark.ok && s.tickErr)}
          style={{ left: `${mark.x}%` }}
        />
      ))}
    </button>
  )
}
