import { Check, Circle, LoaderCircle, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import s from './StatusChip.module.css'

export interface StatusChipProps {
  /** 'success' | 'fail' | 'running' | 'queued' | anything the db carries. */
  status: string
  /** Glyph + word only, no plate — for dense rows like the palette. */
  compact?: boolean
  className?: string
}

const ICONS: Record<string, LucideIcon> = {
  success: Check,
  fail: X,
  running: LoaderCircle,
  queued: Circle,
}

/** Status is never colour alone: the word rides with the glyph, always. */
export function StatusChip({ status, compact, className }: StatusChipProps) {
  const Icon = ICONS[status] ?? Circle
  return (
    <span className={cx(s.chip, s[status], compact && s.compact, className)}>
      <Icon className={s.icon} size={14} strokeWidth={2.25} aria-hidden="true" />
      <span>{status}</span>
    </span>
  )
}
