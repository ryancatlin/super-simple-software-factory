import { BookOpen, CircleDollarSign, Coins, PenLine, Timer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fmtCost, fmtDuration, fmtTokens } from '@/lib/format'
import { cx } from './cx'
import s from './StatChip.module.css'

export type StatKind = 'cost' | 'tokens' | 'runtime' | 'read' | 'written'

export interface StatChipProps {
  kind: StatKind
  /** Raw: cost in dollars, tokens as a count, runtime in milliseconds. */
  value: number | null | undefined
  /** Bare value, no plate — for tight spots like phase blocks and event rows. */
  compact?: boolean
  className?: string
}

const ICONS: Record<StatKind, LucideIcon> = {
  cost: CircleDollarSign,
  tokens: Coins,
  runtime: Timer,
  read: BookOpen,
  written: PenLine,
}

/**
 * Every chip explains itself on hover. The token numbers in particular are read
 * wrong without one — the headline is billed volume, not distinct tokens.
 * This copy is the product's explanation of billed-vs-distinct tokens and is
 * carried over verbatim; do not reword it.
 */
export const STAT_TITLES: Record<StatKind, string> = {
  cost: 'Cost — dollars billed for this run, all agents combined.',
  tokens:
    'Tokens exchanged (billed) — everything sent or generated, counted once per turn. ' +
    'Each turn re-sends the whole conversation, so this is far larger than the ' +
    'conversation itself: it is spend, not size. The gap between it and read + ' +
    'written is cached context re-read on later turns.',
  runtime: 'Duration — wall-clock from the first phase starting to the last one ending.',
  read:
    'Read — raw tokens the models took in: prompts, file contents and tool results, ' +
    'counted the first time they enter the context. Excludes cached re-reads of ' +
    'material already counted here.',
  written:
    'Written — tokens the models actually generated. Each one produced exactly ' +
    'once, so this is a true count of output.',
}

function format(kind: StatKind, value: number | null | undefined): string {
  if (kind === 'cost') return fmtCost(value)
  if (kind === 'runtime') return fmtDuration(value ?? Number.NaN)
  return fmtTokens(value)
}

export function StatChip({ kind, value, compact, className }: StatChipProps) {
  const Icon = ICONS[kind]
  return (
    <span className={cx(s.stat, compact && s.compact, className)} title={STAT_TITLES[kind]}>
      <Icon className={s.icon} size={compact ? 14 : 16} strokeWidth={2} aria-hidden="true" />
      <span className={cx(s.value, 'tnum')}>{format(kind, value)}</span>
    </span>
  )
}
