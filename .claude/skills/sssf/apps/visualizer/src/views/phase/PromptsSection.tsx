import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cx } from '@/components/cx'
import { Markdown } from '@/components/Markdown'
import type { PromptPanel, PromptsState } from './usePrompts'
import s from './PromptsSection.module.css'

export interface PromptsSectionProps {
  state: PromptsState
  panels: PromptPanel[]
}

/**
 * The exact prompts this phase's agent was sent, rendered or raw.
 *
 * Fetch + cache live in usePrompts (the parent needs the panel count for the
 * section header and the nav rail); this component owns only the disclosure
 * state, which the parent resets by keying it on phase_id.
 */
export function PromptsSection({ state, panels }: PromptsSectionProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set())

  function togglePanel(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  function setRawView(id: string, on: boolean) {
    setRaw((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  if (state === 'loading') return <div className={s.faint}>loading prompts…</div>
  if (state === 'error') return <div className={s.faint}>prompts unavailable</div>
  if (state === 'idle') return null
  if (!panels.length) return <div className={s.faint}>no compiled prompts recorded</div>

  return (
    <>
      {panels.map((panel) => {
        const isOpen = open.has(panel.id)
        const isRaw = raw.has(panel.id)
        const bodyId = `pd-prompt-${panel.id}`
        return (
          <div key={panel.id} className={s.panel}>
            <button
              type="button"
              className={s.head}
              onClick={() => togglePanel(panel.id)}
              aria-expanded={isOpen}
              aria-controls={bodyId}
            >
              <ChevronRight
                className={cx(s.chevron, isOpen && s.chevronOpen)}
                size={14}
                strokeWidth={2.25}
                aria-hidden="true"
              />
              <span className={s.title}>{panel.title}</span>
              <span className={cx(s.lines, 'tnum')}>{panel.lines} lines</span>
            </button>
            {/* Collapse by grid-template-rows: the row track animates, the
                content is never measured or re-laid-out mid-transition. */}
            <div className={cx(s.collapse, isOpen && s.collapseOpen)}>
              <div className={s.collapseInner}>
                <div className={s.body} id={bodyId}>
                  <div className={s.tools} role="group" aria-label={`${panel.title} view`}>
                    <button
                      type="button"
                      className={cx(s.tool, !isRaw && s.toolActive)}
                      onClick={() => setRawView(panel.id, false)}
                      aria-pressed={!isRaw}
                    >
                      rendered
                    </button>
                    <button
                      type="button"
                      className={cx(s.tool, isRaw && s.toolActive)}
                      onClick={() => setRawView(panel.id, true)}
                      aria-pressed={isRaw}
                    >
                      raw
                    </button>
                  </div>
                  {isRaw ? (
                    <pre className={s.raw}>{panel.text}</pre>
                  ) : (
                    <Markdown source={panel.text} />
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}
