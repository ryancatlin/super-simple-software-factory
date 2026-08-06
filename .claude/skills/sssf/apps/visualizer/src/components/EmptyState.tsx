import type { ReactNode } from 'react'
import { CopyPlate } from './CopyPlate'
import { cx } from './cx'
import s from './EmptyState.module.css'

export interface EmptyStateProps {
  /** Stamped. */
  title: string
  body: ReactNode
  /** A command to copy — renders a CopyPlate. */
  command?: string
  action?: { label: string; href: string }
}

/** Never a shrug: what is missing, why, and one concrete next action. */
export function EmptyState({ title, body, command, action }: EmptyStateProps) {
  return (
    <div className={cx('plate', s.empty)}>
      <h2 className={cx('stamp', s.title)}>{title}</h2>
      <p className={s.body}>{body}</p>
      {command || action ? (
        <div className={s.actions}>
          {command ? <CopyPlate text={command} /> : null}
          {action ? (
            <a className={s.link} href={action.href}>
              {action.label}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
