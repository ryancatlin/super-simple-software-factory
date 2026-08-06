import { fetchSessions } from '@/lib/api'
import type { SessionSummary } from '@/lib/types'
import { usePoll } from './usePoll'
import type { PollState } from './usePoll'

/** The ledger's data layer: /api/sessions every 500ms, in-flight suppressed. */
export function useSessions(intervalMs = 500): PollState<SessionSummary[]> {
  return usePoll(fetchSessions, intervalMs)
}
