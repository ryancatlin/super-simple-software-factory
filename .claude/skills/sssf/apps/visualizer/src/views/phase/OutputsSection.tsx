import { cx } from '@/components/cx'
import { JsonBlock } from '@/components/JsonBlock'
import { Tag } from '@/components/Tag'
import type { Envelope } from '@/lib/types'
import s from './OutputsSection.module.css'

export interface OutputsSectionProps {
  /** Already filtered to this phase and sorted by attempt. */
  envelopes: Envelope[]
}

/** The structured payloads this phase handed on, and whether they validated. */
export function OutputsSection({ envelopes }: OutputsSectionProps) {
  if (!envelopes.length) return <div className={s.faint}>no outputs</div>
  return (
    <>
      {envelopes.map((env) => {
        const valid = Boolean(env.valid)
        return (
          <div key={env.envelope_id} className={s.output}>
            <div className={s.line}>
              <span className={s.type}>{env.output_type}</span>
              <Tag label="agent" value={env.agent ?? '—'} />
              <Tag label="attempt" value={env.attempt ?? 0} />
              <span className={cx('stamp', s.valid, valid ? s.pass : s.fail)}>
                {valid ? '✓ valid' : '✗ invalid'}
              </span>
            </div>
            <JsonBlock raw={env.payload_json} maxHeight="40vh" />
          </div>
        )
      })}
    </>
  )
}
