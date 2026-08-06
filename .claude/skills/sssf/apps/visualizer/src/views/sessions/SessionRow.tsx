import { useCallback } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { X } from 'lucide-react'
import { PhaseDots } from '@/components/PhaseDots'
import { StatChip } from '@/components/StatChip'
import { StatusChip } from '@/components/StatusChip'
import { cx } from '@/components/cx'
import { useSessionEvents } from '@/hooks/useSessionEvents'
import { archiveSession } from '@/lib/api'
import { fmtDate, ts } from '@/lib/format'
import type { SessionSummary } from '@/lib/types'
import { hrefFor } from '@/router'
import { SessionTraceStrip } from './SessionTraceStrip'
import s from './SessionRow.module.css'

export interface SessionRowProps {
  session: SessionSummary
  /** Live clock for the duration readout (1000ms cadence from the parent). */
  nowMs: number
  /** Reveal index for the stagger; already clamped by the parent is fine. */
  index: number
  /** True while first paint — enables .stagger-item. */
  reveal: boolean
  selected: boolean
  /** Emitted optimistically before the POST resolves. '' means the write failed → resync. */
  onArchived: (adwId: string) => void
  itemProps: { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
}

/** The left-edge block's fill. Anything the db does not recognise reads inert. */
function statusClass(status: string | null): string {
  if (status === 'success') return s.success
  if (status === 'fail') return s.fail
  if (status === 'running') return s.running
  return s.unknown
}

/** running → now; otherwise the recorded end, falling back to now. NaN with no start. */
function durationMs(session: SessionSummary, nowMs: number): number {
  const start = ts(session.started_at)
  if (!Number.isFinite(start)) return Number.NaN
  const end = session.status === 'running' ? nowMs : ts(session.ended_at)
  return (Number.isFinite(end) ? end : nowMs) - start
}

/**
 * One ledger row — DESIGN_SPEC §5.2. Two tiers: a plate row of identity and
 * numbers, and the per-agent trace strip beneath it. The left edge is a flat
 * status block, which is what makes a wall of runs scannable at a glance.
 *
 * The row is an <a>; the archive control is a real <button> inside it, so the
 * click has to be stopped before it navigates.
 */
export function SessionRow({
  session,
  nowMs,
  index,
  reveal,
  selected,
  onArchived,
  itemProps,
}: SessionRowProps) {
  const running = session.status === 'running'

  // Each row tails its own event stream — one full drain on mount, then the
  // rowid-cursor poll, but only while the run is live.
  const { events } = useSessionEvents(session.adw_id, running)

  const archive = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      onArchived(session.adw_id)
      archiveSession(session.adw_id).catch(() => {
        // Signals the parent to re-sync from the server.
        onArchived('')
      })
    },
    [onArchived, session.adw_id],
  )

  return (
    <a
      className={cx(s.row, reveal && 'stagger-item')}
      style={{ '--i': index } as CSSProperties}
      href={hrefFor(session.adw_id)}
      aria-current={selected ? 'true' : undefined}
      {...itemProps}
    >
      <span className={cx(s.block, statusClass(session.status))} aria-hidden="true" />

      <div className={s.plate}>
        <span className={s.ident}>
          <span className={s.id}>{session.adw_id}</span>
          <span className={s.workflow} title={session.adw_name ?? undefined}>
            {session.adw_name ?? '—'}
          </span>
        </span>

        {session.request ? (
          <span className={s.request} title={session.request}>
            {session.request}
          </span>
        ) : (
          <span className={cx(s.request, s.blank)}>—</span>
        )}

        <span className={s.cluster}>
          <StatusChip status={session.status ?? 'fail'} />
          <PhaseDots phases={session.phases ?? []} />
        </span>

        <span className={s.stats}>
          <StatChip kind="cost" value={session.total_cost} />
          <StatChip kind="runtime" value={durationMs(session, nowMs)} />
          <StatChip kind="tokens" value={session.total_tokens} />
        </span>

        <span className={cx(s.started, 'tnum')}>{fmtDate(session.started_at)}</span>

        <button
          className={s.archive}
          type="button"
          title="Archive — remove this run from review"
          aria-label="Archive run"
          onClick={archive}
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <SessionTraceStrip session={session} events={events} nowMs={nowMs} />
    </a>
  )
}
