import type { CSSProperties } from 'react'
import { cx } from './cx'
import s from './LoadingPlate.module.css'

export interface LoadingPlateProps {
  /** e.g. 'READING TRACE DB…' */
  label: string
  /** Number of skeleton rows; 0 renders just the label plate. */
  rows?: number
  /** px, when rows === 0. Default 200. */
  height?: number
}

/** No spinner, no shimmer sweep — a stamped plate and dot-matrix fill. */
export function LoadingPlate({ label, rows = 0, height = 200 }: LoadingPlateProps) {
  if (rows <= 0) {
    return (
      <div className={cx('plate', s.plate)} style={{ minHeight: `${height}px` }}>
        <span className={cx('stamp', s.label)}>{label}</span>
      </div>
    )
  }

  return (
    <div className={s.rows}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cx(s.row, 'stagger-item')}
          style={{ '--i': i } as CSSProperties}
          aria-hidden={i > 0 ? 'true' : undefined}
        >
          {i === 0 ? <span className={cx('stamp', s.label)}>{label}</span> : null}
        </div>
      ))}
    </div>
  )
}
