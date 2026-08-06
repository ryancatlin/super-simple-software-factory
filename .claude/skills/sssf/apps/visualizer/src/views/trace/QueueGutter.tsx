import type { CSSProperties } from 'react'
import { cx } from '@/components/cx'
import type { Phase } from '@/lib/types'
import type { Lane } from './lanes'
import s from './QueueGutter.module.css'

export interface QueueGutterProps {
  lanes: Lane[]
  selectedPhaseId: string | null
  onSelect: (phaseId: string) => void
  /** Horizontal strip layout below the waterfall, used under 1280px. */
  inline?: boolean
}

function QueueChip({
  phase,
  selected,
  onSelect,
}: {
  phase: Phase
  selected: boolean
  onSelect: (phaseId: string) => void
}) {
  return (
    <button
      type="button"
      className={cx(s.chip, selected && s.selected)}
      title={`${phase.name} — queued`}
      onClick={() => onSelect(phase.phase_id)}
    >
      <span className={s.glyph} aria-hidden="true">
        ○
      </span>
      <span className={s.name}>{phase.name}</span>
    </button>
  )
}

/**
 * Declared but never entered. Queued phases have no time, so they are kept out
 * of the axis entirely rather than parked at an arbitrary position — they live
 * in their own gutter, aligned to the lane that owns them.
 */
export function QueueGutter({ lanes, selectedPhaseId, onSelect, inline }: QueueGutterProps) {
  if (inline) {
    const queued = lanes.flatMap((lane) => lane.queued)
    if (queued.length === 0) return null
    return (
      <div className={s.strip}>
        <span className={cx('stamp', s.stripLabel)}>queue</span>
        <div className={s.stripChips}>
          {queued.map((phase) => (
            <QueueChip
              key={phase.phase_id}
              phase={phase}
              selected={phase.phase_id === selectedPhaseId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      {lanes.map((lane, i) => (
        <div
          key={lane.id}
          className={s.cell}
          style={{ gridColumn: 3, gridRow: i + 2 } as CSSProperties}
        >
          {lane.queued.map((phase) => (
            <QueueChip
              key={phase.phase_id}
              phase={phase}
              selected={phase.phase_id === selectedPhaseId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </>
  )
}
