import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PollHealth, TraceSnapshot } from '@/App'
import { cx } from '@/components/cx'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBar } from '@/components/ErrorBar'
import { LoadingPlate } from '@/components/LoadingPlate'
import { Readout } from '@/components/Readout'
import { Stamp } from '@/components/Stamp'
import { STAT_TITLES } from '@/components/StatChip'
import { StatusChip } from '@/components/StatusChip'
import { useFirstPaint } from '@/hooks/useFirstPaint'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useNow } from '@/hooks/useNow'
import { useSessionTrace } from '@/hooks/useSessionTrace'
import { fmtCost, fmtDate, fmtDuration, fmtTokens, payloadOk, ts } from '@/lib/format'
import type { Phase } from '@/lib/types'
import { navigate } from '@/router'
import { PhaseDetail } from '@/views/phase/PhaseDetail'
import { buildLanes } from './lanes'
import { QueueGutter } from './QueueGutter'
import { TimeAxis } from './TimeAxis'
import { TraceLane } from './TraceLane'
import { buildTimeScale } from './timeScale'
import s from './SessionTrace.module.css'

export interface SessionTraceProps {
  adwId: string
  phaseId: string | null
  onSnapshot: (s: TraceSnapshot) => void
  onPollHealth: (h: PollHealth) => void
}

/** 4 Hz while the run is live: the NOW line, the elapsed readout, running blocks. */
const LIVE_TICK_MS = 250

export function SessionTrace({ adwId, phaseId, onSnapshot, onPollHealth }: SessionTraceProps) {
  const { session, phases, agents, usage, events, envelopes, gates, error, loaded, attempts, lastOkAt } =
    useSessionTrace(adwId)

  const running = session?.status === 'running'
  const nowMs = useNow(LIVE_TICK_MS, running)

  useEffect(() => {
    onPollHealth({ lastOkAt, error, attempts })
  }, [onPollHealth, lastOkAt, error, attempts])

  const selected = phaseId == null ? null : (phases.find((p) => p.phase_id === phaseId) ?? null)
  const phaseLabel = selected?.name ?? null

  useEffect(() => {
    onSnapshot({ adwId, phases, phaseLabel })
  }, [onSnapshot, adwId, phases, phaseLabel])

  // ── derived geometry ───────────────────────────────────────────────────────

  const lanes = useMemo(
    () => buildLanes(session, phases, agents, events),
    [session, phases, agents, events],
  )

  const scale = useMemo(
    () =>
      buildTimeScale(phases, ts(session?.started_at), ts(session?.ended_at), nowMs, running),
    [phases, session?.started_at, session?.ended_at, nowMs, running],
  )

  /**
   * Phase status is "did the phase machinery complete", not "did the app pass".
   * A validate phase succeeds by producing a coherent verdict — which may be a
   * red one. Surface that verdict on the block itself.
   */
  const verdicts = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const e of envelopes) {
      if (!e.phase_id || !e.payload_json) continue
      try {
        const payload = JSON.parse(e.payload_json) as Record<string, unknown>
        if (typeof payload.passed === 'boolean') map[e.phase_id] = payload.passed
      } catch {
        // unparseable payloads simply carry no verdict
      }
    }
    return map
  }, [envelopes])

  const toolTicks = useMemo(() => {
    const map: Record<string, { t: number; ok: boolean }[]> = {}
    for (const e of events) {
      if (e.type !== 'tool_call' || !e.phase_id) continue
      const list = (map[e.phase_id] ??= [])
      list.push({ t: ts(e.started_at), ok: payloadOk(e.payload_json) })
    }
    return map
  }, [events])

  /**
   * The label-overflow rule needs the track's px width. A ref + effect cannot
   * supply it here: the effect depends only on the ref object, so an element
   * that mounts after the first paint (the waterfall appears when the first poll
   * lands) is never observed. A React 19 cleanup ref measures on attach instead.
   */
  const [trackPx, setTrackPx] = useState(0)
  const measureTrack = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    setTrackPx(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setTrackPx(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── selection ──────────────────────────────────────────────────────────────

  const select = useCallback(
    (id: string) => navigate(adwId, id === phaseId ? null : id),
    [adwId, phaseId],
  )

  const [cursorPhaseId, setCursorPhaseId] = useState<string | null>(phaseId)

  const lanesRef = useRef(lanes)
  lanesRef.current = lanes

  const laneIds = useMemo(() => lanes.map((lane) => lane.id), [lanes])

  const phasesOf = useCallback((laneId: string): Phase[] => {
    const lane = lanesRef.current.find((l) => l.id === laneId)
    return lane ? [...lane.phases, ...lane.queued] : []
  }, [])

  const step = useCallback(
    (laneId: string, delta: number) => {
      const list = phasesOf(laneId)
      if (list.length === 0) return
      const at = list.findIndex((p) => p.phase_id === cursorPhaseId)
      const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : at + delta
      const target = list[Math.min(Math.max(next, 0), list.length - 1)]
      if (target) setCursorPhaseId(target.phase_id)
    },
    [cursorPhaseId, phasesOf],
  )

  const onActivate = useCallback(
    (laneId: string) => {
      const list = phasesOf(laneId)
      const target = list.find((p) => p.phase_id === cursorPhaseId) ?? list[0]
      if (target) select(target.phase_id)
    },
    [cursorPhaseId, phasesOf, select],
  )

  const onEscape = useCallback(() => {
    if (phaseId) navigate(adwId)
    else navigate()
  }, [adwId, phaseId])

  const nav = useListKeyboardNav({
    ids: laneIds,
    onActivate,
    onEscape,
    onLeft: (laneId) => step(laneId, -1),
    onRight: (laneId) => step(laneId, 1),
  })

  const { setSelectedId } = nav

  // A deep link arrives with a phase already chosen: put the keyboard cursor
  // (and the lane focus) where the URL says the user is.
  useEffect(() => {
    if (!phaseId) return
    setCursorPhaseId(phaseId)
    const lane = lanesRef.current.find((l) =>
      [...l.phases, ...l.queued].some((p) => p.phase_id === phaseId),
    )
    if (lane) setSelectedId(lane.id)
  }, [phaseId, loaded, setSelectedId])

  const containerRef = nav.containerProps.ref
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])

  // ── readouts ───────────────────────────────────────────────────────────────

  const sessionDurationMs = useMemo(() => {
    if (!session) return Number.NaN
    const start = ts(session.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = session.status === 'running' ? nowMs : ts(session.ended_at)
    return (Number.isFinite(end) ? end : nowMs) - start
  }, [session, nowMs])

  const reveal = useFirstPaint(loaded && phases.length > 0)

  return (
    <div className={s.trace} {...nav.containerProps}>
      {error ? (
        <ErrorBar message={error} attempts={attempts} lastOkAgeMs={null} sticky />
      ) : null}

      {session ? (
        <section className={cx('plate', s.spec)}>
          <h1 className={s.request} title={session.request ?? ''}>
            {session.request ?? '—'}
          </h1>
          <div className={s.cluster}>
            <Readout label="status" mono={false}>
              <StatusChip status={session.status ?? 'fail'} />
            </Readout>
            <Readout label="started">{fmtDate(session.started_at)}</Readout>
            <Readout label="elapsed" title={STAT_TITLES.runtime}>
              {fmtDuration(sessionDurationMs)}
            </Readout>
            <Readout label="cost" title={STAT_TITLES.cost}>
              {fmtCost(session.total_cost)}
            </Readout>
            <Readout label="tokens" title={STAT_TITLES.tokens}>
              {fmtTokens(session.total_tokens)}
            </Readout>
            <Readout label="read" title={STAT_TITLES.read}>
              {fmtTokens(usage.read)}
            </Readout>
            <Readout label="written" title={STAT_TITLES.written}>
              {fmtTokens(usage.written)}
            </Readout>
          </div>
        </section>
      ) : null}

      {phases.length > 0 ? (
        <>
          <div
            className={cx('plate', s.waterfall)}
            style={{ gridTemplateRows: `repeat(${lanes.length + 1}, auto)` }}
          >
            <div className={s.axisRail} style={{ gridColumn: 1, gridRow: 1 }}>
              <span className={cx('stamp', s.axisStamp)}>lane</span>
            </div>
            <div className={s.axisCell} style={{ gridColumn: 2, gridRow: 1 }} ref={measureTrack}>
              <TimeAxis scale={scale} nowMs={nowMs} running={running} t0={scale.t0} />
            </div>
            <div className={s.axisGutter} style={{ gridColumn: 3, gridRow: 1 }}>
              <span className={cx('stamp', s.axisStamp)}>queue</span>
            </div>

            {lanes.map((lane, i) => (
              <TraceLane
                key={lane.id}
                lane={lane}
                scale={scale}
                nowMs={nowMs}
                trackPx={trackPx}
                selectedPhaseId={phaseId}
                verdicts={verdicts}
                toolTicks={toolTicks}
                onSelect={select}
                laneSelected={lane.id === nav.selectedId}
                row={i + 2}
                cursorPhaseId={lane.id === nav.selectedId ? cursorPhaseId : null}
                reveal={reveal}
                itemProps={nav.itemProps(lane.id)}
              />
            ))}

            <QueueGutter lanes={lanes} selectedPhaseId={phaseId} onSelect={select} />

            {running ? (
              <div
                className={s.nowOverlay}
                style={{ gridColumn: 2, gridRow: '2 / -1' } as CSSProperties}
                aria-hidden="true"
              >
                <span className={s.nowLine} style={{ left: `calc(${scale.x(nowMs)}% - 1px)` }} />
              </div>
            ) : null}
          </div>

          <QueueGutter lanes={lanes} selectedPhaseId={phaseId} onSelect={select} inline />

          {/*
            The waterfall's foot. It closes the plate stack the way the ledger's
            does, and it is where the keys live: the lane grid is keyboard-first
            and nothing else on screen says so.
          */}
          <div className={s.foot}>
            <Stamp>j k lane · ← → phase · enter open · esc back</Stamp>
            <Stamp className={s.footRight}>
              {lanes.length} lanes · {phases.length} phases
            </Stamp>
          </div>
        </>
      ) : loaded ? (
        <EmptyState
          title="No phases recorded"
          body="This session id exists but no phase ever started. The workflow may have failed before its first phase, or the id may be from another repo's database."
          action={{ label: '← back to sessions', href: '#/' }}
        />
      ) : error ? null : (
        <LoadingPlate label="Reading trace…" />
      )}

      {selected ? (
        <PhaseDetail
          phase={selected}
          events={events}
          envelopes={envelopes}
          gates={gates}
          onClose={() => navigate(adwId)}
        />
      ) : null}
    </div>
  )
}
