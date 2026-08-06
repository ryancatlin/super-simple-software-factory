import {
  AlignLeft,
  Camera,
  Inbox,
  MessagesSquare,
  Package,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cx } from '@/components/cx'
import { DetailSection } from '@/components/DetailSection'
import { ErrorBar } from '@/components/ErrorBar'
import { useFirstPaint } from '@/hooks/useFirstPaint'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { useNow } from '@/hooks/useNow'
import { parseAgentStart } from '@/lib/events'
import { ts } from '@/lib/format'
import type { Envelope, EventRow as EventRowData, GateResult, Phase } from '@/lib/types'
import { AgentConfigSection } from './AgentConfigSection'
import { CostSection } from './CostSection'
import { EventsPanel } from './EventsPanel'
import { EvidenceSection } from './EvidenceSection'
import { GatesSection } from './GatesSection'
import { OutputsSection } from './OutputsSection'
import { PhaseHeader } from './PhaseHeader'
import { PromptsSection } from './PromptsSection'
import { SectionNav } from './SectionNav'
import type { SectionNavEntry } from './SectionNav'
import {
  flowDirsOf,
  phaseEventsOf,
  phaseGatesOf,
  phaseOutputsOf,
  requestTextOf,
  usageOf,
} from './phaseData'
import { useEvidence } from './useEvidence'
import { usePrompts } from './usePrompts'
import s from './PhaseDetail.module.css'

export interface PhaseDetailProps {
  phase: Phase
  /** All events for the session; the view filters by phase_id and sorts by rowid. */
  events: EventRowData[]
  envelopes: Envelope[]
  gates: GateResult[]
  onClose: () => void
}

/** Section ids double as scroll anchors, so they are namespaced to this panel. */
const SEC = {
  request: 'pd-request',
  config: 'pd-config',
  description: 'pd-description',
  prompts: 'pd-prompts',
  gates: 'pd-gates',
  cost: 'pd-cost',
  evidence: 'pd-evidence',
  outputs: 'pd-outputs',
  events: 'pd-events',
} as const

/**
 * The instrument panel — DESIGN_SPEC §5.3.3.
 *
 * Rendered below the waterfall in normal flow, never as a modal: the trace has
 * to stay visible, and `#/<adw>/<phase>` must render exactly this on a cold
 * load. Every piece of user state here (open sections, expanded gates and
 * events, prompt panels) is keyed to `phase.phase_id` and therefore survives
 * the 500ms poll that replaces the phase object underneath it.
 */
export function PhaseDetail({ phase, events, envelopes, gates, onClose }: PhaseDetailProps) {
  const phaseId = phase.phase_id
  const adwId = phase.adw_id

  // ── derived data ───────────────────────────────────────────────────────────

  const phaseEvents = useMemo(() => phaseEventsOf(events, phaseId), [events, phaseId])
  const phaseGates = useMemo(() => phaseGatesOf(gates, phaseId), [gates, phaseId])
  const phaseOutputs = useMemo(() => phaseOutputsOf(envelopes, phaseId), [envelopes, phaseId])

  const requestText = useMemo(
    () => (phase.kind === 'engineer' ? requestTextOf(phaseEvents) : null),
    [phase.kind, phaseEvents],
  )

  const agentConfig = useMemo(() => {
    if (phase.kind !== 'agent') return null
    const start = phaseEvents.find((e) => e.type === 'agent_start')
    return start ? parseAgentStart(start) : null
  }, [phase.kind, phaseEvents])

  const usage = useMemo(
    () => (phase.kind === 'agent' ? usageOf(phaseEvents) : null),
    [phase.kind, phaseEvents],
  )

  // Joined first so the array identity is stable across polls that add no new
  // flow — otherwise the evidence request would fire twice a second.
  const flowKey = useMemo(() => flowDirsOf(phaseEvents).join('|'), [phaseEvents])
  const flowDirs = useMemo(() => (flowKey ? flowKey.split('|') : []), [flowKey])
  const evidence = useEvidence(adwId, phaseId, flowDirs)

  const prompts = usePrompts(adwId, phase.kind === 'agent' ? phase.owner : null)

  const running = phase.status === 'running'
  const now = useNow(250, running)
  const durationMs = useMemo(() => {
    const start = ts(phase.started_at)
    if (!Number.isFinite(start)) return Number.NaN
    const end = running ? now : ts(phase.ended_at)
    return Number.isFinite(end) ? end - start : Number.NaN
  }, [phase.started_at, phase.ended_at, running, now])

  // ── user state, reset only when the phase itself changes ───────────────────

  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedEvents, setExpandedEvents] = useState<ReadonlySet<string>>(() => new Set())
  const [shownPhaseId, setShownPhaseId] = useState(phaseId)

  if (shownPhaseId !== phaseId) {
    // Every section starts closed — the engineer opens exactly what they need.
    setShownPhaseId(phaseId)
    setOpenSections(new Set())
    setExpandedEvents(new Set())
  }

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (!next.delete(eventId)) next.add(eventId)
      return next
    })
  }, [])

  // ── section index ──────────────────────────────────────────────────────────

  const entries: SectionNavEntry[] = [
    { id: SEC.request, label: 'request', present: requestText != null },
    { id: SEC.config, label: 'agent config', present: agentConfig != null },
    { id: SEC.description, label: 'description', present: Boolean(phase.description) },
    {
      id: SEC.prompts,
      label: 'compiled prompts',
      count: prompts.state === 'ready' ? prompts.panels.length : null,
      present: phase.kind === 'agent',
    },
    { id: SEC.gates, label: 'gates', count: phaseGates.length, present: true },
    { id: SEC.cost, label: 'cost', present: usage != null },
    {
      id: SEC.evidence,
      label: 'evidence',
      count: evidence.count,
      present: evidence.panels.length > 0,
    },
    { id: SEC.outputs, label: 'outputs', count: phaseOutputs.length, present: true },
    { id: SEC.events, label: 'events', count: phaseEvents.length, present: true },
  ]

  const presentKey = entries
    .filter((e) => e.present)
    .map((e) => e.id)
    .join('|')

  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const ids = presentKey ? presentKey.split('|') : []
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el != null)
    if (!els.length) return
    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          if (r.isIntersecting) visible.add(r.target.id)
          else visible.delete(r.target.id)
        }
        const first = ids.find((id) => visible.has(id))
        // Nothing on screen means the reader is between sections — hold the
        // last one rather than blanking the rail.
        setActiveId((prev) => first ?? prev)
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: 0 },
    )
    for (const el of els) observer.observe(el)
    return () => observer.disconnect()
  }, [presentKey])

  const jump = useCallback((id: string) => {
    setOpenSections((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  // ── keyboard: j/k through the tape, Enter folds a row, Esc closes ──────────

  const eventIds = useMemo(() => phaseEvents.map((e) => e.event_id), [phaseEvents])
  const nav = useListKeyboardNav({ ids: eventIds, onActivate: toggleEvent, onEscape: onClose })

  // The tape reveals itself once, when the panel first opens. Never again —
  // the 500ms poll rebuilds this list twice a second.
  const reveal = useFirstPaint(true)

  const isOpen = (id: string) => openSections.has(id)

  return (
    <section className={cx('plate', s.panel)}>
      <PhaseHeader phase={phase} durationMs={durationMs} onClose={onClose} />

      {phase.error ? (
        <div className={s.errorWrap}>
          <ErrorBar message={phase.error} label="Phase failed" />
        </div>
      ) : null}

      <div className={s.body}>
        <SectionNav entries={entries} activeId={activeId} onJump={jump} />

        <div className={s.column}>
          {requestText ? (
            <DetailSection
              id={SEC.request}
              title="request"
              icon={Inbox}
              open={isOpen(SEC.request)}
              onToggle={() => toggleSection(SEC.request)}
            >
              <p className={s.request}>{requestText}</p>
            </DetailSection>
          ) : null}

          {agentConfig ? (
            <DetailSection
              id={SEC.config}
              title="agent config"
              icon={SlidersHorizontal}
              open={isOpen(SEC.config)}
              onToggle={() => toggleSection(SEC.config)}
            >
              <AgentConfigSection config={agentConfig} />
            </DetailSection>
          ) : null}

          {phase.description ? (
            <DetailSection
              id={SEC.description}
              title="description"
              icon={AlignLeft}
              open={isOpen(SEC.description)}
              onToggle={() => toggleSection(SEC.description)}
            >
              <p className={s.description}>{phase.description}</p>
            </DetailSection>
          ) : null}

          {phase.kind === 'agent' ? (
            <DetailSection
              id={SEC.prompts}
              title="compiled prompts"
              icon={MessagesSquare}
              count={prompts.state === 'ready' ? prompts.panels.length : null}
              open={isOpen(SEC.prompts)}
              onToggle={() => toggleSection(SEC.prompts)}
            >
              <PromptsSection key={phaseId} state={prompts.state} panels={prompts.panels} />
            </DetailSection>
          ) : null}

          <DetailSection
            id={SEC.gates}
            title="gates"
            icon={ShieldCheck}
            count={phaseGates.length}
            open={isOpen(SEC.gates)}
            onToggle={() => toggleSection(SEC.gates)}
          >
            <GatesSection key={phaseId} gates={phaseGates} />
          </DetailSection>

          {usage ? (
            <DetailSection
              id={SEC.cost}
              title="cost"
              icon={Receipt}
              open={isOpen(SEC.cost)}
              onToggle={() => toggleSection(SEC.cost)}
            >
              <CostSection rows={usage.rows} partial={usage.partial} />
            </DetailSection>
          ) : null}

          {evidence.panels.length ? (
            <DetailSection
              id={SEC.evidence}
              title="evidence"
              icon={Camera}
              count={evidence.count}
              open={isOpen(SEC.evidence)}
              onToggle={() => toggleSection(SEC.evidence)}
            >
              <EvidenceSection adwId={adwId} panels={evidence.panels} />
            </DetailSection>
          ) : null}

          <DetailSection
            id={SEC.outputs}
            title="outputs"
            icon={Package}
            count={phaseOutputs.length}
            open={isOpen(SEC.outputs)}
            onToggle={() => toggleSection(SEC.outputs)}
          >
            <OutputsSection envelopes={phaseOutputs} />
          </DetailSection>
        </div>

        <div id={SEC.events} className={s.column} {...nav.containerProps}>
          <EventsPanel
            events={phaseEvents}
            expanded={expandedEvents}
            onToggle={toggleEvent}
            selectedId={nav.selectedId}
            itemProps={nav.itemProps}
            reveal={reveal}
          />
        </div>
      </div>
    </section>
  )
}
