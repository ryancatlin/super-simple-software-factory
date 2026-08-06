import { useCallback, useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/TopBar'
import { useNow } from '@/hooks/useNow'
import { usePoll } from '@/hooks/usePoll'
import { useRoute } from '@/router/useRoute'
import { isDocsRoute } from '@/router'
import { fetchHealth } from '@/lib/api'
import type { Phase } from '@/lib/types'
import { CommandPalette } from '@/views/docs/CommandPalette'
import { DocsView } from '@/views/docs/DocsView'
import { SessionsList } from '@/views/sessions/SessionsList'
import { SessionTrace } from '@/views/trace/SessionTrace'
import s from './App.module.css'

/** Published by SessionTrace so the topbar and palette can see into the open run. */
export interface TraceSnapshot {
  adwId: string
  phases: Phase[]
  /** Display name of the selected phase, for the breadcrumb. Null when none selected. */
  phaseLabel: string | null
}

/** Health of the polling loops, surfaced by the live indicator. */
export type LiveState = 'live' | 'stale' | 'offline'

/** What every view reports back so the head-plate can show one honest lamp. */
export interface PollHealth {
  lastOkAt: number | null
  error: string | null
  attempts: number
}

const EMPTY_HEALTH: PollHealth = { lastOkAt: null, error: null, attempts: 0 }

// Thresholds for the live lamp, in ms since the last successful poll.
const STALE_AFTER_MS = 2500
const OFFLINE_AFTER_MS = 8000

/**
 * The lamp's own heartbeat, independent of whatever view is mounted.
 *
 * A view's data poll is the better evidence — it is the request the user is
 * actually waiting on — but not every view has one: docs polls nothing, so
 * without this the lamp would sit on the last trace's timestamp and decay to
 * OFFLINE while the server is perfectly healthy. /api/health exists for exactly
 * this question, and it also names the db the lamp is speaking for.
 *
 * Below STALE_AFTER_MS so the heartbeat alone can hold the lamp LIVE.
 */
const HEALTH_POLL_MS = 2000

function liveState(error: string | null, ageMs: number | null): LiveState {
  if (ageMs == null) return error ? 'offline' : 'stale'
  if (error != null || ageMs > OFFLINE_AFTER_MS) return 'offline'
  return ageMs < STALE_AFTER_MS ? 'live' : 'stale'
}

export function App() {
  const route = useRoute()
  const [snapshot, setSnapshot] = useState<TraceSnapshot | null>(null)
  const [health, setHealth] = useState<PollHealth>(EMPTY_HEALTH)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const { adwId, phaseId } = route
  const isDocs = isDocsRoute(route)

  // A different run is a different snapshot; drop the old one before the new
  // trace mounts so the breadcrumb never shows the previous run's phase.
  useEffect(() => {
    setSnapshot(null)
  }, [adwId])

  // Poll health belongs to the view that reported it. Leaving a failing trace
  // for docs — which reports nothing — would otherwise strand its error here
  // and hold the lamp OFFLINE forever.
  const viewKey = isDocs ? 'docs' : (adwId ?? 'sessions')
  useEffect(() => {
    setHealth(EMPTY_HEALTH)
  }, [viewKey])

  const onSnapshot = useCallback((next: TraceSnapshot) => setSnapshot(next), [])

  // Views call this on every poll; bail out on an unchanged value so a 500ms
  // tick does not re-render the whole shell.
  const onPollHealth = useCallback((next: PollHealth) => {
    setHealth((prev) =>
      prev.lastOkAt === next.lastOkAt &&
      prev.error === next.error &&
      prev.attempts === next.attempts
        ? prev
        : next,
    )
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const heartbeat = usePoll(fetchHealth, HEALTH_POLL_MS)

  const now = useNow(1000)
  // Either channel answering counts as the server answering; either failing is
  // a failure worth showing, and the view's own error wins the message.
  const lastOkAt = Math.max(health.lastOkAt ?? 0, heartbeat.lastOkAt ?? 0) || null
  const pollError = health.error ?? heartbeat.error
  const lastOkAgeMs = lastOkAt == null ? null : Math.max(0, now - lastOkAt)
  const live = liveState(pollError, lastOkAgeMs)

  // The lamp says the server is up; hovering it says which db it is up on.
  const liveTitle = useMemo(() => {
    const h = heartbeat.data
    if (!h) return undefined
    return `${h.db}\n${h.sessions} sessions · journal_mode ${h.journal_mode}`
  }, [heartbeat.data])

  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  return (
    <>
      <TopBar
        route={route}
        phaseLabel={snapshot?.phaseLabel ?? null}
        live={live}
        lastOkAgeMs={lastOkAgeMs}
        liveTitle={liveTitle}
        onOpenPalette={openPalette}
      />
      <main className={s.main}>
        {isDocs ? (
          <DocsView />
        ) : !adwId ? (
          <SessionsList onPollHealth={onPollHealth} />
        ) : (
          // The key remounts the trace when the session changes — that is how
          // all cursor and event state resets.
          <SessionTrace
            key={adwId}
            adwId={adwId}
            phaseId={phaseId}
            onSnapshot={onSnapshot}
            onPollHealth={onPollHealth}
          />
        )}
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} snapshot={snapshot} />
    </>
  )
}
