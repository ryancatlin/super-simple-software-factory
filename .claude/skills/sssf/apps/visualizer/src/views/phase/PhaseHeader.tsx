import { X } from 'lucide-react'
import { StatChip } from '@/components/StatChip'
import { StatusChip } from '@/components/StatusChip'
import { Tag } from '@/components/Tag'
import type { Phase } from '@/lib/types'
import s from './PhaseHeader.module.css'

export interface PhaseHeaderProps {
  phase: Phase
  /** Live while the phase is running; NaN when it never started. */
  durationMs: number
  onClose: () => void
}

/** The panel's stamped head-plate: what this phase is, and how it went. */
export function PhaseHeader({ phase, durationMs, onClose }: PhaseHeaderProps) {
  return (
    <header className={s.head}>
      <h2 className={s.name}>{phase.name}</h2>
      <StatusChip status={phase.status ?? 'queued'} />
      {Number.isFinite(durationMs) ? <StatChip kind="runtime" value={durationMs} /> : null}
      <div className={s.tags}>
        <Tag label="owner" value={phase.owner ?? '—'} />
        <Tag label="kind" value={phase.kind ?? '—'} />
        <Tag label="attempt" value={`${phase.attempt ?? 0}/${phase.retries ?? 0}`} />
      </div>
      <button
        type="button"
        className={s.close}
        onClick={onClose}
        title="close"
        aria-label="Close phase detail"
      >
        <X size={16} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </header>
  )
}
