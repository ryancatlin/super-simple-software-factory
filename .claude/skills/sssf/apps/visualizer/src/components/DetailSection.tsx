import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import s from './DetailSection.module.css'

export interface DetailSectionProps {
  /** Section id — also the scroll anchor for SectionNav. */
  id: string
  /** Rendered as a stamp. */
  title: string
  icon?: LucideIcon
  /** Rendered after the title when non-null. */
  count?: number | null
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function DetailSection({
  id,
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  children,
}: DetailSectionProps) {
  const bodyId = `${id}-body`
  return (
    <section id={id} className={s.section}>
      <button
        type="button"
        className={s.head}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <ChevronRight
          className={cx(s.chevron, open && s.chevronOpen)}
          size={14}
          strokeWidth={2.25}
          aria-hidden="true"
        />
        {Icon ? <Icon className={s.icon} size={16} strokeWidth={2} aria-hidden="true" /> : null}
        <span className={cx('stamp', s.title)}>{title}</span>
        {count == null ? null : <span className={cx(s.count, 'tnum')}>{count}</span>}
        <span className={s.filler} aria-hidden="true" />
      </button>
      {open ? (
        <div id={bodyId} className={s.body}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
