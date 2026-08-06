import type { CSSProperties } from 'react'
import { Check, Copy } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { cx } from './cx'
import s from './CopyPlate.module.css'

export interface CopyPlateProps {
  /** What lands on the clipboard. */
  text: string
  /** What is shown; defaults to `text`. */
  label?: string
  title?: string
  /** CSS colour for hover/active; defaults to var(--amber). */
  accent?: string
  className?: string
}

/** The engraved copy button used by docs and empty states. */
export function CopyPlate({ text, label, title, accent, className }: CopyPlateProps) {
  const [copied, copy] = useCopyToClipboard()
  const done = copied === text
  return (
    <button
      type="button"
      className={cx('well', s.plate, className)}
      style={{ '--accent': accent ?? 'var(--amber)' } as CSSProperties}
      title={title ?? `copy: ${text}`}
      onClick={() => copy(text)}
    >
      <span className={s.label}>{label ?? text}</span>
      {done ? (
        <Check className={cx(s.icon, s.done)} size={14} strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <Copy className={s.icon} size={14} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  )
}
