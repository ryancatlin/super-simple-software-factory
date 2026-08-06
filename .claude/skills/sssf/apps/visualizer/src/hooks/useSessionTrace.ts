import { useCallback, useEffect, useState } from 'react'
import { fetchEnvelopes, fetchEvents, fetchGates, fetchSession } from '@/lib/api'
import type {
  AgentSession,
  Envelope,
  EventRow,
  GateResult,
  Phase,
  Session,
  SessionUsage,
} from '@/lib/types'
import type { PollState } from './usePoll'

export interface TraceData {
  session: Session | null
  /** Sorted by seq asc. */
  phases: Phase[]
  agents: AgentSession[]
  /** { read, written }, defaulted to zeros. */
  usage: SessionUsage
  /** Accumulated, insertion order. */
  events: EventRow[]
  envelopes: Envelope[]
  gates: GateResult[]
}

const TICK_MS = 500
const PAGE_LIMIT = 1000
const EMPTY_USAGE: SessionUsage = { read: 0, written: 0 }

/**
 * The only event types that can change the envelopes or gates tables. Refetching
 * those two tables on every 500ms tick is the difference between a trace view
 * that idles and one that hammers the db for a long-running session — this set
 * is a load-bearing performance decision, not an optimisation.
 */
const SIDE_TABLE_TYPES = new Set([
  'gate_pass',
  'gate_fail',
  'handoff',
  'agent_end',
  'phase_end',
  'error',
])

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The trace view's whole data layer. One tick: fetchSession → drain events →
 * refetch envelopes+gates only on first load or when a fresh event touched a
 * side table.
 */
export function useSessionTrace(adwId: string): TraceData & Omit<PollState<unknown>, 'data'> {
  const [session, setSession] = useState<Session | null>(null)
  const [phases, setPhases] = useState<Phase[]>([])
  const [agents, setAgents] = useState<AgentSession[]>([])
  const [usage, setUsage] = useState<SessionUsage>(EMPTY_USAGE)
  const [events, setEvents] = useState<EventRow[]>([])
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [gates, setGates] = useState<GateResult[]>([])

  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [lastOkAt, setLastOkAt] = useState<number | null>(null)
  const [attempts, setAttempts] = useState(0)

  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    let inFlight = false
    let firstLoad = true
    let cursor = 0

    const tick = async () => {
      if (!alive || inFlight) return
      inFlight = true
      try {
        const detail = await fetchSession(adwId)
        if (!alive) return
        setSession(detail.session)
        setPhases(detail.phases.toSorted((a, b) => (a.seq ?? 0) - (b.seq ?? 0)))
        setAgents(detail.agents)
        setUsage(detail.usage ?? EMPTY_USAGE)

        const fresh: EventRow[] = []
        let hasMore = true
        while (hasMore) {
          // oxlint-disable-next-line no-await-in-loop -- a cursor drain is inherently sequential
          const page = await fetchEvents(adwId, cursor, PAGE_LIMIT)
          fresh.push(...page.events)
          cursor = Math.max(cursor, page.cursor)
          hasMore = page.has_more
        }
        if (!alive) return
        if (fresh.length > 0) setEvents((prev) => [...prev, ...fresh])

        const touched = fresh.some((e) => e.type != null && SIDE_TABLE_TYPES.has(e.type))
        if (firstLoad || touched) {
          const [nextEnvelopes, nextGates] = await Promise.all([
            fetchEnvelopes(adwId),
            fetchGates(adwId),
          ])
          if (!alive) return
          setEnvelopes(nextEnvelopes)
          setGates(nextGates)
        }

        firstLoad = false
        setError(null)
        setLoaded(true)
        setLastOkAt(Date.now())
        setAttempts(0)
      } catch (err) {
        if (!alive) return
        setError(message(err))
        setAttempts((n) => n + 1)
      } finally {
        inFlight = false
      }
    }

    void tick()
    const id = setInterval(() => void tick(), TICK_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [adwId, nonce])

  return {
    session,
    phases,
    agents,
    usage,
    events,
    envelopes,
    gates,
    error,
    loaded,
    lastOkAt,
    attempts,
    refresh,
  }
}
