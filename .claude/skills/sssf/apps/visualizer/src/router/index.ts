/**
 * Hash routes: #/ → sessions · #/<adw_id> → waterfall · #/<adw_id>/<phase_id>
 * → phase panel open · #/docs → the commands page.
 *
 * Parsing and href construction are carried over character-for-character from
 * the Vue router this replaced, so every deep link that worked before still
 * resolves to the same view.
 */

export interface Route {
  adwId: string | null
  phaseId: string | null
}

/**
 * Parse a location hash. Strip a leading '#' and optional '/', split on '/',
 * drop empties, decodeURIComponent each segment.
 */
export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent)
  return { adwId: parts[0] ?? null, phaseId: parts[1] ?? null }
}

/** '#/', '#/<adw>', '#/<adw>/<phase>' — encodeURIComponent on each segment. */
export function hrefFor(adwId?: string | null, phaseId?: string | null): string {
  let h = '#/'
  if (adwId) h += encodeURIComponent(adwId)
  if (adwId && phaseId) h += `/${encodeURIComponent(phaseId)}`
  return h
}

export function navigate(adwId?: string | null, phaseId?: string | null): void {
  window.location.hash = hrefFor(adwId, phaseId)
}

/**
 * '#/docs' is a reserved page, not a session — adw_ids are 8-hex, so the word
 * can never collide with a real run.
 */
export function isDocsRoute(route: Route): boolean {
  return route.adwId === 'docs'
}
