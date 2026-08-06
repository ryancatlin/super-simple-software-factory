import { useEffect, useState } from 'react'

/**
 * Date.now() on an interval — the only source of "now" for rendering, so every
 * live number in a view ticks on the same edge. `active: false` freezes the
 * value and clears the timer (a finished run must not burn 4 Hz forever).
 */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])

  return now
}
