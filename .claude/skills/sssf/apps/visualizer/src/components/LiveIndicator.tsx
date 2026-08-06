import { fmtDuration } from '@/lib/format'
import type { LiveState } from '@/App'
import { cx } from './cx'
import s from './LiveIndicator.module.css'

export interface LiveIndicatorProps {
  state: LiveState
  ageMs: number | null
  /** What the lamp is speaking for — the db path and journal mode. */
  title?: string
}

const WORDS: Record<LiveState, string> = {
  live: 'LIVE',
  stale: 'STALE',
  offline: 'OFFLINE',
}

/**
 * A lamp and a stamped word — never colour alone. The lamp ticks on a
 * steps(1) keyframe so it reads as an instrument, not a breathing dot.
 */
export function LiveIndicator({ state, ageMs, title }: LiveIndicatorProps) {
  return (
    <span className={cx(s.indicator, s[state])} role="status" aria-live="polite" title={title}>
      <span className={s.lamp} aria-hidden="true" />
      <span className={s.word}>{WORDS[state]}</span>
      {state !== 'live' && ageMs != null && Number.isFinite(ageMs) ? (
        <span className={cx(s.age, 'tnum')}>{fmtDuration(ageMs)}</span>
      ) : null}
    </span>
  )
}
