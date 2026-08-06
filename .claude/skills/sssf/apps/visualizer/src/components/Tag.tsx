import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './Tag.module.css'

export interface TagProps {
  /** Stamped key. */
  label: string
  value: ReactNode
  tone?: 'default' | 'fail' | 'pass' | 'verdict'
  title?: string
}

/** A key/value micro-plate — phase header, gates, outputs. */
export function Tag({ label, value, tone = 'default', title }: TagProps) {
  return (
    <span className={cx(s.tag, s[tone])} title={title}>
      <span className={cx('stamp', s.label)}>{label}</span>
      <span className={cx(s.value, 'tnum')}>{value}</span>
    </span>
  )
}
