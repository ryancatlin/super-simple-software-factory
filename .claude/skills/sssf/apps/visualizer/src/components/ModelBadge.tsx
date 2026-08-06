import { modelIcon, modelName } from '@/lib/models'
import { cx } from './cx'
import s from './ModelBadge.module.css'

export interface ModelBadgeProps {
  model: string | null | undefined
  /** Icon px, default 16. */
  size?: number
  className?: string
}

/** Provider icon + compact model name; the full id stays in the title. */
export function ModelBadge({ model, size = 16, className }: ModelBadgeProps) {
  const icon = modelIcon(model)
  const name = modelName(model)
  if (!name) return null
  return (
    <span className={cx(s.badge, className)} title={model ?? undefined}>
      {icon ? (
        <img className={s.icon} src={icon} width={size} height={size} alt="" aria-hidden="true" />
      ) : null}
      <span className={s.name}>{name}</span>
    </span>
  )
}
