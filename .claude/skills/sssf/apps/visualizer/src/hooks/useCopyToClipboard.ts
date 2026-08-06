import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Returns [copiedText, copy]. `copiedText` resets to null after `resetMs`.
 * A clipboard rejection is silent by design — the text stays selectable, and a
 * red toast for a denied permission would be worse than no feedback.
 */
export function useCopyToClipboard(resetMs = 1400): [string | null, (text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const copy = useCallback(
    (text: string) => {
      if (!navigator.clipboard) return
      navigator.clipboard
        .writeText(text)
        .then(() => {
          if (!aliveRef.current) return
          setCopied(text)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            if (aliveRef.current) setCopied(null)
          }, resetMs)
        })
        .catch(() => {
          /* denied or unavailable — the text stays selectable */
        })
    },
    [resetMs],
  )

  return [copied, copy]
}
