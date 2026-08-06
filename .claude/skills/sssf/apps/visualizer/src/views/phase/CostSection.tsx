import { cx } from '@/components/cx'
import { money, NUM } from './phaseData'
import type { UsageRow } from './phaseData'
import s from './CostSection.module.css'

export interface CostSectionProps {
  rows: UsageRow[]
  /** True for runs written before the per-component breakdown existed. */
  partial: boolean
}

/** What this phase's agent spent, component by component. */
export function CostSection({ rows, partial }: CostSectionProps) {
  return (
    <>
      <table className={s.usage}>
        <thead>
          <tr>
            <th className={cx('stamp', s.k)} scope="col">
              <span className={s.srOnly}>component</span>
            </th>
            <th className={cx('stamp', s.n)} scope="col">
              tokens
            </th>
            <th className={cx('stamp', s.c)} scope="col">
              cost
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className={cx(r.kind === 'total' && s.total, r.kind === 'nested' && s.nested)}
              title={r.title}
            >
              <td className={s.k}>{r.label}</td>
              <td className={cx(s.n, 'tnum')}>{NUM.format(r.tokens)}</td>
              <td className={cx(s.c, 'tnum')}>{money(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {partial ? (
        <p className={s.note}>
          this run predates the per-component breakdown — only the total was recorded
        </p>
      ) : null}
    </>
  )
}
