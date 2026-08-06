import { Fragment, useMemo } from 'react'
import type { LiveState } from '@/App'
import { hrefFor, isDocsRoute } from '@/router'
import type { Route } from '@/router'
import { cx } from './cx'
import { LiveIndicator } from './LiveIndicator'
import s from './TopBar.module.css'

export interface TopBarProps {
  route: Route
  /** Display name of the selected phase; falls back to route.phaseId when null. */
  phaseLabel: string | null
  live: LiveState
  /** Age in ms of the last successful poll; null before the first success. */
  lastOkAgeMs: number | null
  /** Tooltip for the lamp — the db behind it, from /api/health. */
  liveTitle?: string
  onOpenPalette: () => void
}

interface Crumb {
  key: string
  text: string
  href: string | null
}

function isMacLike(): boolean {
  // navigator.platform is deprecated but is still the only synchronous signal
  // that works in every browser we care about; userAgent is the fallback.
  const platform = navigator.platform || navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Inline copy of public/logo.svg — three offset bars, machined. Keep in sync. */
function Mark() {
  return (
    <svg className={s.mark} viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <rect x="4" y="6" width="17" height="5" rx="1" fill="var(--amber)" />
      <rect x="8" y="13.5" width="20" height="5" rx="1" fill="var(--text-dim)" />
      <rect x="4" y="21" width="13" height="5" rx="1" fill="var(--edge-strong)" />
    </svg>
  )
}

function buildCrumbs(route: Route, phaseLabel: string | null): Crumb[] {
  const isDocs = isDocsRoute(route)
  const crumbs: Crumb[] = [
    { key: 'sessions', text: 'sessions', href: route.adwId ? hrefFor() : null },
  ]
  if (isDocs) {
    crumbs.push({ key: 'docs', text: 'docs', href: null })
    return crumbs
  }
  if (route.adwId) {
    crumbs.push({
      key: 'adw',
      text: route.adwId,
      href: route.phaseId ? hrefFor(route.adwId) : null,
    })
  }
  if (route.adwId && route.phaseId) {
    crumbs.push({ key: 'phase', text: phaseLabel ?? route.phaseId, href: null })
  }
  return crumbs
}

export function TopBar({
  route,
  phaseLabel,
  live,
  lastOkAgeMs,
  liveTitle,
  onOpenPalette,
}: TopBarProps) {
  const isDocs = isDocsRoute(route)
  const crumbs = buildCrumbs(route, phaseLabel)
  const keyCap = useMemo(() => (isMacLike() ? '⌘K' : 'Ctrl K'), [])

  return (
    <header className={s.bar}>
      <div className={s.brand}>
        <Mark />
        <span className={s.wordmark}>
          <span>Super Simple</span> <span>Software Factory</span>
        </span>
        <span className={s.rule} aria-hidden="true" />
      </div>

      <nav className={s.crumbs} aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 ? (
              <span className={s.sep} aria-hidden="true">
                /
              </span>
            ) : null}
            {c.href ? (
              <a className={s.crumb} href={c.href}>
                {c.text}
              </a>
            ) : (
              <span className={cx(s.crumb, s.current)} aria-current="page">
                {c.text}
              </span>
            )}
          </Fragment>
        ))}
      </nav>

      <div className={s.controls}>
        <button
          type="button"
          className={cx('well', s.keycap)}
          onClick={onOpenPalette}
          title="Command palette"
          aria-label="Open command palette"
        >
          {keyCap}
        </button>
        <a className={cx(s.docs, isDocs && s.docsActive)} href="#/docs">
          docs
        </a>
        <span className={s.rule} aria-hidden="true" />
        <LiveIndicator state={live} ageMs={lastOkAgeMs} title={liveTitle} />
      </div>
    </header>
  )
}
