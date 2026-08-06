import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/**
 * Follow mode — the waterfall tracks a live run hands-free.
 *
 * The waterfall's time scale is fit-to-width, which means that for a running
 * session `x(now)` is always 100: NOW is welded to the right edge and the run
 * silently compresses as it gets longer. Following is therefore not "scroll a
 * bit"; it is a different geometry. While armed the track is given a **live
 * density** (a fixed number of pixels per minute of real, non-elided time) plus
 * a **lead** of empty track in front of NOW, and the plate becomes a horizontal
 * scroll container. The pin then has somewhere to put NOW: 70% across the
 * visible track, with the run's future in the remaining 30%.
 *
 * Nothing here is animated by CSS. The pin is a scroll position computed from
 * measured geometry on each live tick, so it stays true through resizes, axis
 * breaks appearing mid-run, and the reader taking the scrollbar.
 */

/** Where NOW rides across the visible track. */
const PIN = 0.7
/** Live density: track pixels bought by one minute of real time. */
const PX_PER_MIN = 180
/** A very long run gets a thinner minute rather than a 200,000px grid. */
const MAX_TRACK_PX = 24_000
/**
 * Empty track in front of NOW, as a share of the waterfall's own width.
 * Deliberately over-provisioned: the pin target is clamped to the scroll range,
 * so surplus lead costs nothing, while a short lead would drag NOW back to the
 * right edge and the 70% claim would quietly become a lie.
 */
const LEAD = '32%'
/**
 * Scroll landed further than this from where we put it → the reader moved it.
 * Wide enough that a stray trackpad graze is not read as an instruction.
 */
const DRIFT_PX = 24
/**
 * Suspended, and settled back to within this of the pin → following resumes.
 * Deliberately larger than DRIFT_PX: a small nudge heals itself, and only a
 * real scroll back through the run keeps the pin off.
 */
const RESUME_PX = 56
/**
 * Resume is judged once the scrolling has stopped, never mid-gesture —
 * otherwise the first frame of a drag suspends and the second one resumes,
 * forever.
 */
const RESUME_SETTLE_MS = 350
/** Corrections at least this large glide; the per-tick creep jumps. */
const SMOOTH_MIN_PX = 96
/** How long a glide may settle before a scroll position counts as drift again. */
const SETTLE_MS = 700

const KEY = 'sssf.follow:'

function readPref(adwId: string): boolean {
  try {
    return window.sessionStorage.getItem(KEY + adwId) === '1'
  } catch {
    // Storage denied (private mode, third-party cookie policy). Follow is off.
    return false
  }
}

function writePref(adwId: string, on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(KEY + adwId, '1')
    else window.sessionStorage.removeItem(KEY + adwId)
  } catch {
    /* the preference simply does not survive the tab */
  }
}

export interface FollowModeOptions {
  /** The preference is per run, like the triage panel's collapse state. */
  adwId: string
  /** Follow is only offered while the run is live. */
  running: boolean
  /** `scale.x(nowMs)` — NOW's position across the track, 0..100. */
  nowPct: number
  /** Real, non-elided milliseconds the track has to draw. Drives live density. */
  liveMs: number
  /** Changes on every live tick; re-pins. */
  tick: number
  /** The time-track cell — the element the 0..100 scale maps onto. */
  trackRef: RefObject<HTMLElement | null>
}

export interface FollowMode {
  /** Armed *and* live. Goes false by itself the moment the run ends. */
  armed: boolean
  /** Armed, but the reader took the scrollbar. */
  suspended: boolean
  /** The toggle and the F key: resume when suspended, otherwise flip. */
  toggle: () => void
  /** Callback ref for the waterfall — the horizontal scroll container. */
  scrollerRef: (el: HTMLDivElement | null) => (() => void) | undefined
  /** Grid custom properties for the waterfall. Empty when not following. */
  vars: CSSProperties
}

export function useFollowMode(opts: FollowModeOptions): FollowMode {
  const { adwId, running, nowPct, liveMs, tick, trackRef } = opts

  const [pref, setPref] = useState(() => readPref(adwId))
  const [suspended, setSuspended] = useState(false)

  // A different run is a different preference and a clean slate.
  useEffect(() => {
    setPref(readPref(adwId))
    setSuspended(false)
  }, [adwId])

  /** The run ending disarms follow without touching the stored preference. */
  const armed = pref && running

  const scrollerElRef = useRef<HTMLDivElement | null>(null)
  /** The last scroll position we commanded — the baseline for drift. */
  const appliedRef = useRef(0)
  const settleUntilRef = useRef(0)
  const resumeTimerRef = useRef<number | null>(null)
  const reducedRef = useRef(false)

  const prefRef = useRef(pref)
  prefRef.current = pref
  const armedRef = useRef(armed)
  armedRef.current = armed
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended
  const nowPctRef = useRef(nowPct)
  nowPctRef.current = nowPct

  // base.css forces `scroll-behavior: auto` under reduced motion, but that rule
  // cannot reach scrollTo({ behavior: 'smooth' }) — the pin has to ask itself.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedRef.current = mq.matches
    const sync = () => {
      reducedRef.current = mq.matches
    }
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Disarming — by the switch, or by the run ending under it — leaves nothing
  // behind: no pending resume, no stale suspension, no scroll of its own. The
  // track collapses back to fit-to-width and the plate stops scrolling.
  useEffect(() => {
    if (armed) return
    if (resumeTimerRef.current != null) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
    setSuspended(false)
  }, [armed])

  /** Scroll position that puts NOW at PIN across the visible track, or null. */
  const pinTarget = useCallback((): number | null => {
    const el = scrollerElRef.current
    const track = trackRef.current
    if (!el || !track) return null
    const plate = el.getBoundingClientRect()
    const cell = track.getBoundingClientRect()
    // Content-x where the track starts: everything left of it is the lane rail,
    // which is sticky and therefore covers the leading edge of the viewport.
    const railPx = cell.left - plate.left + el.scrollLeft
    const visible = Math.max(el.clientWidth - railPx, 1)
    const pct = Math.min(Math.max(nowPctRef.current, 0), 100)
    const nowPx = railPx + (pct / 100) * cell.width
    const max = Math.max(el.scrollWidth - el.clientWidth, 0)
    return Math.round(Math.min(Math.max(nowPx - railPx - PIN * visible, 0), max))
  }, [trackRef])

  const pin = useCallback(() => {
    const el = scrollerElRef.current
    const want = pinTarget()
    if (!el || want == null) return
    const delta = Math.abs(want - el.scrollLeft)
    // Sub-pixel creep is left alone: moving costs a scroll event, and the pin
    // is already within a pixel of where it wants to be.
    if (delta < 1) return
    // A glide is already on its way to very nearly this position — retargeting
    // it four times a second would restart the animation and never arrive.
    if (
      Date.now() < settleUntilRef.current &&
      Math.abs(want - appliedRef.current) < SMOOTH_MIN_PX
    ) {
      return
    }
    const smooth = !reducedRef.current && delta >= SMOOTH_MIN_PX
    appliedRef.current = want
    settleUntilRef.current = smooth ? Date.now() + SETTLE_MS : 0
    el.scrollTo({ left: want, behavior: smooth ? 'smooth' : 'auto' })
  }, [pinTarget])

  // Layout, not effect: the track's width changes in the same commit, and the
  // pin must land before the frame is painted or NOW visibly stutters.
  useLayoutEffect(() => {
    if (!armed || suspended) return
    pin()
  }, [armed, suspended, tick, nowPct, liveMs, pin])

  /**
   * Suspension is detected from the scroll position rather than from input
   * events, so every route into the scrollbar counts the same: a drag of the
   * bar, a touch flick, shift-wheel, a focused block scrolled into view. If the
   * container is somewhere we did not put it, the reader put it there.
   */
  /**
   * Debounced: the reader has to come to *rest* in the NOW region, so a drag
   * that passes through it on its way back in time does not re-arm the pin —
   * and a gesture that suspended without moving anything heals itself.
   */
  const scheduleResumeCheck = useCallback(() => {
    if (resumeTimerRef.current != null) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null
      const settled = scrollerElRef.current
      const want = pinTarget()
      if (!settled || want == null) return
      if (settled.scrollLeft >= want - RESUME_PX) setSuspended(false)
    }, RESUME_SETTLE_MS)
  }, [pinTarget])

  const onScroll = useCallback(() => {
    const el = scrollerElRef.current
    if (!el || !armedRef.current) return
    if (suspendedRef.current) {
      scheduleResumeCheck()
      return
    }
    if (Date.now() < settleUntilRef.current) return
    if (Math.abs(el.scrollLeft - appliedRef.current) > DRIFT_PX) setSuspended(true)
  }, [scheduleResumeCheck])

  /** A horizontal wheel suspends on the first notch, before the scroll lands. */
  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!armedRef.current || suspendedRef.current) return
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setSuspended(true)
        scheduleResumeCheck()
      }
    },
    [scheduleResumeCheck],
  )

  // A callback ref, because the waterfall only mounts once the first poll lands
  // — an effect keyed on a ref object would never see it appear.
  const scrollerRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerElRef.current = el
      if (!el) return
      el.addEventListener('scroll', onScroll, { passive: true })
      el.addEventListener('wheel', onWheel, { passive: true })
      return () => {
        el.removeEventListener('scroll', onScroll)
        el.removeEventListener('wheel', onWheel)
        if (resumeTimerRef.current != null) clearTimeout(resumeTimerRef.current)
        resumeTimerRef.current = null
        scrollerElRef.current = null
      }
    },
    [onScroll, onWheel],
  )

  const toggle = useCallback(() => {
    if (!running) return
    // Armed but suspended: F means "carry on", not "give up".
    if (prefRef.current && suspendedRef.current) {
      setSuspended(false)
      return
    }
    const next = !prefRef.current
    prefRef.current = next
    writePref(adwId, next)
    setPref(next)
    setSuspended(false)
  }, [adwId, running])

  const trackMinPx = armed
    ? Math.min(Math.round((Math.max(liveMs, 0) / 60_000) * PX_PER_MIN), MAX_TRACK_PX)
    : 0

  const vars = useMemo<CSSProperties>(
    () =>
      armed ? ({ '--track-min': `${trackMinPx}px`, '--lead-w': LEAD } as CSSProperties) : {},
    [armed, trackMinPx],
  )

  return { armed, suspended: armed && suspended, toggle, scrollerRef, vars }
}
