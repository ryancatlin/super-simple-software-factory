import type { Phase } from '@/lib/types'
import { cx } from './cx'
import s from './PhaseDots.module.css'

export interface PhaseDotsProps {
  phases: Phase[]
}

/**
 * One machined mark per phase, in seq order. Marks, not glyphs — but the
 * status → colour → title mapping is the parity contract and is unchanged.
 */
export function PhaseDots({ phases }: PhaseDotsProps) {
  const ordered = phases.toSorted((a, b) => (a.seq ?? 0) - (b.seq ?? 0))

  if (ordered.length === 0) {
    return <span className={s.none}>—</span>
  }

  return (
    <span className={s.dots}>
      {ordered.map((p) => (
        <span
          key={p.phase_id}
          className={cx(s.dot, s[p.status ?? 'queued'])}
          title={`${p.name} — ${p.status}`}
        />
      ))}
    </span>
  )
}
