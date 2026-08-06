import { useSyncExternalStore } from 'react'
import { parseHash } from './index'
import type { Route } from './index'

// One cached Route per distinct hash string. useSyncExternalStore requires a
// getSnapshot that returns a stable reference while nothing has changed, and
// effects keyed on the route would otherwise thrash on every render.
let cachedHash = typeof window === 'undefined' ? '' : window.location.hash
let cachedRoute: Route = parseHash(cachedHash)

function getSnapshot(): Route {
  const hash = window.location.hash
  if (hash !== cachedHash) {
    cachedHash = hash
    cachedRoute = parseHash(hash)
  }
  return cachedRoute
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Subscribes to 'hashchange'. Returns a stable Route object. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
