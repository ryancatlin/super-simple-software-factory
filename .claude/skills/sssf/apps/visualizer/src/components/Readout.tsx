import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './Readout.module.css'

export interface ReadoutProps {
  /** Stamped; uppercased by CSS. */
  label: string
  /** Hover explanation. */
  title?: string
  /** Value in --font-mono. Default true. */
  mono?: boolean
  children: ReactNode
}

/** One cell of the instrument cluster: a stamp over a tabular value. */
export function Readout({ label, title, mono = true, children }: ReadoutProps) {
  return (
    <div className={s.readout} title={title}>
      <span className={cx('stamp', s.label)}>{label}</span>
      <span className={cx(s.value, mono ? s.mono : s.display, 'tnum')}>{children}</span>
    </div>
  )
}
