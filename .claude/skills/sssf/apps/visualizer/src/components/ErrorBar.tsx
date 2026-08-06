import { TriangleAlert } from 'lucide-react'
import { fmtDuration } from '@/lib/format'
import { cx } from './cx'
import s from './ErrorBar.module.css'

export interface ErrorBarProps {
  message: string
  /**
   * Stamped prefix naming what failed. Defaults to the polling-loop wording,
   * which is what most call sites are reporting; a phase that failed on its
   * own terms must pass its own label rather than blame the transport.
   */
  label?: string
  /** Consecutive failures; rendered as a tabular counter when > 1. */
  attempts?: number
  /** Age of the last success in ms; rendered as "last ok <dur>" when finite. */
  lastOkAgeMs?: number | null
  sticky?: boolean
}

export function ErrorBar({
  message,
  label = 'API unreachable — retrying',
  attempts,
  lastOkAgeMs,
  sticky,
}: ErrorBarProps) {
  const showAttempts = attempts != null && attempts > 1
  const showAge = lastOkAgeMs != null && Number.isFinite(lastOkAgeMs)
  return (
    <div className={cx(s.bar, sticky && s.sticky)} role="alert">
      <span className={s.hatch} aria-hidden="true" />
      <TriangleAlert className={s.icon} size={15} strokeWidth={2.25} aria-hidden="true" />
      <span className={cx('stamp', s.prefix)}>{label}</span>
      <span className={s.dot} aria-hidden="true">
        ·
      </span>
      <span className={s.message}>{message}</span>
      {showAttempts ? (
        <>
          <span className={s.dot} aria-hidden="true">
            ·
          </span>
          <span className={cx(s.meta, 'tnum')}>{attempts} attempts</span>
        </>
      ) : null}
      {showAge ? (
        <>
          <span className={s.dot} aria-hidden="true">
            ·
          </span>
          <span className={cx(s.meta, 'tnum')}>last ok {fmtDuration(lastOkAgeMs)}</span>
        </>
      ) : null}
    </div>
  )
}
