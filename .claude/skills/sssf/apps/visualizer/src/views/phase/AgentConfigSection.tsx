import { Brain, Fingerprint, SquareTerminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@/components/cx'
import { ModelBadge } from '@/components/ModelBadge'
import type { AgentStartPayload } from '@/lib/types'
import s from './AgentConfigSection.module.css'

export interface AgentConfigSectionProps {
  config: AgentStartPayload
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <span className={cx('stamp', s.key)}>{label}</span>
      {children}
    </div>
  )
}

/**
 * The agent's configuration, carried on its phase's `agent_start` event.
 * Older rows carry only model/thinking — rows render what was recorded, so an
 * absent line means the tracer never wrote that field.
 */
export function AgentConfigSection({ config }: AgentConfigSectionProps) {
  return (
    <div className={s.cfg}>
      {config.coding_agent ? (
        <Row label="coding agent">
          <span className={s.chip}>
            <SquareTerminal className={s.icon} size={18} strokeWidth={2} aria-hidden="true" />
            {config.coding_agent}
          </span>
        </Row>
      ) : null}

      {config.model ? (
        <Row label="model">
          <span className={s.chip}>
            <ModelBadge model={config.model} size={17} />
          </span>
        </Row>
      ) : null}

      {config.thinking ? (
        <Row label="thinking">
          <span className={s.chip}>
            <Brain className={s.icon} size={18} strokeWidth={2} aria-hidden="true" />
            {config.thinking}
          </span>
        </Row>
      ) : null}

      {/*
        payload_json is arbitrary tracer JSON cast to AgentStartPayload, so the
        declared types are a hope, not a runtime guarantee. Both branches match
        Vue's forgiving v-if/v-for: a non-array `tools` renders "all tools"
        rather than throwing, and a null `harness_engineering` renders "none".
      */}
      {config.tools === undefined ? null : (
        <Row label="tools">
          {!Array.isArray(config.tools) ? (
            <span className={s.value}>all tools</span>
          ) : (
            <span className={s.chips}>
              {config.tools.map((t) => (
                <span key={t} className={s.chip}>
                  {t}
                </span>
              ))}
            </span>
          )}
        </Row>
      )}

      {config.harness_engineering === undefined ? null : (
        <Row label="harness">
          {!Array.isArray(config.harness_engineering) || !config.harness_engineering.length ? (
            <span className={cx(s.value, s.dim)}>none</span>
          ) : (
            <span className={s.chips}>
              {config.harness_engineering.map((h) => (
                <span key={h} className={s.chip}>
                  {h}
                </span>
              ))}
            </span>
          )}
        </Row>
      )}

      {config.purpose ? (
        <Row label="purpose">
          <span className={s.value}>{config.purpose}</span>
        </Row>
      ) : null}

      {config.session_id ? (
        <Row label="session">
          <span className={s.chip}>
            <Fingerprint className={s.icon} size={18} strokeWidth={2} aria-hidden="true" />
            {config.session_id}
          </span>
        </Row>
      ) : null}
    </div>
  )
}
