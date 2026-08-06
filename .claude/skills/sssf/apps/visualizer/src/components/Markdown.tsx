import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { cx } from './cx'

export interface MarkdownProps {
  source: string
  className?: string
}

/**
 * renderMarkdown() output. Safe by construction: markdown.ts HTML-escapes every
 * character of its input before producing a single tag, so the only markup here
 * is the markup that module wrote. Styling lives in base.css under `.md`,
 * because injected HTML cannot be reached by a CSS Module.
 */
export function Markdown({ source, className }: MarkdownProps) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return <div className={cx('md', className)} dangerouslySetInnerHTML={{ __html: html }} />
}
