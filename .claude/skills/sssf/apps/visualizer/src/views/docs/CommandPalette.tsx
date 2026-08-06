import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TraceSnapshot } from '@/App'
import { Stamp } from '@/components/Stamp'
import { StatusChip } from '@/components/StatusChip'
import { cx } from '@/components/cx'
import { useNow } from '@/hooks/useNow'
import { usePoll } from '@/hooks/usePoll'
import { archiveSession, fetchSessions } from '@/lib/api'
import { fmtDuration, ts } from '@/lib/format'
import type { SessionSummary } from '@/lib/types'
import { navigate } from '@/router'
import { fuzzyMatch, segments } from './fuzzy'
import s from './CommandPalette.module.css'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** The currently viewed run, when any — supplies the PHASES group and the ACTIONS group. */
  snapshot: TraceSnapshot | null
}

/** The palette is the only thing in the app that polls on demand, and only while open. */
const INDEX_POLL_MS = 5000
/** Enough rows to find anything, few enough that the list never becomes a scroll chore. */
const MAX_ROWS = 40

type Kind = 'run' | 'phase' | 'page' | 'action'

interface Item {
  id: string
  kind: Kind
  /** The stamped kind cell. */
  tag: string
  primary: string
  secondary: string | null
  /** Everything the query is matched against. */
  haystack: string
  status: string | null
  durationMs: number | null
  activate: () => void
}

interface Row {
  item: Item
  score: number
  /** Match ranges inside `primary`, for the <mark> runs. */
  ranges: [number, number][]
  /** Position in the flattened, rendered list — the keyboard index. */
  index: number
}

interface RowGroup {
  kind: Kind
  label: string
  rows: Row[]
}

const GROUP_LABELS: { kind: Kind; label: string }[] = [
  { kind: 'run', label: 'Runs' },
  { kind: 'phase', label: 'Phases' },
  { kind: 'page', label: 'Pages' },
  { kind: 'action', label: 'Actions' },
]

function spanMs(startIso: string | null, endIso: string | null, running: boolean, now: number) {
  const start = ts(startIso)
  if (!Number.isFinite(start)) return null
  const end = running ? now : ts(endIso)
  if (!Number.isFinite(end)) return null
  return Math.max(0, end - start)
}

function join(parts: (string | null | undefined)[], sep: string): string | null {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()))
  return kept.length ? kept.join(sep) : null
}

function buildIndex(
  sessions: SessionSummary[],
  snapshot: TraceSnapshot | null,
  now: number,
): Item[] {
  const items: Item[] = []

  // Runs — newest first, the ledger's own order.
  const runs = sessions.toSorted((a, b) => (ts(b.started_at) || 0) - (ts(a.started_at) || 0))
  for (const run of runs) {
    items.push({
      id: `run:${run.adw_id}`,
      kind: 'run',
      tag: 'session',
      primary: run.adw_id,
      secondary: join([run.request, run.adw_name], ' · '),
      haystack: join([run.adw_id, run.adw_name, run.request], ' ') ?? run.adw_id,
      status: run.status,
      durationMs: spanMs(run.started_at, run.ended_at, run.status === 'running', now),
      activate: () => navigate(run.adw_id),
    })
  }

  // Phases — of the run being viewed, in seq order.
  if (snapshot) {
    const phases = snapshot.phases.toSorted((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    for (const phase of phases) {
      const name = phase.name ?? phase.phase_id
      items.push({
        id: `phase:${phase.phase_id}`,
        kind: 'phase',
        tag: 'phase',
        primary: name,
        secondary: join([phase.owner, phase.description], ' · '),
        haystack: join([phase.name, phase.owner, phase.description], ' ') ?? name,
        status: phase.status,
        durationMs: spanMs(
          phase.started_at,
          phase.ended_at,
          phase.status === 'running',
          now,
        ),
        activate: () => navigate(snapshot.adwId, phase.phase_id),
      })
    }
  }

  // Pages — always reachable, so the palette is never a dead end.
  items.push({
    id: 'page:sessions',
    kind: 'page',
    tag: 'page',
    primary: 'sessions',
    secondary: 'every run the trace database holds',
    haystack: 'sessions runs ledger home',
    status: null,
    durationMs: null,
    activate: () => navigate(),
  })
  items.push({
    id: 'page:docs',
    kind: 'page',
    tag: 'page',
    primary: 'docs',
    secondary: 'every recipe the justfile ships',
    haystack: 'docs commands justfile recipes',
    status: null,
    durationMs: null,
    activate: () => navigate('docs'),
  })

  // Actions — only meaningful with a run open.
  if (snapshot) {
    const { adwId } = snapshot
    items.push({
      id: 'action:copy-id',
      kind: 'action',
      tag: 'action',
      primary: 'copy adw id',
      secondary: adwId,
      haystack: `copy adw id ${adwId}`,
      status: null,
      durationMs: null,
      activate: () => {
        navigator.clipboard?.writeText(adwId).catch(() => {
          /* denied or unavailable — the id is still selectable in the crumb */
        })
      },
    })
    items.push({
      id: 'action:archive',
      kind: 'action',
      tag: 'action',
      primary: 'archive this run',
      secondary: 'remove it from the review list',
      haystack: 'archive this run remove review',
      status: null,
      durationMs: null,
      activate: () => {
        archiveSession(adwId)
          .then(() => navigate())
          .catch(() => {
            /* the ledger's own poll re-syncs the truth */
          })
      },
    })
  }

  return items
}

export function CommandPalette({ open, onClose, snapshot }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const rowsRef = useRef(new Map<string, HTMLElement>())

  // Built on open, refreshed while open, silent when closed.
  const sessions = usePoll(fetchSessions, INDEX_POLL_MS, { enabled: open })
  const now = useNow(1000, open)

  const items = useMemo(
    () => buildIndex(sessions.data ?? [], snapshot, now),
    [sessions.data, snapshot, now],
  )

  const { groups, flat } = useMemo(() => {
    const q = query.trim()
    const scored: { item: Item; score: number; ranges: [number, number][] }[] = []
    for (const item of items) {
      const hit = fuzzyMatch(q, item.haystack)
      if (!hit) continue
      // Score on everything; highlight only what is actually on screen.
      const inPrimary = q ? fuzzyMatch(q, item.primary) : null
      scored.push({ item, score: hit.score, ranges: inPrimary?.ranges ?? [] })
    }
    // toSorted is stable, so ties keep their natural order.
    const ranked = q ? scored.toSorted((a, b) => b.score - a.score) : scored
    const capped = ranked.slice(0, MAX_ROWS)

    const grouped = GROUP_LABELS.map(({ kind, label }) => ({
      kind,
      label,
      hits: capped.filter((r) => r.item.kind === kind),
    })).filter((g) => g.hits.length > 0)

    // With a query the best-matching group leads, so the pre-selected first row
    // is always the best answer; with no query the natural order stands.
    const buckets = q
      ? grouped.toSorted(
          (a, b) =>
            Math.max(...b.hits.map((h) => h.score)) - Math.max(...a.hits.map((h) => h.score)),
        )
      : grouped

    // One pass assigns every row its flat keyboard index as it lands.
    const flattened: Row[] = []
    const built: RowGroup[] = buckets.map((g) => ({
      kind: g.kind,
      label: g.label,
      rows: g.hits.map((hit) => {
        const row: Row = { ...hit, index: flattened.length }
        flattened.push(row)
        return row
      }),
    }))

    return { groups: built, flat: flattened }
  }, [items, query])

  const activeRow = flat[active] ?? null
  const activeId = activeRow ? `cmdk-opt-${activeRow.index}` : undefined

  // A new query is a new list; start at the top.
  useEffect(() => {
    setActive(0)
  }, [query])

  // Opening is a fresh start: empty query, top row, focus in the input.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()

    // Lock #root rather than body, so the scrollbar stays and nothing shifts.
    const root = document.getElementById('root')
    const previousOverflow = root?.style.overflow ?? ''
    if (root) root.style.overflow = 'hidden'

    // The trap: anything that steals focus is handed straight back.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (target instanceof Node && panelRef.current && !panelRef.current.contains(target)) {
        inputRef.current?.focus()
      }
    }
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      if (root) root.style.overflow = previousOverflow
      restoreRef.current?.focus()
    }
  }, [open])

  // Keep the selection inside the list as it shrinks under the query.
  useEffect(() => {
    setActive((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    if (!activeRow) return
    rowsRef.current.get(activeRow.item.id)?.scrollIntoView({ block: 'nearest' })
  }, [activeRow])

  const move = useCallback(
    (delta: number) => {
      setActive((i) => {
        const n = flat.length
        if (n === 0) return 0
        return (i + delta + n) % n
      })
    },
    [flat.length],
  )

  const choose = useCallback(
    (row: Row | null) => {
      if (!row) return
      row.item.activate()
      onClose()
    },
    [onClose],
  )

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const key = e.key
      if (key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey
      if (key === 'ArrowDown' || (key === 'Tab' && !e.shiftKey) || (ctrl && key.toLowerCase() === 'n')) {
        e.preventDefault()
        move(1)
        return
      }
      if (key === 'ArrowUp' || (key === 'Tab' && e.shiftKey) || (ctrl && key.toLowerCase() === 'p')) {
        e.preventDefault()
        move(-1)
        return
      }
      if (key === 'Home') {
        e.preventDefault()
        setActive(0)
        return
      }
      if (key === 'End') {
        e.preventDefault()
        setActive(Math.max(0, flat.length - 1))
        return
      }
      if (key === 'Enter') {
        e.preventDefault()
        choose(activeRow)
      }
    },
    [onClose, move, flat.length, choose, activeRow],
  )

  if (!open) return null

  const count = flat.length
  const indexFailed = sessions.error != null && (sessions.data?.length ?? 0) === 0

  return (
    <>
      <button type="button" className={s.scrim} aria-label="Close command palette" onClick={onClose} />
      <div
        ref={panelRef}
        className={cx('plate', s.panel)}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className={s.inputRow}>
          <span className={s.caret} aria-hidden="true">
            &gt;
          </span>
          <input
            ref={inputRef}
            className={s.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="jump to a run, a phase, or a page"
            spellCheck={false}
            autoComplete="off"
            aria-label="Command palette search"
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
          />
        </div>

        <div className={s.results} id="cmdk-list" role="listbox" aria-label="Palette results">
          {indexFailed ? (
            <p className={s.warn}>
              <Stamp tone="fail">index unavailable</Stamp> {sessions.error}
            </p>
          ) : null}

          {count === 0 ? (
            <div className={s.empty}>
              <Stamp as="div">No match</Stamp>
              <p className={s.emptyBody}>
                Nothing in this run’s index matches that. Try an adw id, a phase name, or{' '}
                <code className={cx('well', s.inline)}>docs</code>.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.kind} className={s.group} role="group" aria-labelledby={`cmdk-grp-${group.kind}`}>
                <div className={cx('stamp', s.groupHead)} id={`cmdk-grp-${group.kind}`}>
                  {group.label}
                </div>
                {group.rows.map((row) => (
                  <button
                    key={row.item.id}
                    type="button"
                    role="option"
                    id={`cmdk-opt-${row.index}`}
                    aria-selected={row.index === active}
                    className={cx(s.row, row.index === active && s.active)}
                    ref={(el) => {
                      if (el) rowsRef.current.set(row.item.id, el)
                      else rowsRef.current.delete(row.item.id)
                    }}
                    onMouseMove={() => {
                      if (row.index !== active) setActive(row.index)
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(row)}
                  >
                    <span className={cx('stamp', s.tag)}>{row.item.tag}</span>
                    <span className={s.primary} title={row.item.primary}>
                      {segments(row.item.primary, row.ranges).map((seg) =>
                        seg.hit ? (
                          <mark key={seg.start} className={s.mark}>
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={seg.start}>{seg.text}</span>
                        ),
                      )}
                    </span>
                    <span className={s.secondary} title={row.item.secondary ?? undefined}>
                      {row.item.secondary}
                    </span>
                    <span className={s.trail}>
                      {row.item.status ? <StatusChip status={row.item.status} compact /> : null}
                      {row.item.durationMs != null ? (
                        <span className={cx('tnum', s.duration)}>{fmtDuration(row.item.durationMs)}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <div className={s.footer}>
          <span className={cx('stamp', s.keys)}>↑↓ move · ↵ open · esc close</span>
          <span className={cx('stamp', 'tnum', s.count)}>
            {count} {count === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </>
  )
}
