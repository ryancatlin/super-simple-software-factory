import { useMemo } from 'react'
import { cx } from '@/components/cx'
import { eventLabel } from '@/lib/events'
import { axisTicks, fmtOffset, ts } from '@/lib/format'
import type { EventRow, SessionSummary } from '@/lib/types'
import { laneColor, eventDotColor } from '@/theme/palette'
import s from './SessionTraceStrip.module.css'

export interface SessionTraceStripProps {
  session: SessionSummary
  events: EventRow[]
  nowMs: number
}

interface TimelineDot {
  id: string
  xPct: number
  color: string
  title: string
}

interface TimelineRow {
  owner: string
  color: string
  title: string
  dots: TimelineDot[]
}

/**
 * The row has a fixed rhythm, so the strip gets exactly MAX_VISIBLE_ROWS slots.
 * A roster that overflows spends one slot on the "+N more" line and shows
 * MIN_VISIBLE_ROWS agents in the rest — never fewer than three, so a five-agent
 * chain still reads as a chain rather than as a pair and a count.
 */
const MAX_VISIBLE_ROWS = 4
const MIN_VISIBLE_ROWS = 3

function finiteTimes(events: EventRow[]): number[] {
  return events.map((e) => ts(e.started_at)).filter((t) => Number.isFinite(t))
}

/**
 * The per-agent event timeline under each ledger row — DESIGN_SPEC §5.2.
 * Machined 6px square marks on a hairline track, one track per agent, over a
 * five-tick offset axis. Hidden below 860px, where the row is identity only.
 */
export function SessionTraceStrip({ session, events, nowMs }: SessionTraceStripProps) {
  const running = session.status === 'running'

  // Real bounds where the session has them; the event tail is the fallback, so
  // a run whose header timestamps never landed still draws honestly.
  const range = useMemo(() => {
    const times = finiteTimes(events)
    let t0 = ts(session.started_at)
    if (!Number.isFinite(t0)) t0 = Math.min(...times)
    if (!Number.isFinite(t0)) t0 = nowMs
    let t1 = running ? nowMs : ts(session.ended_at)
    if (!Number.isFinite(t1)) t1 = Math.max(...times)
    if (!Number.isFinite(t1)) t1 = t0 + 1000
    return { t0, span: Math.max(t1 - t0, 1000) }
  }, [session.started_at, session.ended_at, running, events, nowMs])

  const ticks = useMemo(() => axisTicks(range.span, 5), [range.span])

  // Events attribute to an agent through their phase's owner.
  const { rows, latestId } = useMemo(() => {
    const owners: string[] = []
    const ownerByPhase = new Map<string, string>()
    for (const p of session.phases ?? []) {
      if (p.kind !== 'agent' || !p.owner) continue
      ownerByPhase.set(p.phase_id, p.owner)
      if (!owners.includes(p.owner)) owners.push(p.owner)
    }
    if (owners.length === 0) return { rows: [] as TimelineRow[], latestId: null }

    const { t0, span } = range
    const byOwner = new Map<string, TimelineDot[]>(owners.map((o) => [o, []]))
    let latest: string | null = null
    let latestT = -Infinity

    for (const e of events) {
      const owner = e.phase_id ? ownerByPhase.get(e.phase_id) : undefined
      const color = eventDotColor(e.type)
      if (!owner || !color) continue
      const t = ts(e.started_at)
      if (!Number.isFinite(t)) continue
      byOwner.get(owner)?.push({
        id: e.event_id,
        xPct: Math.min(Math.max(((t - t0) / span) * 100, 0), 100),
        color,
        title: `${e.type} ${eventLabel(e)} at ${fmtOffset(t - t0)}`,
      })
      if (t >= latestT) {
        latestT = t
        latest = e.event_id
      }
    }

    // /api/sessions embeds agents so the labels can use config colours with no
    // extra request; historical sessions return color null → fallback palette.
    const built = owners.map<TimelineRow>((owner, i) => {
      const info = (session.agents ?? []).find((a) => a.agent === owner)
      return {
        owner,
        color: laneColor(info?.color, null, i),
        title: info?.model ? `${owner} ${info.model}` : owner,
        dots: byOwner.get(owner) ?? [],
      }
    })

    return { rows: built, latestId: latest }
  }, [session.phases, session.agents, events, range])

  if (rows.length === 0) {
    return (
      <div className={cx(s.strip, s.idle)}>
        <span className="stamp">no agent activity yet</span>
      </div>
    )
  }

  const overflowing = rows.length > MAX_VISIBLE_ROWS
  const visible = overflowing ? rows.slice(0, MIN_VISIBLE_ROWS) : rows
  const hidden = overflowing ? rows.length - MIN_VISIBLE_ROWS : 0

  return (
    <div className={s.strip}>
      <div className={s.axis}>
        <span className={s.label} />
        <span className={s.scale}>
          {ticks.map((t) => (
            <span
              key={t.pct}
              className={cx(s.tick, t.pct === 0 && s.first, 'tnum')}
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </span>
      </div>

      {visible.map((row) => (
        <div key={row.owner} className={s.lane}>
          <span className={s.label} style={{ color: row.color }} title={row.title}>
            {row.owner}
          </span>
          <span className={s.track}>
            {row.dots.map((dot) => {
              const isLatest = running && dot.id === latestId
              return (
                <span
                  key={dot.id}
                  className={cx(s.dot, isLatest && s.latest)}
                  style={{ left: `${dot.xPct}%`, background: dot.color }}
                  title={dot.title}
                />
              )
            })}
          </span>
        </div>
      ))}

      {hidden > 0 ? (
        <div className={s.more}>
          <span className="stamp">+{hidden} more agents</span>
        </div>
      ) : null}
    </div>
  )
}
