import type { CSSProperties, KeyboardEvent } from 'react'
import { cx } from '@/components/cx'
import { JsonBlock } from '@/components/JsonBlock'
import { StatChip } from '@/components/StatChip'
import { eventLabel, parseToolCall } from '@/lib/events'
import { fmtClock, payloadOk } from '@/lib/format'
import type { EventRow as EventRowData } from '@/lib/types'
import { eventTypeVar } from '@/theme/palette'
import { eventDurationMs } from './phaseData'
import s from './EventRow.module.css'

// Enter on the focused button already fires its click; stop the key there so
// the view-level list nav does not toggle the same row a second time.
function swallowActivation(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

export interface EventRowProps {
  event: EventRowData
  expanded: boolean
  onToggle: (eventId: string) => void
  selected: boolean
  itemProps: { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
  /** Position in the tape — drives the staggered reveal. */
  index: number
  /** True only on the panel's first paint; the poll must never re-trigger it. */
  reveal: boolean
}

/** One line of the run's tape, with its payload folded underneath. */
export function EventRow({
  event,
  expanded,
  onToggle,
  selected,
  itemProps,
  index,
  reveal,
}: EventRowProps) {
  const label = eventLabel(event)
  const failed = event.type === 'tool_call' && !payloadOk(event.payload_json)
  const duration = eventDurationMs(event)
  const call = event.type === 'tool_call' ? parseToolCall(event) : null
  const panelId = `pd-event-${event.event_id}`

  return (
    <div
      className={cx(s.event, selected && s.selected, reveal && 'stagger-item')}
      style={reveal ? ({ '--i': index } as CSSProperties) : undefined}
      {...itemProps}
    >
      <button
        type="button"
        className={cx(s.row, expanded && s.open)}
        onClick={() => onToggle(event.event_id)}
        onKeyDown={swallowActivation}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
      >
        <span className={cx(s.time, 'tnum')}>{fmtClock(event.started_at)}</span>
        <span className={s.type} style={{ color: eventTypeVar(event.type) }}>
          {event.type}
        </span>
        <span className={cx(s.label, failed && s.failed)} title={label}>
          {label}
        </span>
        <span className={s.extra}>
          {Number.isFinite(duration) ? <StatChip kind="runtime" value={duration} compact /> : null}
          {event.tokens ? <StatChip kind="tokens" value={event.tokens} compact /> : null}
        </span>
      </button>

      {expanded ? (
        <div className={s.payload} id={panelId}>
          {call ? (
            <>
              <div className={s.meta}>
                <span className={s.tool}>{call.tool}</span>
                {call.ok === false ? <span className={cx('stamp', s.failedWord)}>failed</span> : null}
                {call.duration_ms != null ? (
                  <StatChip kind="runtime" value={call.duration_ms} compact />
                ) : null}
              </div>
              <h4 className={cx('stamp', s.h4)}>args</h4>
              <JsonBlock
                raw={null}
                text={JSON.stringify(call.args ?? {}, null, 2)}
                maxHeight="42vh"
              />
              {call.result_snippet ? (
                <>
                  <h4 className={cx('stamp', s.h4)}>result</h4>
                  <pre className={s.result}>{call.result_snippet}</pre>
                </>
              ) : null}
            </>
          ) : event.type === 'tool_call' && event.payload_json ? (
            <>
              <div className={s.faint}>no detail available — legacy event payload</div>
              <JsonBlock raw={event.payload_json} maxHeight="42vh" className={s.spaced} />
            </>
          ) : event.payload_json ? (
            <>
              <h4 className={cx('stamp', s.h4)}>payload</h4>
              <JsonBlock raw={event.payload_json} maxHeight="42vh" />
            </>
          ) : (
            <div className={s.faint}>no payload</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
