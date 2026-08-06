import { X } from 'lucide-react'
import { CopyPlate } from '@/components/CopyPlate'
import { StatChip } from '@/components/StatChip'
import { StatusChip } from '@/components/StatusChip'
import { Tag } from '@/components/Tag'
import type { Phase } from '@/lib/types'
import s from './PhaseHeader.module.css'

export interface PhaseHeaderProps {
  phase: Phase
  /** Live while the phase is running; NaN when it never started. */
  durationMs: number
  /**
   * This phase's repro bundle as markdown — the same document the failure
   * triage plate copies, scoped to whatever phase is open. Omitted → no action.
   */
  bundle?: string
  onClose: () => void
}

/** The panel's stamped head-plate: what this phase is, and how it went. */
export function PhaseHeader({ phase, durationMs, bundle, onClose }: PhaseHeaderProps) {
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
      {bundle ? (
        <CopyPlate
          className={s.bundle}
          text={bundle}
          label="copy phase bundle"
          title="Copy this phase as markdown — summary, run and phase facts, gates, error events, the phase report and the compiled prompt"
        />
      ) : null}
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
