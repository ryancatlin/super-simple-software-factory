/**
 * Dependency-free JSON syntax highlighting.
 *
 * Same safety model as markdown.ts: every character of input is HTML-escaped;
 * the only tags in the output are the <span>s this module writes. Token
 * colors live in styles/base.css under the .j-* classes.
 */
import { prettyJson } from './format'

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Strings first so digits/keywords inside them are consumed as part of the
// string token. A string followed by a colon is an object key.
const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

/** Highlight text that is already (or claims to be) JSON. Escapes everything. */
export function highlightJsonText(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    out += escapeHtml(text.slice(last, m.index))
    const [full, str, colon, bool, nil, num] = m
    if (str !== undefined) {
      const cls = colon !== undefined ? 'j-key' : 'j-str'
      out += `<span class="${cls}">${escapeHtml(str)}</span>${escapeHtml(colon ?? '')}`
    } else if (bool !== undefined) {
      out += `<span class="j-bool">${bool}</span>`
    } else if (nil !== undefined) {
      out += `<span class="j-null">null</span>`
    } else {
      out += `<span class="j-num">${escapeHtml(num ?? full)}</span>`
    }
    last = (m.index ?? 0) + full.length
  }
  out += escapeHtml(text.slice(last))
  return out
}

/** Pretty-print raw JSON and highlight it; non-JSON falls back to escaped raw. */
export function highlightJson(raw: string | null | undefined): string {
  if (!raw) return ''
  // The pretty-printer lives in format.ts and only there. prettyJson swallows
  // its own parse failure and hands the input back verbatim, which is
  // indistinguishable from a document that simply round-trips (`{}`, `1`), so
  // the validity question is asked first: text that is not JSON has no tokens
  // worth colouring and is escaped as-is. Payloads are small and every caller
  // memoises, so the second parse costs nothing worth a duplicated printer.
  try {
    JSON.parse(raw)
  } catch {
    return escapeHtml(raw)
  }
  return highlightJsonText(prettyJson(raw))
}
