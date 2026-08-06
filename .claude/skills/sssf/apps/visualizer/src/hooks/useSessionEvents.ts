import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchEvents } from '@/lib/api'
import type { EventRow } from '@/lib/types'

export interface EventTail {
  events: EventRow[]
  cursor: number
}

const PAGE_LIMIT = 1000

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Cursor-drain event tail for one session.
 *
 * Drains `has_more` pages in a loop before resolving, appends to an accumulated
 * array, and stops polling once `running` goes false — with one final drain on
 * that transition, so the last events of a run are never missed.
 */
export function useSessionEvents(
  adwId: string,
  running: boolean,
  intervalMs = 500,
  pageLimit = PAGE_LIMIT,
): { events: EventRow[]; error: string | null } {
  const [events, setEvents] = useState<EventRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const cursorRef = useRef(0)
  const aliveRef = useRef(true)
  const inFlightRef = useRef(false)
  const wasRunningRef = useRef(false)

  const drain = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const fresh: EventRow[] = []
      let hasMore = true
      while (hasMore) {
        // oxlint-disable-next-line no-await-in-loop -- a cursor drain is inherently sequential
        const page = await fetchEvents(adwId, cursorRef.current, pageLimit)
        fresh.push(...page.events)
        cursorRef.current = Math.max(cursorRef.current, page.cursor)
        hasMore = page.has_more
      }
      if (!aliveRef.current) return
      if (fresh.length > 0) setEvents((prev) => [...prev, ...fresh])
      setError(null)
    } catch (err) {
      if (aliveRef.current) setError(message(err))
    } finally {
      inFlightRef.current = false
    }
  }, [adwId, pageLimit])

  // A new session is a new tail: reset the cursor and the accumulator.
  useEffect(() => {
    aliveRef.current = true
    cursorRef.current = 0
    setEvents([])
    void drain()
    return () => {
      aliveRef.current = false
    }
  }, [drain])

  useEffect(() => {
    if (!running) {
      // Transition out of running: one last drain, then the timer stays dead.
      if (wasRunningRef.current) {
        wasRunningRef.current = false
        void drain()
      }
      return
    }
    wasRunningRef.current = true
    const id = setInterval(() => void drain(), intervalMs)
    return () => clearInterval(id)
  }, [running, intervalMs, drain])

  return { events, error }
}
