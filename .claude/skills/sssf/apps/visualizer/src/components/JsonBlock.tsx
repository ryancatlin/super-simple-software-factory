import { useMemo } from 'react'
import { highlightJson, highlightJsonText } from '@/lib/highlight'
import s from './JsonBlock.module.css'
import { cx } from './cx'

export interface JsonBlockProps {
  /** Raw JSON string (or anything — non-JSON falls back to escaped raw). */
  raw: string | null | undefined
  /** Already-pretty text to highlight instead of `raw` (uses highlightJsonText). */
  text?: string
  /** CSS length, e.g. '42vh'. */
  maxHeight?: string
  className?: string
}

/**
 * highlightJson() output in an engraved <pre>. Safe for the same reason as
 * Markdown: highlight.ts escapes all input and emits only its own <span>s.
 */
export function JsonBlock({ raw, text, maxHeight, className }: JsonBlockProps) {
  const html = useMemo(
    () => (text == null ? highlightJson(raw) : highlightJsonText(text)),
    [raw, text],
  )
  return (
    <pre
      className={cx(s.json, className)}
      style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
