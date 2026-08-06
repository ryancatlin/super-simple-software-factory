import { Activity } from 'lucide-react'
import { cx } from '@/components/cx'
import type { EventRow as EventRowData } from '@/lib/types'
import { EventRow } from './EventRow'
import s from './EventsPanel.module.css'

export interface EventsPanelProps {
  /** Already filtered to this phase and sorted by rowid. */
  events: EventRowData[]
  expanded: ReadonlySet<string>
  onToggle: (eventId: string) => void
  selectedId: string | null
  itemProps: (id: string) => { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
  /** True only on the panel's first paint. */
  reveal: boolean
}

/** The run's tape for this phase, newest last — the order it happened in. */
export function EventsPanel({
  events,
  expanded,
  onToggle,
  selectedId,
  itemProps,
  reveal,
}: EventsPanelProps) {
  return (
    <>
      <div className={s.head}>
        <Activity className={s.icon} size={16} strokeWidth={2} aria-hidden="true" />
        <span className="stamp">events</span>
        <span className={cx(s.count, 'tnum')}>{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className={s.faint}>no events</div>
      ) : (
        events.map((e, i) => (
          <EventRow
            key={e.event_id}
            event={e}
            index={i}
            reveal={reveal}
            expanded={expanded.has(e.event_id)}
            onToggle={onToggle}
            selected={e.event_id === selectedId}
            itemProps={itemProps(e.event_id)}
          />
        ))
      )}
    </>
  )
}
