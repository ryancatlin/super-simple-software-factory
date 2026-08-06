import { cx } from '@/components/cx'
import { fmtOffset } from '@/lib/format'
import { BREAK_PCT, type TimeScale } from './timeScale'
import s from './TimeAxis.module.css'

export interface TimeAxisProps {
  scale: TimeScale
  nowMs: number
  running: boolean
  t0: number
}

/** Beyond these the label would hang off the end of the track. */
const LEFT_EDGE_PCT = 2
const RIGHT_EDGE_PCT = 96

function edgeClass(x: number): string | false {
  if (x <= LEFT_EDGE_PCT) return s.atStart
  if (x >= RIGHT_EDGE_PCT) return s.atEnd
  return false
}

/**
 * The axis is the whole claim of this view: every label is a real offset from
 * the run's first phase, and every compressed stretch of dead air is drawn as a
 * notched break band rather than quietly squeezed.
 */
export function TimeAxis({ scale, nowMs, running, t0 }: TimeAxisProps) {
  const nowX = scale.x(nowMs)

  return (
    <div className={s.axis}>
      {scale.ticks.map((tick) => (
        <span key={tick.x} className={s.tick} style={{ left: `${tick.x}%` }}>
          <span className={cx(s.label, 'tnum', edgeClass(tick.x))}>{tick.label}</span>
          <span className={s.mark} />
        </span>
      ))}

      {scale.breaks.map((brk) => (
        <span
          key={brk.x}
          className={s.break}
          style={{ left: `${brk.x}%`, width: `${BREAK_PCT}%` }}
          title={`${fmtOffset(brk.t1 - brk.t0)} with no phase activity — axis compressed`}
        >
          <span className={cx('stamp', s.breakLabel)}>{fmtOffset(brk.t1 - brk.t0)}</span>
        </span>
      ))}

      {running ? (
        <span
          className={cx(s.now, 'tnum', edgeClass(nowX))}
          style={{ left: `${nowX}%` }}
          role="status"
          aria-live="off"
        >
          {fmtOffset(nowMs - t0)}
        </span>
      ) : null}
    </div>
  )
}
