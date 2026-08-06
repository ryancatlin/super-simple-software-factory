/**
 * The palette's matcher. A subsequence match with positional bonuses — no
 * dependency, no index build, and small enough to reason about: the whole
 * ranking behaviour is the four constants below.
 */

export interface FuzzyHit {
  score: number
  /** [start, end) ranges in the haystack, merged and in ascending order. */
  ranges: [number, number][]
}

/** Per matched character. */
const HIT = 10
/** Extra when a match is contiguous with the previous one. */
const RUN = 18
/** Extra when a match starts a word (index 0, or after a non-alphanumeric). */
const BOUNDARY = 24
/** Penalty per haystack character skipped to reach a match. */
const SKIP = 1

const ALNUM = /[a-z0-9]/

/**
 * Match `query` against `haystack`, case-insensitively. Returns null when the
 * query is not a subsequence of the haystack. An empty query matches everything
 * with score 0 and no ranges, so the caller can render its natural order.
 */
export function fuzzyMatch(query: string, haystack: string): FuzzyHit | null {
  const q = query.toLowerCase()
  const h = haystack.toLowerCase()
  if (q.length === 0) return { score: 0, ranges: [] }
  if (h.length === 0) return null

  const ranges: [number, number][] = []
  let score = 0
  let from = 0
  let prev = -2

  for (const ch of q) {
    const at = h.indexOf(ch, from)
    if (at < 0) return null

    score += HIT
    score -= (at - from) * SKIP
    if (at === prev + 1) score += RUN
    if (at === 0 || !ALNUM.test(h[at - 1])) score += BOUNDARY

    const last = ranges[ranges.length - 1]
    if (last && last[1] === at) last[1] = at + 1
    else ranges.push([at, at + 1])

    prev = at
    from = at + 1
  }

  return { score, ranges }
}

export interface Segment {
  text: string
  hit: boolean
  /** Offset in the source string — a stable, data-dependent React key. */
  start: number
}

/** Split `text` into alternating plain / matched segments for <mark> rendering. */
export function segments(text: string, ranges: readonly [number, number][]): Segment[] {
  if (ranges.length === 0) return [{ text, hit: false, start: 0 }]
  const out: Segment[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false, start: cursor })
    out.push({ text: text.slice(start, end), hit: true, start })
    cursor = end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false, start: cursor })
  return out
}
