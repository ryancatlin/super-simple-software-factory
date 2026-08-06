import { ChevronRight, FileText, ListTree, ShieldX, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CopyPlate } from '@/components/CopyPlate'
import { cx } from '@/components/cx'
import { DetailSection } from '@/components/DetailSection'
import { ErrorBar } from '@/components/ErrorBar'
import { ModelBadge } from '@/components/ModelBadge'
import { StatChip } from '@/components/StatChip'
import { StatusChip } from '@/components/StatusChip'
import { Tag } from '@/components/Tag'
import { eventLabel } from '@/lib/events'
import { fmtClock, ts } from '@/lib/format'
import type { Envelope, EventRow, GateResult, Phase, Session } from '@/lib/types'
import { hrefFor } from '@/router'
import { eventTypeVar } from '@/theme/palette'
// The one module this view borrows from views/phase — the shared prompts cache,
// so opening the phase detail afterwards costs no second request. See §6.4.
import { usePrompts } from '@/views/phase/usePrompts'
import type { Lane } from './lanes'
import {
  buildReproBundle,
  failedGates,
  isFailedToolCall,
  phaseFailureEvents,
  phaseReportExcerpt,
} from './reproBundle'
import type { ReportExcerpt } from './reproBundle'
import s from './TriagePanel.module.css'

export interface TriagePanelProps {
  adwId: string
  session: Session | null
  /** Ordered by seq — the same array the waterfall draws. */
  phases: Phase[]
  /** Supplies each failure its lane colour, label and resolved model. */
  lanes: Lane[]
  events: EventRow[]
  envelopes: Envelope[]
  gates: GateResult[]
}

/** One phase that went wrong, with everything the reader needs about it. */
interface Failure {
  phase: Phase
  lane: Lane | null
  /** Failed on the latest attempt — a retried-and-fixed gate is not here. */
  gates: GateResult[]
  errors: EventRow[]
  /** The agent's closing words, when its envelope carried any. */
  excerpt: ReportExcerpt | null
  durationMs: number
}

interface Triage {
  /** Root cause first: the earliest phase that failed. */
  failures: Failure[]
  /** Failed gates the tracer wrote against no phase we know about. */
  loose: GateResult[]
  gateCount: number
}

const SEC = {
  gates: 'triage-gates',
  events: 'triage-events',
  report: 'triage-report',
  rest: 'triage-rest',
  loose: 'triage-loose',
} as const

/** Sections that carry the failure itself open on arrival; context waits. */
const OPEN_BY_DEFAULT: readonly string[] = [SEC.gates, SEC.events]

const COLLAPSE_KEY = 'sssf.triage.collapsed:'

function readCollapsed(adwId: string): boolean {
  try {
    return window.sessionStorage.getItem(COLLAPSE_KEY + adwId) === '1'
  } catch {
    // Storage denied (private mode, third-party cookie policy). The panel opens.
    return false
  }
}

function writeCollapsed(adwId: string, collapsed: boolean): void {
  try {
    if (collapsed) window.sessionStorage.setItem(COLLAPSE_KEY + adwId, '1')
    else window.sessionStorage.removeItem(COLLAPSE_KEY + adwId)
  } catch {
    /* the preference simply does not survive the tab */
  }
}

/** Unstarted phases sort last; started ones sort by when they started. */
function startKey(p: Phase): number {
  const t = ts(p.started_at)
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

function laneOf(lanes: Lane[], phaseId: string): Lane | null {
  return (
    lanes.find((l) => [...l.phases, ...l.queued].some((p) => p.phase_id === phaseId)) ?? null
  )
}

/** "1 gate" / "3 gates" — a count that reads as English, not as a template. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** True when the phase used every retry it was given. */
function retriesSpent(phase: Phase): boolean {
  const retries = phase.retries ?? 0
  return retries > 0 && (phase.attempt ?? 0) >= retries
}

function phaseDurationMs(phase: Phase): number {
  const start = ts(phase.started_at)
  const end = ts(phase.ended_at)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN
  return end - start
}

/**
 * What went wrong, in the order it went wrong.
 *
 * A phase qualifies when its own status is `fail` OR when a gate against it is
 * still failing after every retry. Both matter: the machinery can complete a
 * phase that the gates then reject, and a phase can die before any gate ran.
 * Returns null when neither is true — an unremarkable run gets no red plate.
 */
function buildTriage(props: TriagePanelProps): Triage | null {
  const bad = failedGates(props.gates)
  const known = new Set(props.phases.map((p) => p.phase_id))
  const byPhase = new Map<string, GateResult[]>()
  const loose: GateResult[] = []
  for (const g of bad) {
    if (g.phase_id != null && known.has(g.phase_id)) {
      const list = byPhase.get(g.phase_id)
      if (list) list.push(g)
      else byPhase.set(g.phase_id, [g])
    } else {
      loose.push(g)
    }
  }

  const failing = props.phases
    .filter((p) => p.status === 'fail' || byPhase.has(p.phase_id))
    .toSorted((a, b) => startKey(a) - startKey(b) || (a.seq ?? 0) - (b.seq ?? 0))

  if (failing.length === 0 && loose.length === 0) return null

  const failures: Failure[] = failing.map((phase) => ({
    phase,
    lane: laneOf(props.lanes, phase.phase_id),
    gates: byPhase.get(phase.phase_id) ?? [],
    errors: phaseFailureEvents(props.events, phase.phase_id),
    excerpt: phaseReportExcerpt(props.envelopes, phase.phase_id),
    durationMs: phaseDurationMs(phase),
  }))

  return { failures, loose, gateCount: bad.length }
}

/**
 * Gates repeat identical violation strings — the same assertion, failed twice —
 * so a key is the text plus how many times it has already appeared.
 */
function keyed(items: string[]): { key: string; text: string }[] {
  const seen = new Map<string, number>()
  return items.map((text) => {
    const n = (seen.get(text) ?? 0) + 1
    seen.set(text, n)
    return { key: n === 1 ? text : `${text} ${n}`, text }
  })
}

function GateLines({ gate }: { gate: GateResult }) {
  const violations = gateViolations(gate)
  return (
    <div className={s.gate}>
      <div className={s.gateHead}>
        <span className={s.gateMark} aria-hidden="true">
          ✗
        </span>
        <span className={s.gateName}>{gate.gate ?? 'gate'}</span>
        <Tag label="attempt" value={gate.attempt ?? 0} tone="fail" />
        <span className={cx(s.gateTime, 'tnum')}>{fmtClock(gate.created_at)}</span>
      </div>
      {violations.length > 0 ? (
        <ul className={s.violations}>
          {keyed(violations).map(({ key, text }) => (
            <li key={key}>{text}</li>
          ))}
        </ul>
      ) : (
        <p className={s.faint}>no violations recorded — see the phase detail for its checks</p>
      )}
    </div>
  )
}

/** Violation strings, defensively parsed — the column is JSON written by the tracer. */
function gateViolations(g: GateResult): string[] {
  try {
    const parsed: unknown = JSON.parse(g.violations_json ?? '[]')
    if (Array.isArray(parsed)) {
      return parsed.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
    }
  } catch {
    /* fall through to the raw string */
  }
  return g.violations_json ? [g.violations_json] : []
}

function EventLine({ event }: { event: EventRow }) {
  const label = eventLabel(event)
  // A tool the agent reported as failed is typed `tool_call`, so the taxonomy's
  // steel would paint it the same as the forty that worked. Here it is evidence.
  const failedTool = isFailedToolCall(event)
  return (
    <div className={s.event}>
      <span className={cx(s.eventClock, 'tnum')}>{fmtClock(event.started_at)}</span>
      <span
        className={s.eventType}
        style={{ color: failedTool ? 'var(--fail)' : eventTypeVar(event.type) }}
      >
        {failedTool ? '✗ tool_call' : (event.type ?? 'event')}
      </span>
      <span className={s.eventLabel} title={label}>
        {label}
      </span>
    </div>
  )
}

/**
 * Failure triage — DESIGN_SPEC §6.4.
 *
 * The first plate on a run that went wrong: which phase broke, what its gates
 * said, what it logged, what it reported, and one button that puts the whole
 * story on the clipboard as markdown. Renders nothing at all when the run has
 * no failed phase and no still-failing gate.
 */
export function TriagePanel(props: TriagePanelProps) {
  const { adwId, session, phases, lanes, events, envelopes, gates } = props

  const triage = useMemo(
    () => buildTriage({ adwId, session, phases, lanes, events, envelopes, gates }),
    [adwId, session, phases, lanes, events, envelopes, gates],
  )
  const primary = triage?.failures[0] ?? null
  const rest = triage?.failures.slice(1) ?? []

  const owner = primary?.phase.kind === 'agent' ? primary.phase.owner : null
  const prompts = usePrompts(adwId, owner)

  const model = primary?.lane?.model ?? null

  /**
   * Rebuilt whenever the trace polls, which is twice a second — cheap, because
   * every input is already in memory and the document is a few string joins.
   * It must NOT depend on a live clock: the copied-tick compares clipboard text
   * to this string, and a ticking duration would clear the tick under the hand.
   */
  const bundle = useMemo(
    () =>
      primary
        ? buildReproBundle({
            session,
            phase: primary.phase,
            events,
            envelopes,
            gates,
            prompts: prompts.panels,
            model,
          })
        : '',
    [primary, session, events, envelopes, gates, prompts.panels, model],
  )

  const [collapsed, setCollapsed] = useState(() => readCollapsed(adwId))
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(OPEN_BY_DEFAULT))

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      writeCollapsed(adwId, !prev)
      return !prev
    })
  }, [adwId])

  const toggleSection = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  if (!triage) return null

  const bodyId = 'triage-body'

  return (
    <section className={cx('plate', s.panel)}>
      <header className={s.head}>
        <button
          type="button"
          className={s.toggle}
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
        >
          <ChevronRight
            className={cx(s.chevron, !collapsed && s.chevronOpen)}
            size={14}
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <TriangleAlert className={s.warn} size={16} strokeWidth={2.25} aria-hidden="true" />
          <span className={cx('stamp', s.title)}>failure triage</span>
          <span className={cx(s.verdict, 'tnum')}>
            {count(triage.failures.length, 'failed phase')}
            {triage.gateCount > 0 ? ` · ${count(triage.gateCount, 'failed gate')}` : null}
          </span>
          <span className={s.filler} aria-hidden="true" />
        </button>
        {bundle ? (
          <CopyPlate
            className={s.copy}
            text={bundle}
            label="copy repro bundle"
            title="Copy this failure as markdown — summary, run and phase facts, gates, error events, the phase report and the compiled prompt"
            accent="var(--fail-bright)"
          />
        ) : null}
      </header>

      {collapsed ? null : (
        <div id={bodyId} className={s.body}>
          {primary ? (
            <div
              className={s.primary}
              style={{ '--lane': primary.lane?.color ?? 'var(--fail)' } as CSSProperties}
            >
              <div className={s.phaseRow}>
                <span className={s.laneChip} aria-hidden="true" />
                <a className={s.phaseName} href={hrefFor(adwId, primary.phase.phase_id)}>
                  {primary.phase.name ?? primary.phase.phase_id}
                </a>
                <StatusChip status={primary.phase.status ?? 'fail'} />
                {Number.isFinite(primary.durationMs) ? (
                  <StatChip kind="runtime" value={primary.durationMs} compact />
                ) : null}
                <div className={s.tags}>
                  {model ? <ModelBadge model={model} size={14} className={s.model} /> : null}
                  <Tag label="kind" value={primary.phase.kind ?? '—'} />
                  <Tag label="owner" value={primary.phase.owner ?? '—'} />
                  <Tag
                    label="attempt"
                    value={`${primary.phase.attempt ?? 0}/${primary.phase.retries ?? 0}`}
                    /* Red only when the retries actually ran out — a phase that
                       failed on its first and only attempt did not exhaust
                       anything, and saying so in red would be an invention. */
                    tone={retriesSpent(primary.phase) ? 'fail' : 'default'}
                  />
                </div>
              </div>

              {primary.phase.description ? (
                <p className={s.description}>{primary.phase.description}</p>
              ) : null}

              {primary.phase.error ? (
                <div className={s.errorWrap}>
                  <ErrorBar message={primary.phase.error} label="Phase failed" />
                </div>
              ) : null}
            </div>
          ) : (
            <p className={s.faint}>
              No phase is marked failed — the gates below are the only failure recorded.
            </p>
          )}

          {primary && primary.gates.length > 0 ? (
            <DetailSection
              id={SEC.gates}
              title="failed gates"
              icon={ShieldX}
              count={primary.gates.length}
              open={open.has(SEC.gates)}
              onToggle={() => toggleSection(SEC.gates)}
            >
              {primary.gates.map((g) => (
                <GateLines key={g.id} gate={g} />
              ))}
            </DetailSection>
          ) : null}

          {triage.loose.length > 0 ? (
            <DetailSection
              id={SEC.loose}
              title="gates without a phase"
              icon={ShieldX}
              count={triage.loose.length}
              open={open.has(SEC.loose)}
              onToggle={() => toggleSection(SEC.loose)}
            >
              {triage.loose.map((g) => (
                <GateLines key={g.id} gate={g} />
              ))}
            </DetailSection>
          ) : null}

          {primary && primary.errors.length > 0 ? (
            <DetailSection
              id={SEC.events}
              title="error events"
              icon={TriangleAlert}
              count={primary.errors.length}
              open={open.has(SEC.events)}
              onToggle={() => toggleSection(SEC.events)}
            >
              {primary.errors.slice(-8).map((e) => (
                <EventLine key={e.event_id} event={e} />
              ))}
              {primary.errors.length > 8 ? (
                <p className={s.faint}>
                  showing the last 8 of {primary.errors.length} — the rest are in the phase detail
                </p>
              ) : null}
            </DetailSection>
          ) : null}

          {primary?.excerpt ? (
            <DetailSection
              id={SEC.report}
              title="final report"
              icon={FileText}
              open={open.has(SEC.report)}
              onToggle={() => toggleSection(SEC.report)}
            >
              {primary.excerpt.prose ? (
                <p className={s.report}>{primary.excerpt.text}</p>
              ) : (
                <pre className={s.excerpt}>{primary.excerpt.text}</pre>
              )}
            </DetailSection>
          ) : null}

          {rest.length > 0 ? (
            <DetailSection
              id={SEC.rest}
              title="also failed"
              icon={ListTree}
              count={rest.length}
              open={open.has(SEC.rest)}
              onToggle={() => toggleSection(SEC.rest)}
            >
              {rest.map((f) => (
                <div
                  key={f.phase.phase_id}
                  className={s.restRow}
                  style={{ '--lane': f.lane?.color ?? 'var(--fail)' } as CSSProperties}
                >
                  <span className={s.laneChip} aria-hidden="true" />
                  <a className={s.restName} href={hrefFor(adwId, f.phase.phase_id)}>
                    {f.phase.name ?? f.phase.phase_id}
                  </a>
                  <StatusChip status={f.phase.status ?? 'fail'} compact />
                  <span className={cx(s.restMeta, 'tnum')}>
                    {f.gates.length > 0 ? `${count(f.gates.length, 'gate')} · ` : null}
                    {count(f.errors.length, 'error')} · {fmtClock(f.phase.started_at)}
                  </span>
                </div>
              ))}
            </DetailSection>
          ) : null}
        </div>
      )}
    </section>
  )
}
