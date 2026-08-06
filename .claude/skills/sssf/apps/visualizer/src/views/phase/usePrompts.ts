import { useEffect, useMemo, useState } from 'react'
import { fetchPrompts } from '@/lib/api'
import type { PromptsResponse } from '@/lib/api'

export type PromptsState = 'idle' | 'loading' | 'ready' | 'error'

export interface PromptPanel {
  id: string
  title: string
  text: string
  lines: number
}

/**
 * The exact system/user prompts sent to a phase's agent, fetched once per
 * (adwId, agent) and cached for the tab's lifetime. Compiled prompts are files
 * written before the agent starts and never rewritten, so a cache hit is
 * always the truth — and the trace view re-selects phases constantly.
 */
const cache = new Map<string, PromptsResponse>()

/**
 * `agent` is null for non-agent phases, which is the idle state: no request,
 * no panels. The effect keys off primitives only, so the 500ms poll replacing
 * the phase object never refetches.
 */
export function usePrompts(
  adwId: string,
  agent: string | null,
): { state: PromptsState; panels: PromptPanel[] } {
  const key = agent ? `${adwId}:${agent}` : null
  const [data, setData] = useState<PromptsResponse | null>(() =>
    key == null ? null : (cache.get(key) ?? null),
  )
  const [state, setState] = useState<PromptsState>(() => {
    if (key == null) return 'idle'
    return cache.has(key) ? 'ready' : 'loading'
  })

  useEffect(() => {
    if (key == null || !agent) {
      setData(null)
      setState('idle')
      return
    }
    const cached = cache.get(key)
    if (cached) {
      setData(cached)
      setState('ready')
      return
    }
    let alive = true
    setData(null)
    setState('loading')
    fetchPrompts(adwId, agent)
      .then((result) => {
        cache.set(key, result)
        if (!alive) return
        setData(result)
        setState('ready')
      })
      .catch(() => {
        // A 404 already resolves as two nulls — reaching here means the
        // endpoint itself is unreachable, which is a state, not a crash.
        if (alive) setState('error')
      })
    return () => {
      alive = false
    }
  }, [adwId, agent, key])

  const panels = useMemo<PromptPanel[]>(() => {
    if (!data) return []
    const out: PromptPanel[] = []
    for (const [id, title, text] of [
      ['system', 'system prompt', data.system],
      ['user', 'user prompt', data.user],
    ] as const) {
      if (text == null) continue
      out.push({ id, title, text, lines: text.split('\n').length })
    }
    return out
  }, [data])

  return { state, panels }
}
