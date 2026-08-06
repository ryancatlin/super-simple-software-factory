import { cx } from '@/components/cx'
import s from './SectionNav.module.css'

export interface SectionNavEntry {
  id: string
  label: string
  count?: number | null
  present: boolean
}

export interface SectionNavProps {
  entries: SectionNavEntry[]
  activeId: string | null
  onJump: (id: string) => void
}

/**
 * The panel's index rail — stamped links to every section this phase actually
 * has. Absent sections are absent from the rail too, so its length is itself a
 * readout of what was recorded.
 */
export function SectionNav({ entries, activeId, onJump }: SectionNavProps) {
  const present = entries.filter((e) => e.present)
  if (present.length === 0) return null
  return (
    <nav className={s.rail} aria-label="Phase detail sections">
      <ul className={s.list}>
        {present.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={cx(s.link, entry.id === activeId && s.active)}
              onClick={() => onJump(entry.id)}
              aria-current={entry.id === activeId ? 'true' : undefined}
            >
              <span className={cx('stamp', s.label)}>{entry.label}</span>
              {entry.count == null ? null : (
                <span className={cx(s.count, 'tnum')}>{entry.count}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
