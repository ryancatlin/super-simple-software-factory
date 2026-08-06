import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './Stamp.module.css'

export interface StampProps {
  children: ReactNode
  as?: 'span' | 'div' | 'h2' | 'h3'
  tone?: 'faint' | 'dim' | 'amber' | 'pass' | 'fail'
  className?: string
}

/** A silk-screened label. Chrome, never content. */
export function Stamp({ children, as: Tag = 'span', tone = 'faint', className }: StampProps) {
  return <Tag className={cx('stamp', s[tone], className)}>{children}</Tag>
}
