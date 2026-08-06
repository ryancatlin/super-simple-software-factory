import { useEffect, useRef, useState } from 'react'

// Long enough for the deepest staggered item to finish: --stagger-cap (11) ×
// --stagger-step (22ms) + --dur-4 (320ms) ≈ 562ms.
const REVEAL_WINDOW_MS = 900

/**
 * True only for the first paint after data first arrives. Gates `.stagger-item`
 * so the 500ms poll never re-triggers the reveal — the single most common way
 * a live-polling list ends up flickering.
 */
export function useFirstPaint(ready: boolean): boolean {
  const [revealing, setRevealing] = useState(false)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!ready || firedRef.current) return
    firedRef.current = true
    setRevealing(true)
    const id = setTimeout(() => setRevealing(false), REVEAL_WINDOW_MS)
    return () => clearTimeout(id)
  }, [ready])

  return revealing
}
