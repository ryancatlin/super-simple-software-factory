import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PollHealth } from '@/App'
import { cx } from '@/components/cx'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBar } from '@/components/ErrorBar'
import { LoadingPlate } from '@/components/LoadingPlate'
import { Stamp } from '@/components/Stamp'
import { useFirstPaint } from '@/hooks/useFirstPaint'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useNow } from '@/hooks/useNow'
import { useSessions } from '@/hooks/useSessions'
import { ts } from '@/lib/format'
import { navigate } from '@/router'
import { SessionRow } from './SessionRow'
import s from './SessionsList.module.css'

export interface SessionsListProps {
  onPollHealth: (h: PollHealth) => void
}

/**
 * The ledger — DESIGN_SPEC §5.2. One row per run, hairline separated, with a
 * chunky status block on the left edge. Not a card grid.
 *
 * The 500ms poll is the whole data layer; everything below it is derived, so a
 * tick never resets keyboard selection (tracked by adw_id) or re-fires the
 * staggered reveal (gated by useFirstPaint).
 */
export function SessionsList({ onPollHealth }: SessionsListProps) {
  const { data, error, loaded, lastOkAt, attempts, refresh } = useSessions()

  useEffect(() => {
    onPollHealth({ lastOkAt, error, attempts })
  }, [onPollHealth, lastOkAt, error, attempts])

  // Archiving is optimistic: the poll takes up to half a second to drop the
  // row and a triage click should feel instant. Ids stay here until the server
  // stops returning them, then they are pruned so the set cannot grow forever.
  const [archived, setArchived] = useState<ReadonlySet<string>>(() => new Set<string>())

  const serverIds = useMemo(() => new Set((data ?? []).map((x) => x.adw_id)), [data])

  useEffect(() => {
    setArchived((prev) => {
      if (prev.size === 0) return prev
      const next = new Set<string>()
      for (const id of prev) if (serverIds.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [serverIds])

  /** An empty id means the write failed, so re-sync from the server instead. */
  const onArchived = useCallback(
    (adwId: string) => {
      if (!adwId) {
        setArchived(new Set<string>())
        refresh()
        return
      }
      setArchived((prev) => {
        const next = new Set(prev)
        next.add(adwId)
        return next
      })
    },
    [refresh],
  )

  const ordered = useMemo(
    () =>
      (data ?? [])
        .filter((x) => !archived.has(x.adw_id))
        // ts() is NaN for a null timestamp; `|| 0` keeps the comparator total.
        .toSorted((a, b) => (ts(b.started_at) || 0) - (ts(a.started_at) || 0)),
    [data, archived],
  )

  const ids = useMemo(() => ordered.map((x) => x.adw_id), [ordered])

  // A row's duration reads off the clock whenever its end timestamp is missing
  // — that is every running run, and also a hard-killed one whose `ended_at`
  // was never written. Ticking only on `status === 'running'` would freeze the
  // second kind at whatever "now" happened to be, so the test is the same one
  // durationMs() applies: started, not ended.
  const ticking = ordered.some(
    (x) => Number.isFinite(ts(x.started_at)) && !Number.isFinite(ts(x.ended_at)),
  )

  // A finished ledger has nothing left to tick, so the timer stops with it.
  const nowMs = useNow(1000, ticking)
  const reveal = useFirstPaint(loaded)

  const onActivate = useCallback((id: string) => navigate(id), [])
  const nav = useListKeyboardNav({ ids, onActivate })

  // The view takes focus so j/k work without a click first.
  const { ref: containerRef } = nav.containerProps
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])

  return (
    <div className={s.ledger} {...nav.containerProps}>
      {ordered.length > 0 ? (
        <div className={s.head}>
          <span className={s.headLeft}>
            <span className={s.headMark} aria-hidden="true" />
            <strong className={cx(s.headCount, 'tnum')}>{ordered.length}</strong>
            <span className="stamp">runs</span>
          </span>
          <span className={cx('stamp', s.headCols)}>
            run · workflow · request · phases · spend · started
          </span>
        </div>
      ) : null}

      {error ? <ErrorBar message={error} attempts={attempts} /> : null}

      {ordered.map((session, i) => (
        <SessionRow
          key={session.adw_id}
          session={session}
          nowMs={nowMs}
          index={i}
          reveal={reveal}
          selected={nav.selectedId === session.adw_id}
          onArchived={onArchived}
          itemProps={nav.itemProps(session.adw_id)}
        />
      ))}

      {/*
        The ledger's bottom edge. Rows end at a hairline and the page keeps
        going, so without this the wall of runs reads as cut off rather than
        finished — and the archive button silently removes rows with nothing on
        screen saying where they went.
      */}
      {ordered.length > 0 ? (
        <div className={s.foot}>
          <Stamp>j k move · enter open · × archive</Stamp>
          <Stamp className={s.footRight}>
            {ordered.length} shown · archived runs hidden
          </Stamp>
        </div>
      ) : null}

      {ordered.length > 0 ? null : loaded ? (
        <div className={s.state}>
          <EmptyState
            title="No runs recorded"
            body={
              <>
                The trace database exists but holds no sessions. Every{' '}
                <code className={s.code}>just</code> recipe that runs an agent writes one.
              </>
            }
            command="just demo"
            action={{ label: '→ all commands', href: '#/docs' }}
          />
        </div>
      ) : !error ? (
        <div className={s.state}>
          <LoadingPlate label="Reading trace db…" rows={6} />
        </div>
      ) : null}
    </div>
  )
}
