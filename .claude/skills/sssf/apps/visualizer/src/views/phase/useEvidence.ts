import { useEffect, useMemo, useState } from 'react'
import { fetchEvidence } from '@/lib/api'
import type { EvidenceFile, EvidenceResponse } from '@/lib/api'

export interface EvidencePanelRow {
  dir: string
  images: EvidenceFile[]
  texts: EvidenceFile[]
}

/**
 * Validation evidence for the flows THIS phase recorded.
 *
 * Evidence is on disk, not in the db, so it is refetched per phase selection —
 * a mid-run capture shows what exists right now. No flows means no request at
 * all, and a failed listing means no section rather than an error banner.
 *
 * `flowDirs` must be referentially stable across polls (the caller memoises it
 * on the joined key); the effect keys off it directly.
 */
export function useEvidence(
  adwId: string,
  phaseId: string,
  flowDirs: readonly string[],
): { panels: EvidencePanelRow[]; count: number } {
  const [response, setResponse] = useState<EvidenceResponse | null>(null)

  useEffect(() => {
    if (flowDirs.length === 0) {
      setResponse(null)
      return
    }
    let alive = true
    fetchEvidence(adwId)
      .then((result) => {
        if (alive) setResponse(result)
      })
      .catch(() => {
        if (alive) setResponse(null)
      })
    return () => {
      alive = false
    }
  }, [adwId, phaseId, flowDirs])

  const panels = useMemo<EvidencePanelRow[]>(() => {
    if (!response) return []
    const wanted = new Set(flowDirs)
    return response.flows
      .filter((f) => wanted.has(f.dir))
      .map((f) => ({
        dir: f.dir,
        images: f.files.filter((x) => x.name.endsWith('.png')),
        // toolkit.txt first — it is the index of everything else in the dir.
        texts: f.files
          .filter((x) => !x.name.endsWith('.png'))
          .toSorted((a, b) =>
            a.name === 'toolkit.txt'
              ? -1
              : b.name === 'toolkit.txt'
                ? 1
                : a.name.localeCompare(b.name),
          ),
      }))
  }, [response, flowDirs])

  const count = useMemo(
    () => panels.reduce((n, f) => n + f.images.length + f.texts.length, 0),
    [panels],
  )

  return { panels, count }
}
