import type { CSSProperties } from 'react'
import { Bot, SquareTerminal, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from '@/components/cx'
import { ModelBadge } from '@/components/ModelBadge'
import { fmtOffset } from '@/lib/format'
import type { Phase, PhaseKind } from '@/lib/types'
import { contextFill, contextLabel, type Lane } from './lanes'
import { PhaseBlock } from './PhaseBlock'
import { blockGeometry, blockIsCompact, BREAK_PCT, type BlockGeometry, type TimeScale } from './timeScale'
import s from './TraceLane.module.css'

export interface TraceLaneProps {
  lane: Lane
  scale: TimeScale
  nowMs: number
  /** Measured track width, for the label-overflow rule. */
  trackPx: number
  selectedPhaseId: string | null
  /** phase_id → envelope verdict. An absent key means no verdict was recorded. */
  verdicts: Record<string, boolean>
  /** phase_id → tool-call marks, precomputed once by SessionTrace. */
  toolTicks: Record<string, { t: number; ok: boolean }[]>
  onSelect: (phaseId: string) => void
  /** Keyboard lane focus. */
  laneSelected: boolean
  /** Additive: grid row this lane occupies (1 is the axis). */
  row: number
  /** Additive: the keyboard cursor's phase inside the focused lane. */
  cursorPhaseId: string | null
  /** Additive: first-paint stagger. */
  reveal: boolean
  /** Additive: data-selected + scroll ref from useListKeyboardNav. */
  itemProps: { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
}

const KIND_ICONS: Record<PhaseKind, LucideIcon> = {
  engineer: UserRound,
  code: SquareTerminal,
  agent: Bot,
}

const NUM = new Intl.NumberFormat('en-US')

/** A floating name must not run into the next block. */
const LABEL_CLEARANCE_PX = 90
/** Past this the label would run off the track, so it flips to the block's left. */
const LABEL_FLIP_PCT = 82

/**
 * One lane: its rail plate and its track. Both are direct children of the
 * waterfall grid, explicitly placed, so a tall rail (model + context gauge)
 * grows the whole row and the track stays aligned with the axis above it.
 */
export function TraceLane({
  lane,
  scale,
  nowMs,
  trackPx,
  selectedPhaseId,
  verdicts,
  toolTicks,
  onSelect,
  laneSelected,
  row,
  cursorPhaseId,
  reveal,
  itemProps,
}: TraceLaneProps) {
  const Icon = KIND_ICONS[lane.kind]
  const ctx = lane.context

  const placed: { phase: Phase; geom: BlockGeometry }[] = []
  for (const phase of lane.phases) {
    const geom = blockGeometry(phase, scale, nowMs)
    if (geom) placed.push({ phase, geom })
  }
  placed.sort((a, b) => a.geom.left - b.geom.left)

  // A block too narrow for its own name floats one beside it — unless the next
  // block is close enough that the two would collide. The label sits just past
  // the block's right edge, or to its left when the block is against the end of
  // the track.
  const floating: { phase: Phase; style: CSSProperties }[] = []
  placed.forEach((entry, i) => {
    if (!blockIsCompact(entry.geom.width, trackPx)) return
    const after = entry.geom.left + entry.geom.width
    const next = placed[i + 1]
    if (next && ((next.geom.left - after) / 100) * trackPx < LABEL_CLEARANCE_PX) return
    floating.push({
      phase: entry.phase,
      style:
        after > LABEL_FLIP_PCT
          ? { right: `calc(${100 - entry.geom.left}% + 8px)` }
          : { left: `calc(${after}% + 8px)` },
    })
  })

  const laneVar = { '--lane': lane.color } as CSSProperties

  return (
    <>
      <div
        className={cx(s.rail, reveal && 'stagger-item')}
        style={{ ...laneVar, '--i': row, gridColumn: 1, gridRow: row } as CSSProperties}
      >
        <span className={s.head}>
          <Icon className={s.kind} size={18} strokeWidth={2} aria-hidden="true" />
          <span className={s.name} title={lane.label}>
            {lane.label}
          </span>
        </span>

        {lane.model ? <ModelBadge model={lane.model} size={16} className={s.model} /> : null}

        {ctx ? (
          <span
            className={s.ctx}
            title={`${NUM.format(ctx.used)} / ${NUM.format(ctx.window)} tokens used · ${NUM.format(
              ctx.window - ctx.used,
            )} remaining`}
          >
            <span className={s.ctxHead}>
              <span className={cx('stamp', s.ctxLabel)}>ctx</span>
              <span className={cx(s.ctxPct, 'tnum')}>{contextLabel(ctx)}</span>
            </span>
            <span className={s.ctxTrough}>
              <span className={s.ctxFill} style={{ width: contextFill(ctx) }} />
            </span>
          </span>
        ) : null}

        {lane.metaLines.map((line) => (
          <span key={line} className={cx('stamp', s.meta)}>
            {line}
          </span>
        ))}
      </div>

      <div
        className={cx(s.track, laneSelected && s.trackSelected, reveal && 'stagger-item')}
        style={{ ...laneVar, '--i': row, gridColumn: 2, gridRow: row } as CSSProperties}
        {...itemProps}
      >
        {scale.ticks.map((tick) => (
          <span key={tick.x} className={s.gridline} style={{ left: `${tick.x}%` }} />
        ))}

        {scale.breaks.map((brk) => (
          <span
            key={brk.x}
            className={s.breakBand}
            style={{ left: `${brk.x}%`, width: `${BREAK_PCT}%` }}
            title={`${fmtOffset(brk.t1 - brk.t0)} with no phase activity — axis compressed`}
          />
        ))}

        {lane.phases.map((phase) => (
          <PhaseBlock
            key={phase.phase_id}
            phase={phase}
            laneColor={lane.color}
            scale={scale}
            nowMs={nowMs}
            trackPx={trackPx}
            selected={phase.phase_id === selectedPhaseId}
            verdictFail={phase.status === 'success' && verdicts[phase.phase_id] === false}
            ticks={toolTicks[phase.phase_id] ?? []}
            onSelect={onSelect}
            cursor={phase.phase_id === cursorPhaseId}
          />
        ))}

        {floating.map((entry) => (
          <span key={entry.phase.phase_id} className={s.floatLabel} style={entry.style}>
            {entry.phase.name}
          </span>
        ))}
      </div>
    </>
  )
}
