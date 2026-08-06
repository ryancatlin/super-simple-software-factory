# SSSF Visualizer — Design Spec

**"Machine Shop"** · Vue 3 → React 19 port + full redesign
Status: **committed**. This file is the single source of truth. Every builder implements from
this document, not from taste. Where this file gives a number, use that number.

---

## 0. Ground rules

### 0.1 What must not change

| Thing | Rule |
|---|---|
| `server/`, `shared/` | **Do not touch.** Not one character. |
| `src/lib/api.ts`, `events.ts`, `format.ts`, `highlight.ts`, `markdown.ts`, `models.ts`, `types.ts` | **Reuse verbatim.** No rewrites, no re-exports that change semantics. React-adapter hooks *around* them are fine and expected. |
| Ports | server `4600`, vite ui `4601`. |
| Script **names** | `dev`, `server`, `dev:all`, `build`, `preview`, `typecheck`, `lint`. Contents change (`vue-tsc` → `tsc`); names do not. `just obs` and tmux depend on them. |
| Hash routes | `#/` · `#/<adwId>` · `#/<adwId>/<phaseId>` · `#/docs`. Deep links must resolve **identically**, including the `docs` reserved word and `encodeURIComponent` on both segments. |
| `public/logo.svg`, `public/models/*.png` | Stay. The topbar mark is an inline copy of `logo.svg` geometry (recolored — see §5.1). |

`src/lib/router.ts` is **not** on the protected list (it imports `ref` from `vue`). It is deleted
and replaced by `src/router/` — see §7.3. `hrefFor()` semantics are copied exactly.

### 0.2 Stack

React 19 · Vite 7 · TypeScript strict · Bun runtime · CSS Modules per component + one global
token/base sheet · `lucide-react` for every icon · `@fontsource/*` for every font.
**No CSS framework. No component library. No animation library. No `cmdk`.** (§6.1 explains why.)

### 0.3 The test

> Someone seeing this should ask **"how was this made?"**, not **"which AI made this?"**

Concretely, the following are **banned** and a reviewer will reject them on sight:

- glassmorphism / `backdrop-filter` blur panels
- gradient text (`background-clip: text`)
- glow — any `box-shadow` or `filter: drop-shadow` with a blur radius used decoratively
- purple→blue / cyan→violet gradients as chrome
- `border-radius` above **4px**; pills (`999px`) anywhere
- uniform auto-fill card grids
- `Inter`, `Roboto`, `system-ui`, or a bare font stack
- monospace used as a general "techy" UI voice
- emoji as iconography
- centered hero paragraphs with no data in them

**Required instead:** flat fills, hairline rules, machined edge-lines, chamfered 2–4px corners,
stamped uppercase labels, tabular numerals on every number that changes, engraved (inset-darker)
wells for code and data, and one accent — amber phosphor.

---

## 1. Aesthetic doctrine

The app is an **instrument**, not a dashboard. It reads like the front panel of a machine that
someone milled: warm anodised charcoal, hairline engraving, silk-screened labels, one amber
phosphor readout, and hardware-green / hardware-red status lamps.

**The five moves that carry the whole design.** Every surface uses at least one.

1. **The machined edge.** Raised surfaces get a 1px light line along their *top* inside edge and a
   1px dark line along their *bottom* inside edge. Never a blurred shadow.
   ```css
   box-shadow: inset 0 1px 0 var(--edge-light), inset 0 -1px 0 var(--edge-shadow);
   border: 1px solid var(--edge);
   ```
2. **The engraved well.** Anything that holds data you read rather than chrome you click —
   `<pre>`, JSON, prompt bodies, progress troughs — is *darker* than its parent (`--surface-3`)
   with the edge-lines inverted (dark on top, light on bottom). It reads milled-out.
   ```css
   background: var(--surface-3);
   box-shadow: inset 0 1px 0 var(--edge-shadow), inset 0 -1px 0 var(--edge-light-faint);
   ```
3. **The stamp.** Every section, column and readout is labelled in silk-screen: Archivo 700,
   `--fs-stamp`, `text-transform: uppercase`, `letter-spacing: var(--tr-stamp)`, colour
   `--text-faint`. Stamps are chrome, never content — they may sit below the 14px prose floor
   because they are tracked uppercase labels.
4. **The double rule.** Major horizontal divisions are two hairlines with a 1px gap
   (`--edge-strong` over `--edge-soft`), not one thick border. Use `border-bottom: 1px solid
   var(--edge-strong); box-shadow: 0 2px 0 -1px var(--edge-soft);`
5. **Dot matrix.** Idle/negative space that would otherwise be dead gets the `--tex-dots`
   background — a 1px dot on a 4px pitch at 14% opacity. Used on: topbar filler, empty states,
   axis-break bands, queue gutter. Never behind text.

**Colour discipline.** Charcoal + text tiers + **amber** carry ~95% of the pixels. Green and red
appear *only* as status verdicts (pass / fail) and never as decoration. Per-agent lane colours come
from run data (`agents[].color`, `agent_start.payload.color`) and are the only other hues on
screen; they appear on the lane rail, the lane's phase blocks, and that lane's event dots — nowhere
else.

**No status is ever colour-only.** Every pass/fail/running/queued state carries a glyph or a stamped
word alongside its colour.

---

## 2. Tokens

Lives at `src/styles/tokens.css`, imported first in `src/main.tsx`. Authored in OKLCH; the hex in
each comment is the resolved sRGB value (use it only where a hex string is genuinely required, e.g.
lane fallbacks that feed `hexAlpha()`). Contrast ratios in comments are measured against
`--surface-1`.

```css
:root {
  /* ── SURFACES ─ warm charcoal, hue 75°, chroma ≤ 0.009. Never blue-black. ── */
  --surface-0:  oklch(0.155 0.006 75);  /* #0e0c09  page void                          */
  --surface-1:  oklch(0.196 0.007 75);  /* #171512  default panel / plate              */
  --surface-2:  oklch(0.238 0.008 75);  /* #211e1b  raised: head-plate, table header    */
  --surface-3:  oklch(0.132 0.006 75);  /* #090706  engraved well: pre, JSON, troughs   */
  --surface-4:  oklch(0.276 0.009 75);  /* #2b2723  hover / pressed / selected row      */
  --surface-sunk: oklch(0.108 0.005 75);/* #060504  deepest — palette scrim base        */

  /* ── TEXT TIERS ── */
  --text-hi:    oklch(0.955 0.006 85);  /* #f2f0ec  16.0:1  headings, key values        */
  --text:       oklch(0.885 0.006 85);  /* #dbd9d5  12.9:1  body                        */
  --text-dim:   oklch(0.715 0.008 82);  /* #a5a39d   7.2:1  secondary, meta             */
  --text-faint: oklch(0.635 0.008 80);  /* #8d8a85   5.3:1  stamps, units — AA floor    */
  --text-ghost: oklch(0.470 0.007 78);  /* #5d5a56   2.7:1  NON-TEXT ONLY (glyphs+label)*/

  /* ── ACCENT ─ amber phosphor. The only accent. ── */
  --amber:        oklch(0.800 0.158 72); /* #fbab2f  9.5:1                              */
  --amber-bright: oklch(0.860 0.120 85); /* #f5cb70 12.1:1  hover / live peak           */
  --amber-dim:    oklch(0.660 0.125 70); /* #c2832d  5.7:1  pressed / secondary text    */
  --amber-wash:   oklch(0.800 0.158 72 / 0.10);  /* selected-row fill                   */
  --amber-edge:   oklch(0.800 0.158 72 / 0.42);  /* accent hairline                     */

  /* ── SEMANTIC ─ muted, desaturated. Verdicts only, never decoration. ── */
  --pass:         oklch(0.720 0.115 148); /* #70b87b  7.7:1                             */
  --pass-wash:    oklch(0.720 0.115 148 / 0.10);
  --fail:         oklch(0.640 0.155  27); /* #da6057  5.0:1                             */
  --fail-bright:  oklch(0.700 0.160  27); /* #f27166  6.4:1  on-hover / hatch           */
  --fail-wash:    oklch(0.640 0.155  27 / 0.10);
  --verdict:      oklch(0.730 0.145  52); /* #ee8b49  7.3:1  machinery-ok, verdict-fail */
  --verdict-wash: oklch(0.730 0.145  52 / 0.10);

  /* ── LANE FALLBACKS ─ hex, because they feed hexAlpha() and inline styles. ── */
  --lane-amber:  #f3a52b;  /* engineer lane (fixed)                          8.9:1 */
  --lane-steel:  #48bfbf;  /* code lane (fixed)                              8.2:1 */
  --lane-orchid: #b094e2;  /*                                                7.1:1 */
  --lane-oxide:  #7ec180;  /*                                                8.5:1 */
  --lane-slate:  #77b9e8;  /*                                                8.6:1 */
  --lane-rust:   #e47c75;  /*                                                6.5:1 */

  /* ── EDGES ─ machined lines. No blur, ever. ── */
  --edge:              oklch(0.320 0.008 75);          /* #35322e default hairline   */
  --edge-soft:         oklch(0.268 0.007 75);          /* #282522 quiet divider      */
  --edge-strong:       oklch(0.400 0.009 75);          /* #4b4742 structural rule    */
  --edge-light:        oklch(0.480 0.010 80 / 0.62);   /* top chamfer highlight      */
  --edge-light-faint:  oklch(0.480 0.010 80 / 0.24);   /* well bottom highlight      */
  --edge-shadow:       oklch(0.090 0.004 75 / 0.80);   /* bottom chamfer shadow      */
  --focus:             var(--amber);                   /* focus ring colour          */

  /* ── JSON TOKENS ─ remap of highlight.ts's .j-* classes ── */
  --j-key:   oklch(0.780 0.100  88);  /* #d2b46a  brass  */
  --j-str:   oklch(0.760 0.090 150);  /* #87c293  oxide  */
  --j-num:   oklch(0.820 0.140  72);  /* #fcb452  amber  */
  --j-bool:  oklch(0.760 0.085 215);  /* #6dbfd3  steel  */
  --j-null:  oklch(0.660 0.100  20);  /* #c87979  rust   */

  /* ── SPACING ─ 4px base. Use tokens; no raw px in component CSS except
        hairlines (1px), tick marks, and the fixed rail widths named in §5. ── */
  --sp-1:  2px;   --sp-2:  4px;   --sp-3:  6px;   --sp-4:  8px;
  --sp-5:  12px;  --sp-6:  16px;  --sp-7:  20px;  --sp-8:  24px;
  --sp-9:  32px;  --sp-10: 40px;  --sp-11: 48px;  --sp-12: 64px;

  /* ── RADII ─ chamfers. --r-3 is the hard ceiling. ── */
  --r-1: 1px;  /* troughs, tick marks, fills   */
  --r-2: 2px;  /* blocks, chips, inputs        */
  --r-3: 3px;  /* plates, panels, palette      */
  /* there is no --r-4. Pills do not exist in this app. */

  /* ── TYPE ─ fluid. Prose/data floor is 14px; only --fs-stamp goes below. ── */
  --fs-stamp: clamp(10.5px, 0.60rem + 0.08vw, 11.5px);  /* uppercase + tracked ONLY */
  --fs-micro: clamp(12px,   0.70rem + 0.10vw, 13px);    /* units, captions, counts  */
  --fs-sm:    clamp(13.5px, 0.78rem + 0.12vw, 15px);
  --fs-base:  clamp(15px,   0.86rem + 0.16vw, 16.5px);  /* body                     */
  --fs-md:    clamp(16px,   0.92rem + 0.22vw, 18px);
  --fs-lg:    clamp(18px,   1.02rem + 0.36vw, 22px);
  --fs-xl:    clamp(22px,   1.20rem + 0.70vw, 30px);
  --fs-2xl:   clamp(28px,   1.50rem + 1.30vw, 44px);

  --lh-tight: 1.10;  --lh-snug: 1.30;  --lh-base: 1.55;  --lh-loose: 1.70;
  --tr-stamp:   0.14em;   /* stamped labels        */
  --tr-display: 0.010em;  /* Archivo headings      */
  --tr-tight:  -0.010em;  /* --fs-xl and above     */

  /* ── FONTS ── */
  --font-display: 'Archivo', 'Archivo Fallback', sans-serif;
  --font-body:    'IBM Plex Sans', 'IBM Plex Sans Fallback', sans-serif;
  --font-mono:    'IBM Plex Mono', ui-monospace, monospace;

  /* ── MOTION ─ mechanical. transform + opacity only. ── */
  --ease-out-quart:   cubic-bezier(0.25, 1.00, 0.50, 1.00);
  --ease-out-quint:   cubic-bezier(0.22, 1.00, 0.36, 1.00);
  --ease-in-out-quart:cubic-bezier(0.76, 0.00, 0.24, 1.00);
  --ease-mech:        cubic-bezier(0.20, 0.90, 0.10, 1.00);  /* detented, slight snap */
  --dur-1: 90ms;   /* press feedback            */
  --dur-2: 150ms;  /* hover, chip state         */
  --dur-3: 220ms;  /* section open, block move  */
  --dur-4: 320ms;  /* plate reveal, palette in  */
  --dur-5: 480ms;  /* longest permitted         */
  --stagger-step: 22ms;   /* per-item list reveal delay */
  --stagger-cap:  11;     /* index is clamped to this   */

  /* ── Z-LAYERS ── */
  --z-base:     0;
  --z-block:   10;   /* phase blocks over gridlines      */
  --z-nowline: 20;   /* the advancing NOW rule           */
  --z-sticky:  30;   /* sticky section nav, ledger head  */
  --z-topbar:  40;   /* head-plate                       */
  --z-scrim:   60;   /* palette backdrop                 */
  --z-palette: 70;   /* command palette                  */

  /* ── TEXTURE ── */
  --tex-dots:
    radial-gradient(circle at 1px 1px, oklch(0.48 0.01 80 / 0.14) 1px, transparent 0);
  --tex-dots-size: 4px 4px;
  /* Diagonal hatch for running blocks / axis breaks. Animate background-position-x. */
  --tex-hatch:
    repeating-linear-gradient(135deg,
      transparent 0 6px,
      oklch(0.80 0.158 72 / 0.10) 6px 8px);
  --tex-hatch-fail:
    repeating-linear-gradient(135deg,
      transparent 0 6px,
      oklch(0.64 0.155 27 / 0.16) 6px 8px);
}
```

### 2.1 Fonts — exact packages

| Role | Package | Weights imported | Used for |
|---|---|---|---|
| Display | `@fontsource/archivo` | `600`, `700` | Wordmark, view titles, lane names, phase names, section stamps, readout values, run-strip request, docs `h1`/`h2` |
| Body | `@fontsource/ibm-plex-sans` | `400`, `500`, `600` | All prose, descriptions, blurbs, buttons, chips, empty-state copy |
| Data | `@fontsource/ibm-plex-mono` | `400`, `500` | ids, timestamps, durations, token counts, costs, JSON, code, prompts (raw), file names, command strings |

Imported in `src/main.tsx`, in this order, before `tokens.css`:

```ts
import '@fontsource/archivo/600.css'
import '@fontsource/archivo/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/tokens.css'
import './styles/base.css'
```

**Rationale (do not substitute):** Archivo is a grotesque cut from American industrial signage —
chunky, flat-sided, correct for a stamped head-plate. IBM Plex Sans was drawn for a machine
company; its flat terminals and slab-ish `l`/`i` read engineered without reading like a terminal.
IBM Plex Mono is its sibling, so ids and prose share a skeleton. Archivo alone would be shouty at
body size; Plex Sans alone would be soft at display size.

### 2.2 Typography rules

- **Tabular numerals are mandatory** on every number that changes or aligns:
  `font-variant-numeric: tabular-nums;` — timers, elapsed, costs, token counts, percentages, tick
  labels, event clocks, line counts, sizes, attempt counters. Provided by the `.tnum` utility in
  `base.css`; also baked into `--font-mono` usage.
- Monospace is for **ids, timestamps, durations, numbers, code, JSON, file paths, shell commands**.
  It is **not** the UI voice. A button label, a description, a blurb, a heading: body or display.
- `--fs-xl` and above: `font-family: var(--font-display); font-weight: 700;
  letter-spacing: var(--tr-tight);`
- Stamps: `font-family: var(--font-display); font-weight: 700; font-size: var(--fs-stamp);
  text-transform: uppercase; letter-spacing: var(--tr-stamp); color: var(--text-faint);`
- Body default: `--font-body` 400 / `--fs-base` / `--lh-base` / `--text`.
- Never `text-transform: lowercase` (the Vue app did this — drop it). Content casing is authored.

### 2.3 Motion rules

- Animate **`transform` and `opacity` only**. One exception: `width`/`left` on trace blocks and
  the context trough fill, which must transition (`--dur-3 var(--ease-out-quart)`) so live layout
  changes glide rather than jump.
- Durations 90–480ms. Easing from the token set; never `ease`, `linear` (except the running-hatch
  conveyor and the live-lamp tick), or a spring.
- **List reveal (staggered).** Global utility in `base.css`:
  ```css
  @keyframes plate-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .stagger-item {
    animation: plate-in var(--dur-4) var(--ease-out-quart) backwards;
    animation-delay: calc(min(var(--i, 0), var(--stagger-cap)) * var(--stagger-step));
  }
  ```
  Applied with `style={{ '--i': i } as CSSProperties}`. **Runs on first paint only** — gate with
  `useFirstPaint()` (§7.4) so the 500 ms poll never re-triggers it.
- **Live tick.** The live lamp and the running-block hatch are the only infinite animations.
  Lamp: `@keyframes lamp { 0%, 55% { opacity: 1 } 56%, 100% { opacity: 0.28 } }` at `1s steps(1,end)
  infinite` — a mechanical tick, not a breath. Hatch: `background-position-x` `0 → 8px` over
  `1.1s linear infinite`.
- **`prefers-reduced-motion: reduce`** — a single global block in `base.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  The NOW line still advances (it's data, positioned not animated). The live lamp settles to full
  opacity. No builder writes their own reduced-motion query.

### 2.4 Focus & keyboard

- `:focus-visible` everywhere: `outline: 2px solid var(--focus); outline-offset: 2px;
  border-radius: inherit;` Never `outline: none` without an equivalent replacement.
- Every interactive element is a real `<button>` or `<a>`. No `onClick` on a `<div>`.
- Tab order follows DOM order. The command palette traps focus while open and restores it on close.

---

## 3. Global stylesheet — `src/styles/base.css`

Owned by the scaffold agent. Contains, in this order:

1. `*, *::before, *::after { box-sizing: border-box }`, `html, body { margin: 0; padding: 0 }`.
2. `body` — `background: var(--surface-0);` plus a *fixed* `--tex-dots` layer at 40% strength
   (`background-attachment: fixed`), `color: var(--text)`, `font-family: var(--font-body)`,
   `font-size: var(--fs-base)`, `line-height: var(--lh-base)`,
   `-webkit-font-smoothing: antialiased`, `text-rendering: optimizeLegibility`.
   No radial aurora. No gradients.
3. `#root { min-height: 100vh; display: flex; flex-direction: column }`.
4. `a { color: var(--amber); text-decoration: none }` / `a:hover { color: var(--amber-bright) }`.
5. `button { font: inherit; color: inherit }`.
6. Focus-visible rule (§2.4).
7. `.tnum { font-variant-numeric: tabular-nums }`.
8. `.stamp` utility (§2.2 stamp recipe).
9. `.plate` utility — the machined-edge recipe (§1.1) on `--surface-1`, `border-radius: var(--r-3)`.
10. `.well` utility — the engraved recipe (§1.2), `border-radius: var(--r-2)`.
11. `pre` — `.well` + `--font-mono` / `--fs-sm` / `--lh-base` / `--text` / `padding: var(--sp-5)` /
    `overflow-x: auto` / `white-space: pre-wrap` / `word-break: break-word` / `margin: 0`.
12. **`.j-key/.j-str/.j-num/.j-bool/.j-null`** bound to `--j-*`. These class names are emitted by
    the untouchable `highlight.ts` and **must** exist globally. Add `.j-punct` is *not* needed.
13. **`.md`** block — rendered-markdown styling for `markdown.ts` output (headings h1–h4, p, code,
    `pre.md-code`, ul/ol/li, blockquote, hr, strong, a). Global, because the HTML is injected.
    Restyled to Machine Shop: `h1/h2` display font; inline `code` gets the engraved-well treatment
    at `--r-1`; `blockquote` gets a 2px `--amber-edge` left rule; `hr` is a double rule.
14. `.stagger-item` + `@keyframes plate-in` (§2.3).
15. `@keyframes lamp`, `@keyframes hatch-run`.
16. The reduced-motion block (§2.3) **last**.

Everything else is a CSS Module. No other global classes may be added.

---

## 4. Colour adapter — `src/theme/palette.ts`

`events.ts` is untouchable but its `EVENT_DOT_COLORS` and `AGENT_FALLBACK_COLORS` are the old neon
palette. This module is a **thin additive adapter** — it does not modify `events.ts`, it wraps it.
Owned by the scaffold agent. Every view imports colours from here, **never** `EVENT_DOT_COLORS` or
`agentColor` directly.

```ts
import type { EventRow } from '@/lib/types'

/** Machine-shop lane fallbacks, in assignment order. Hex, so hexAlpha() accepts them. */
export const LANE_FALLBACK: readonly string[]

/** Fixed lane colours for the two non-agent lanes. */
export const ENGINEER_COLOR: string   // '#f3a52b'  --lane-amber
export const CODE_COLOR: string       // '#48bfbf'  --lane-steel

/**
 * Lane colour with the original precedence: config colour → agent_start payload
 * colour → machine-shop fallback by index. Mirrors events.agentColor() but with
 * this palette's fallbacks.
 */
export function laneColor(
  configColor: string | null | undefined,
  payloadColor: string | null | undefined,
  index: number,
): string

/** Event-type dot colour, machine-shop remap. Returns null for untyped/unmapped events
 *  — exactly like events.dotColor(), so the "only mapped types get dots" rule survives. */
export function eventDotColor(type: string | null): string | null

/** CSS colour for an event type's label in the phase-detail event list.
 *  Replaces the Vue `typeClass` map. Returns a var() string. */
export function eventTypeVar(type: string | null): string
```

**Fixed values:**

```
LANE_FALLBACK  = ['#b094e2', '#7ec180', '#77b9e8', '#e47c75', '#48bfbf', '#f3a52b']
                   orchid     oxide      slate      rust       steel      amber

eventDotColor:  agent_start → #b094e2 (orchid)    agent_end → #7ec180 (oxide)
                tool_call   → #48bfbf (steel)     handoff   → #77b9e8 (slate)
                error       → #da6057 (fail)      gate_fail → #da6057 (fail)
                everything else → null

eventTypeVar:   gate_fail|error → var(--fail)     gate_pass|agent_end → var(--pass)
                tool_call → var(--lane-steel)     handoff  → var(--lane-slate)
                agent_start → var(--lane-orchid)  default  → var(--text-dim)
```

**Lane colours in CSS.** Pass the lane colour into CSS as a custom property and compose with
`color-mix`, rather than calling `hexAlpha()` for inline rgba:

```tsx
<div className={s.lane} style={{ '--lane': lane.color } as CSSProperties}>
```
```css
.block {
  background: color-mix(in oklab, var(--lane) 12%, var(--surface-1));
  border: 1px solid color-mix(in oklab, var(--lane) 45%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, var(--lane) 30%, transparent);
}
```

---

## 5. Layout blueprints

App shell: `#root` is a column flex. `<TopBar>` is `position: sticky; top: 0`. `<main>` is
`flex: 1; min-width: 0`. Content max width is **1680px**, centred, with `padding-inline: var(--sp-8)`
(`var(--sp-5)` below 720px) — except the ledger and the waterfall, which are full-bleed inside that
container.

Breakpoints: `1280px` (trace lane rail narrows), `1100px` (phase detail collapses to one column),
`860px` (ledger drops the trace strip and the stats column), `720px` (docs stacks, topbar drops the
wordmark to the mark only).

---

### 5.1 Top bar — the head-plate

`height: 56px` (fixed), `background: var(--surface-2)`, machined edge (§1.1) with a `--tex-dots`
layer at 60% opacity behind the empty middle, `border-bottom: 1px solid var(--edge-strong)` +
`box-shadow: 0 2px 0 -1px var(--edge-soft)` (the double rule). `z-index: var(--z-topbar)`.
`display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--sp-6);
padding-inline: var(--sp-8)`. **No blur, no transparency.**

**Left — brand mark + wordmark.**
Inline SVG, 24×24, geometry copied from `public/logo.svg` (three offset bars) but recoloured and
de-rounded: `rx="1"`, bar 1 `var(--amber)`, bar 2 `var(--text-dim)`, bar 3 `var(--edge-strong)`.
No drop-shadow. Beside it the wordmark **`SUPER SIMPLE SOFTWARE FACTORY`** — Archivo 700,
`--fs-stamp`, uppercase, `--tr-stamp`, `color: var(--text-hi)`, `white-space: nowrap`. Two lines is
acceptable at ≤ 1000px (`SUPER SIMPLE` / `SOFTWARE FACTORY`, `line-height: 1.05`); below 720px the
wordmark is hidden and only the mark remains. **Not a gradient.**

Then a 1px vertical rule (`--edge`, `height: 20px`).

**Centre — breadcrumbs.**
Separator is a `/` in `--text-ghost`, not `›`. Crumb text is `--font-mono` `--fs-sm`.

| Route | Crumbs |
|---|---|
| `#/` | `sessions` *(current)* |
| `#/<adw>` | `sessions` → `<adw_id>` *(current)* |
| `#/<adw>/<phase>` | `sessions` → `<adw_id>` → `<phase name ?? phase_id>` *(current)* |
| `#/docs` | `sessions` → `docs` *(current)* |

Non-current crumbs are `<a href={hrefFor(...)}>` in `--text-dim`, hover `--text-hi`. The current
crumb is a `<span>` in `--amber` with `font-weight: 500`. `min-width: 0` + ellipsis on the last
crumb.

**Right — controls.**
1. `⌘K` key-cap: a 22px-tall engraved plate (`.well`, `--r-2`, `padding: 0 var(--sp-3)`),
   `--font-mono --fs-micro`, `--text-faint`. Clickable → opens the palette. `title="Command palette"`,
   `aria-label="Open command palette"`. Shows `Ctrl K` when `navigator.platform` is not Mac-like.
2. `docs` link — `--fs-sm`, `--text-dim`; `--amber` when hovered or when the docs route is active.
3. A 1px vertical rule.
4. **Live indicator.** Replaces the glowing green dot. An 8×8 square, `border-radius: var(--r-1)`,
   plus a stamped word. Three states, driven by a `LiveState` prop from `App`:

   | State | Condition | Lamp | Word |
   |---|---|---|---|
   | `live` | last poll succeeded < 2500 ms ago | `--amber`, `lamp` tick animation | `LIVE` in `--amber` |
   | `stale` | last success 2500–8000 ms ago | `--amber-dim`, static | `STALE` in `--text-dim` |
   | `offline` | poll erroring, or > 8000 ms | `--fail`, static | `OFFLINE` in `--fail` |

   Plus a tabular `--fs-micro --text-faint` age readout (`fmtDuration` of the age, e.g. `0.4s`)
   when not `live`. `role="status"`, `aria-live="polite"`.

   **Evidence for the lamp** is two channels merged in `App`: the mounted view's own data poll
   (reported through `onPollHealth`) and a 2000 ms `fetchHealth()` heartbeat. The heartbeat is not
   redundant — the docs route polls nothing, so on its own the view channel would decay to
   `OFFLINE` against a perfectly healthy server. Freshness is the newer of the two successes; an
   error on either shows, with the view's message winning. A view's reported health is dropped when
   the view changes, so a failing trace cannot strand its error on the next route. The lamp's
   `title` names what it is speaking for: `` `${db}\n${sessions} sessions · journal_mode ${journal_mode}` ``.

---

### 5.2 Sessions list — the ledger

**Not a card grid.** A full-bleed ledger of runs, one row per run, hairline-separated, with a chunky
status block on the left edge of each row.

```
┌───────────────────────────────────────────────────────────── ledger head (sticky) ──┐
│ ▮ 14 RUNS                            RUN / WORKFLOW · REQUEST · PHASES · SPEND · STARTED │
╞══════════════════════════════════════════════════════════════════════════════════════╡
│▐│ a3f19c2b        │ this is the request text, truncated at one line…   │ ●●●◐○○ │  ×  │  ← plate (44px)
│▐│ adw_plan + …    │                                          $0.84 · 2m14s · 412k │     │
│▐├─ planner  ·─·──·─────·──·  ────────────────────────────────────────────────────┤     │  ← trace strip
│▐│  builder  ·  ·──··─····── ────────────────────────────────────────────────────┤     │
│▐│  0s      30s      1m      1m30s     2m                                        │     │  ← mini axis
╞══════════════════════════════════════════════════════════════════════════════════════╡
```

**Ledger head** — `position: sticky; top: 56px; z-index: var(--z-sticky)`, `--surface-2`, machined
edge, double rule below. Left: run count as `<strong class="tnum">{n}</strong> RUNS` (Archivo 700
`--fs-md` for the number, stamp for the word). Right: column stamps `RUN · WORKFLOW · REQUEST ·
PHASES · SPEND · STARTED`, `--text-faint`, hidden below 860px.

**Row** (`SessionRow`) is an `<a href={hrefFor(adw_id)}>` containing an inner `<button>` for archive.
`display: grid; grid-template-rows: auto auto;` `background: var(--surface-1)`,
`border-bottom: 1px solid var(--edge-soft)`, `padding: var(--sp-5) var(--sp-6) var(--sp-5) 0`,
`position: relative`.

- **Status block** — the memorable left edge. A **10px-wide** full-height flat bar at `left: 0`,
  `border-radius: var(--r-1) 0 0 var(--r-1)`:
  - `success` → `--pass`
  - `fail` → `--fail`, plus `--tex-hatch-fail` over it
  - `running` → `--amber`, plus `--tex-hatch` scrolling (`hatch-run`)
  - unknown/null → `--edge-strong`
- **Plate row** — `grid-template-columns: 200px minmax(0,1fr) auto auto 128px 28px;
  gap: var(--sp-6); align-items: baseline;` at `padding-left: calc(10px + var(--sp-6))`:
  1. **id + workflow** (stacked): `adw_id` in `--font-mono --fs-md` 500 `--amber`; below it
     `adw_name ?? '—'` in `--font-mono --fs-micro --text-dim`, ellipsised, `title` = full value.
  2. **request** — `--fs-base --text`, single line, ellipsis, `title` = full text. `—` in
     `--text-ghost` when null.
  3. **PhaseDots** (§7.6).
  4. **stats** — three `StatChip`s: cost, runtime (live duration), tokens.
  5. **started** — `fmtDate(started_at)`, `--font-mono --fs-micro --text-dim .tnum`.
  6. **archive button** — 24×24, `--r-2`, an `X` lucide icon at 15px, `--text-ghost`,
     `opacity: 0` until `:hover` on the row or `:focus-visible` on the button; hover →
     `background: var(--fail-wash); color: var(--fail-bright)`.
     `title="Archive — remove this run from review"`, `aria-label="Archive run"`.
     Handler: `preventDefault()` + `stopPropagation()` then optimistic emit (§8.3).
- **Trace strip** — the per-agent event timeline, at `padding-left: calc(10px + var(--sp-6) + 200px + var(--sp-6))`
  so it aligns under the request column. Height `= 20px × visibleRows + 16px` (axis).
  - Axis row (16px): `axisTicks(span, 5)` labels, `--font-mono --fs-stamp --text-ghost .tnum`,
    `transform: translateX(-50%)` except the `pct === 0` tick which is left-aligned. A 1px
    `--edge-soft` baseline under the labels.
  - One 20px row per agent: a 72px label column (`--fs-micro`, lane colour, ellipsis, `title` =
    `owner model`) then a track with `border-bottom: 1px solid var(--edge-soft)` and absolutely
    positioned dots.
  - **Dots** are 6×6 **squares** at `--r-1` (not circles — machined), `transform: translate(-50%,-50%)`,
    `top: 50%`, colour from `eventDotColor()`. The `latest` dot while running is 9×9 and **keeps its
    event-type colour** — liveness is carried by size plus a 1px `--amber` ring over a 1px
    `--surface-0` separator (`box-shadow: 0 0 0 1px var(--amber), 0 0 0 2px var(--surface-0)`) and
    the `lamp` animation. Filling it amber instead would spend the strip's one colour→data mapping
    on a state the size already states.
    `title` = `` `${type} ${eventLabel(e)} at ${fmtOffset(t - t0)}` ``.
  - Overflow: `MAX_VISIBLE_ROWS = 4`, `MIN_VISIBLE_ROWS = 3`; when `rows.length > 4`, show 3 and a
    final 20px row reading `+N MORE AGENTS` as a stamp.
  - No agent rows → a single 20px line: `NO AGENT ACTIVITY YET` as a stamp in `--text-ghost`, on a
    `--tex-dots` background.
  - Hidden entirely below 860px.
- **Hover** — `background: var(--surface-2)`; the status block brightens one step. `--dur-2`.
- **Keyboard selection** — the row carrying `data-selected` gets `background: var(--surface-4)` and
  `outline: 2px solid var(--amber); outline-offset: -2px`. See §6.2.
- **Reveal** — `.stagger-item` on first paint only.

**Foot rail** — the head plate's mirror, rendered only when there is at least one row:
`border-top: 1px solid var(--edge-strong)` plus `box-shadow: 0 -2px 0 -1px var(--edge-soft)` (the
double rule, inverted), `--tex-dots`, `padding-left: calc(10px + var(--sp-4))` so its stamp starts
on the head's run count. Left stamp `J K MOVE · ENTER OPEN · × ARCHIVE`; right stamp
`{n} SHOWN · ARCHIVED RUNS HIDDEN`, hidden below 860px. Without it the wall of runs trails off into
page background, and archiving removes rows with nothing on screen saying where they went.

**States.**
- Loading: skeleton — 6 ledger rows of `--surface-1` with a `--tex-dots` fill and a stamped
  `READING TRACE DB…` in the first row. No spinners, no shimmer sweep.
- Empty (loaded, zero sessions): see §5.6.
- API error: `<ErrorBar>` directly under the ledger head.

---

### 5.3 Session trace — swim lanes on a real time axis

Three stacked regions: **spec plate** → **waterfall** → **phase detail** (when a phase is selected).

#### 5.3.1 Spec plate (run strip)

A `.plate` at `margin: var(--sp-7) 0 var(--sp-6)`, `padding: var(--sp-6) var(--sp-7)`.

- Row 1: the request, Archivo 600 `--fs-lg`, `--text-hi`, clamped to 2 lines
  (`-webkit-line-clamp: 2`), `title` = full text.
- Row 2: an **instrument cluster** — a horizontal row of readouts separated by 1px `--edge` vertical
  rules, `gap: var(--sp-7)`, wrapping. Each readout is a `<Readout>`: a stamp on top, a tabular
  value below in Archivo 600 `--fs-md` (`--font-mono` for ids).

  | Stamp | Value | Source |
  |---|---|---|
  | `STATUS` | `<StatusChip>` | `session.status ?? 'fail'` |
  | `STARTED` | `fmtDate(started_at)` | |
  | `ELAPSED` | live `fmtDuration(sessionDurationMs)` | ticks while running |
  | `COST` | `fmtCost(total_cost)` | |
  | `TOKENS` | `fmtTokens(total_tokens)` | |
  | `READ` | `fmtTokens(usage.read)` | |
  | `WRITTEN` | `fmtTokens(usage.written)` | |

  The `TOKENS` / `READ` / `WRITTEN` / `COST` / `ELAPSED` readouts keep the exact explanatory
  `title` strings from `StatChip.vue` — that copy is load-bearing and must be preserved verbatim
  (see §8.7). Put them on the `<Readout>` wrapper.

#### 5.3.2 Waterfall

A `.plate` with `overflow: hidden`. Grid: `grid-template-columns: 260px 1fr 180px` —
**[lane rail] [time track] [queue gutter]**. At ≤1280px the rail is `200px`; the queue gutter
collapses to `0` and queued phases move to a strip below the waterfall.

Each row (axis row + one row per lane) is a subgrid sharing those columns. Column boundaries are 1px
`--edge` rules that run the full height of the waterfall.

> This is the **resting** geometry, and it is what the waterfall looks like unless follow mode is
> armed. Following swaps in a fourth column and a horizontal viewport so the NOW line can be pinned
> at 70% — see §6.5.1, which states this grid in the custom properties both cases share.

**Time mapping — real, with elided idle.** This is the core upgrade over the Vue version, which
faked positions by shifting blocks right. Blocks now sit at their true time; dead air is cut out
explicitly and *labelled*, so nothing lies.

Implemented as a pure module (`src/views/trace/timeScale.ts`, owned by the trace builder):

```ts
export interface Segment { t0: number; t1: number; x0: number; x1: number }  // x in 0..100
export interface Break   { t0: number; t1: number; x: number }               // x in 0..100
export interface TimeScale {
  t0: number; t1: number;
  segments: Segment[];
  breaks: Break[];
  /** ms → percentage across the track. Monotonic. */
  x(t: number): number;
  /** Percentage width for a duration starting at t. */
  w(tStart: number, tEnd: number): number;
  ticks: { x: number; label: string }[];
}
export function buildTimeScale(
  phases: Phase[], sessionStart: number, sessionEnd: number, nowMs: number,
): TimeScale
```

Algorithm, exactly:
1. `t0 = min(session.started_at, all phase started_at)`; `t1 = max(session.ended_at, all phase
   started_at/ended_at, and nowMs when status === 'running')`. Enforce `t1 - t0 ≥ 1000`.
2. Collect **activity intervals**: for every phase with a finite `started_at`, `[start, end]` where
   `end = ended_at ?? (status === 'running' ? nowMs : start)`. Merge overlapping/adjacent intervals.
3. A **gap** between merged intervals qualifies as a break when its duration
   `> max(0.18 * (t1 - t0), 30_000)`. At most **3** breaks; keep the longest three.
4. Every break consumes a fixed **`BREAK_PCT = 2.2`** of track width. The remaining
   `100 - breaks*2.2` is distributed across the non-break segments **proportionally to their real
   duration**. Within a segment the mapping is linear — so relative durations inside a segment are
   exactly true.
5. `ticks` = for each segment, `axisTicks(segment duration, ceil(7 * segmentShare))` mapped into
   that segment's `[x0, x1]`, labelled with `fmtOffset(segment.t0 - t0 + tickOffset)` so labels are
   cumulative offsets from run start.
6. When there are no qualifying gaps, `segments` has exactly one entry spanning `0..100` — a plain
   linear axis. **This is the common case; it must be the obvious code path.**

> The Vue `REQ_ZONE_PCT` / `MIN_BLOCK_PCT` / cumulative-shift machinery is **deleted**. Idle time is
> elided honestly instead of blocks being pushed around silently.

**Axis row** — 40px, `--surface-2`, machined edge, double rule below.
- Tick marks: a 6px tall 1px `--edge-strong` line rising from the bottom of the axis row at each
  tick `x`, with the label above it in `--font-mono --fs-stamp --text-dim .tnum`,
  `transform: translateX(-50%)` (the `x === 0` tick is left-aligned, the `x` closest to 100 is
  right-aligned).
- **Break band** at each `Break.x`: a `BREAK_PCT`-wide full-height band with `--tex-dots` and two
  1px `--edge-strong` diagonal hairlines (a chevron notch, drawn with a `linear-gradient`), plus a
  vertical stamp above the axis reading `⟨ {fmtOffset(t1-t0)} IDLE ⟩` (rotated `-90deg` when the
  band is narrower than the label, else placed in a tooltip only). Always carries
  `title={`${fmtOffset(gap)} with no phase activity — axis compressed`}`.
- **NOW tab** while running: at `x(nowMs)`, a small amber plate (`padding: 1px var(--sp-3)`,
  `--r-1`, `background: var(--amber)`, `color: var(--surface-0)`, `--font-mono --fs-stamp .tnum`)
  showing the live `fmtOffset(now - t0)`. `transform: translateX(-50%)`, clamped inside the track.

**Lane rail** (260px, `border-right: 1px solid var(--edge)`, `padding: var(--sp-5) var(--sp-6)`):
- Kind icon at 18px in the lane colour, `stroke-width: 2`:
  `engineer → UserRound`, `code → SquareTerminal`, `agent → Bot`.
- Lane name — Archivo 600 `--fs-md`, lane colour, ellipsis.
- Model row (agent lanes with a known model): 16px provider icon from `modelIcon()` +
  `modelName(model)` in `--font-mono --fs-micro --text-dim`; `title` = the full model id.
- `metaLines` (engineer → `engineer`, code → `workspace`) as a stamp.
- **Context gauge** (agent lanes where both `context_tokens` and `context_window` are truthy):
  - head: stamp `CTX` on the left, percentage on the right in `--font-mono --fs-micro --text-dim
    .tnum` — `<1%` renders to one decimal (`0.4%`), otherwise rounded (`38%`).
  - trough: 6px tall, `max-width: 190px`, `.well`, `--r-1`, with **engraved graduations**: 1px
    `--edge` lines at 25/50/75% drawn via a `repeating-linear-gradient`.
  - fill: flat lane colour (no gradient, no glow), `width: max(pct, 2%)`,
    `transition: width var(--dur-3) var(--ease-out-quart)`.
  - `title` = `` `${NUM.format(used)} / ${NUM.format(window)} tokens used · ${NUM.format(window - used)} remaining` `` (en-US grouping) — verbatim from the Vue version.

**Lane track** — `height: 72px`, `position: relative`, `overflow: hidden`,
`border-bottom: 1px solid var(--edge-soft)` (none on the last lane).
- Gridlines: 1px `--edge-soft` verticals at each tick `x`, full height. **Solid, not dashed.**
- Break bands repeat here, full height, `--tex-dots` + the two diagonal hairlines.
- **NOW line** while running: `position: absolute; top: 0; bottom: 0; width: 1px;
  background: var(--amber); z-index: var(--z-nowline);` at `left: x(nowMs)%`, spanning the whole
  waterfall (rendered once as an overlay across all lane tracks, not per lane).
  `pointer-events: none`. Updated by `useNow(250)`; **not** a CSS animation.

**Phase block** (`PhaseBlock`) — a machined segment:
- Geometry: `left: scale.x(start)%`, `width: scale.w(start, end)%`, `min-width: 6px`,
  `top: 12px`, `height: 48px`, `border-radius: var(--r-2)`,
  `transition: left var(--dur-3) var(--ease-out-quart), width var(--dur-3) var(--ease-out-quart)`.
  `end = ended_at ?? (running ? nowMs : start)`.
- Fill/border/top-light per §4's `color-mix` recipe on `--lane`.
- Content, only rendered when the block's measured width `≥ 120px` (see label rule below):
  - line 1: status glyph + name + compact runtime `StatChip`, `align-items: baseline`,
    `gap: var(--sp-4)`, the chip pushed right with `margin-left: auto`. **The chip is dropped below
    a measured 190px** (`blockShowsDuration`): between 120 and 190 the two cannot coexist without
    the name ellipsising to a letter, and the duration is on the block's `title` for every block
    while the name is recoverable from nowhere else.
  - line 2: `description`, `--fs-micro --text-dim`, one line, ellipsis.
- **Status glyph** (never colour-only): `success ✓` `--pass` · `fail ✗` `--fail` ·
  `running ●` `--amber` · `queued ○` `--text-ghost` · verdict-fail `✗` `--verdict`.
  15px, `flex: none`.
- **Label overflow rule.** The block measures itself with a `ResizeObserver` (or simply compares its
  computed percentage against the track width captured by one `ResizeObserver` on the track — one
  observer for the whole waterfall, passed down as `trackPx`). If `widthPct/100 * trackPx < 120`,
  the block renders only the status glyph, and the name is rendered as a **floating label**:
  absolutely positioned in the lane track at `left: calc({x}% + 8px)`, `--fs-micro`, lane colour,
  `white-space: nowrap`, `pointer-events: none`, `z-index: var(--z-block)`. The floating label is
  suppressed when the next block in the same lane starts within 90px. Never overlap; never truncate
  to nothing — the full name is always in the `title` and in the phase detail.
- **States:**
  - `success` — the base recipe.
  - `running` — a 2px `--amber` left edge (`border-left-width: 2px; border-left-color: var(--amber)`)
    plus a `--tex-hatch` overlay running the `hatch-run` conveyor. **No pulse on the whole block.**
  - `fail` — `border-color: var(--fail)`, `--tex-hatch-fail` overlay, 2px `--fail` bottom edge.
  - `verdict-fail` (`status === 'success'` **and** the phase's envelope payload has
    `passed === false`) — `border-color: var(--verdict)`, glyph `✗` in `--verdict`, **and** a stamped
    `VERDICT` micro-label in `--verdict` pinned to the block's bottom-right. Colour is never the only
    signal.
  - `selected` — `outline: 2px solid var(--amber); outline-offset: 2px;` and
    `background: color-mix(in oklab, var(--lane) 20%, var(--surface-1))`.
  - hover — `background: color-mix(in oklab, var(--lane) 20%, var(--surface-1))`, `--dur-2`.
- **Tool ticks** — for each `tool_call` event in the phase, a mark on the block's bottom edge at
  `left: clamp(1%, ((t - start)/(end - start))*100%, 99%)`:
  `ok` → 1px × 8px, `background: var(--text-faint)`, `opacity: 0.55`;
  `!ok` (`payloadOk(payload_json) === false`) → 2px × 10px, `background: var(--fail)`, `opacity: 1`.
  `bottom: 0`, `--r-1`, `pointer-events: none`.
- `title` = `` `${name} — ${status}${verdictFail ? ' (verdict: fail)' : ''}${Number.isFinite(duration) ? ` · ${fmtDuration(duration)}` : ''}${description ? `\n${description}` : ''}` ``.
  The duration is **unconditional**: a compact block has traded its body for a glyph, so the tooltip
  is the only place its runtime survives at all.
- Click → `navigate(adwId, phaseId === selected ? null : phaseId)` (toggle, verbatim behaviour).

**Queue gutter** (180px, right column, `border-left: 1px solid var(--edge)`, `--tex-dots`
background): phases with no `started_at`, stacked vertically per lane row, each a 22px dashed chip —
`border: 1px dashed var(--edge-strong)`, `--r-2`, `--text-ghost`, `○` glyph + name (ellipsis),
`title` = `` `${name} — queued` ``. Header stamp `QUEUE` in the axis row's gutter cell. Clicking a
chip selects that phase (same toggle). Below 1280px the gutter becomes a horizontal wrap strip under
the waterfall with the same stamp.

**Foot rail** — under the waterfall (and the inline queue strip), rendered whenever the run has
phases: `border-top: 1px solid var(--edge)`, `--tex-dots`, left stamp
`J K LANE · ← → PHASE · ENTER OPEN · ESC BACK`, right stamp `{lanes} LANES · {phases} PHASES`
(hidden below 860px). The lane grid is keyboard-first and nothing else on the view says so; it also
closes the plate stack instead of letting it trail into page background.

**States.**
- Loading: `READING TRACE…` stamp on a `--tex-dots` plate at 200px tall.
- Loaded, zero phases: §5.6 empty state.
- API error: `<ErrorBar>` above the spec plate.

#### 5.3.3 Phase detail — the instrument panel

Rendered **below** the waterfall in normal flow (not a modal — the trace must stay visible and the
deep link `#/<adw>/<phase>` must render the same thing on a cold load). A `.plate`,
`margin-bottom: var(--sp-9)`.

**Header** — `--surface-2`, machined, double rule below, `padding: var(--sp-5) var(--sp-6)`,
`display: flex; gap: var(--sp-6); align-items: center; flex-wrap: wrap`:
phase name (Archivo 700 `--fs-lg` `--text-hi`) · `<StatusChip>` · runtime `<StatChip>` (live while
running) · then, pushed right with `margin-left: auto`, three `<Tag>`s — `OWNER`, `KIND`,
`ATTEMPT {attempt ?? 0}/{retries ?? 0}` — then a close `<button>` (lucide `X`, 16px,
`title="close"`, `aria-label="Close phase detail"`) → `navigate(adwId)`.

`phase.error` → `<ErrorBar>` immediately under the header.

**Body** — `display: grid; grid-template-columns: 168px minmax(0, 1.05fr) minmax(0, 1.35fr);
gap: var(--sp-8); padding: var(--sp-6)`.

1. **Section nav rail** (168px) — `position: sticky; top: 96px; align-self: start;
   z-index: var(--z-sticky)`. A vertical list of stamped links, one per *present* section, in the
   order below. Each entry: a 2px left rule (`--edge` → `--amber` when it is the active section),
   the stamp, and a right-aligned tabular count when the section has one. Clicking scrolls the
   section into view (`scrollIntoView({ block: 'start', behavior: 'smooth' })`) **and** opens it.
   Active section tracked with an `IntersectionObserver` over the section elements.
   Below 1100px the rail becomes a horizontally scrolling strip above the columns.
2. **Left column** — the `<DetailSection>` stack (all collapsed by default; §8.5 lists them).
3. **Right column** — the events list.

**Events list** (right column). Header: stamp `EVENTS` + tabular count + a lucide `Activity` icon,
on a hairline rule. Then one `<EventRow>` per event, `border-bottom: 1px solid var(--edge-soft)`:

```
[ 14:32:07 ] [ tool_call  ] bash: bun test src/…                    [ ⏱ 1.4s ] [ ◎ 2.1k ]
```
- clock — `fmtClock(started_at)`, `--font-mono --fs-micro --text-dim .tnum`, `flex: none`.
- type — fixed 130px, `--font-mono --fs-micro`, colour from `eventTypeVar(type)`.
- label — `eventLabel(e)`, `--font-mono --fs-sm`, ellipsis, `title` = same string.
  `color: var(--fail)` when `type === 'tool_call' && !payloadOk(payload_json)`.
- right cluster — compact runtime `StatChip` when `eventDurationMs` is finite, compact tokens
  `StatChip` when `e.tokens`.
- The whole row is a `<button>`; hover/open → `background: var(--surface-2)`.
- Expanded payload panel: a `.well` at `margin: var(--sp-3) 0 var(--sp-5)`, `padding: var(--sp-5)`,
  containing the four cases in §8.5 (rich tool call / legacy tool call / generic payload / none).
  `<pre>` blocks cap at `42vh` with `overflow: auto`.

---

### 5.4 Docs view

Max width **920px**, centred, `padding-block: var(--sp-9) var(--sp-12)`.

**Head plate** — a `.plate` with a lucide `BookOpen` at 20px in `--amber`, `h1` **`COMMANDS`**
(Archivo 700 `--fs-xl`, uppercase, `--tr-display`), and the sub-paragraph in `--fs-base --text-dim`,
`max-width: 72ch`. The two inline `<code>` fragments (`justfile`, `SSSF_CONFIG=other.yaml`) use the
`.well` inline-code treatment in `--amber-dim`. **The sub-paragraph copy is preserved verbatim.**

**Group plate** — one per `GROUPS` entry, `margin-top: var(--sp-9)`, `.plate`, `overflow: hidden`,
with a **3px accent rail** at `inset: 0 auto 0 0` in `var(--accent)` (opaque, no opacity fade).
Header row: `h2` in Archivo 700 `--fs-md` uppercase `--tr-stamp` `--text-hi`, with a hairline
`--tex-dots` filler stretching to the right edge. Blurb: `--fs-sm --text-faint`, `max-width: 80ch`.

**Accent remap** (the old vars are gone):

| Group | Old | New |
|---|---|---|
| First run | `--green` | `var(--pass)` |
| Run a workflow | `--purple` | `var(--lane-orchid)` |
| Validate the running app | `--cyan` | `var(--lane-steel)` |
| Watch it | `--blue` | `var(--lane-slate)` |
| Wait & intervene | `--amber` | `var(--amber)` |
| Update | `--violet` | `var(--lane-rust)` |

**Command row** — `display: grid; grid-template-columns: 260px minmax(0,1fr); gap: var(--sp-7);
padding: var(--sp-5) 0; border-top: 1px solid var(--edge-soft)`:
- **Key-plate button** — the copy target. `.well`, `--r-2`, `padding: var(--sp-3) var(--sp-5)`,
  `--font-mono --fs-sm --text`, with a lucide `Copy` (14px, `--text-ghost`) pushed right; on hover
  `border-color: var(--accent)` and the icon takes `--accent`; on copy the icon swaps to `Check` in
  `--pass` for **1400 ms**. `title` = `` `copy: ${example ?? cmd}` ``. Copies `example ?? cmd`.
- Body: `what` in `--fs-sm --text-dim`; `example` (when present) as an inline `.well` chip in
  `--font-mono --fs-micro --text-faint`, `overflow-wrap: anywhere`.
- Below 720px the grid becomes one column and the key-plate goes full width.

`GROUPS` (title / blurb / commands / examples) is **copied verbatim** from `DocsView.vue`. It is
content, and it mirrors the stamped justfile. Do not paraphrase, do not reorder, do not "improve"
the wording. Only the `accent` field changes, per the table above.

---

### 5.5 Error bar

`<ErrorBar>` — full width of its container, `padding: var(--sp-4) var(--sp-6)`,
`background: var(--fail-wash)`, `border-block: 1px solid var(--fail)`, `--r-2`,
`--font-mono --fs-sm --fail-bright`, with a 6px `--tex-hatch-fail` strip on the left edge and a
lucide `TriangleAlert` at 15px. `role="alert"`. Content:

```
API UNREACHABLE — RETRYING   ·   <message>   ·   <n> attempts   ·   last ok <fmtDuration(age)>
```

The stamped prefix is uppercase; the message keeps its original casing. The attempt counter and age
are tabular and tick live. Sticky under the topbar (`position: sticky; top: 56px;
z-index: var(--z-sticky)`) inside the sessions and trace views.

### 5.6 Empty states — teach the interface

`<EmptyState>` is never a shrug. Every one has: a stamped title, one sentence of what is missing and
why, and a **concrete next action** — usually a copyable command. Layout: a `.plate` with a
`--tex-dots` fill, `padding: var(--sp-11) var(--sp-8)`, `max-width: 560px`, centred,
`text-align: left`.

| Where | Title (stamp) | Body | Action |
|---|---|---|---|
| Sessions, zero runs | `NO RUNS RECORDED` | "The trace database exists but holds no sessions. Every `just` recipe that runs an agent writes one." | copy-plate `just demo` + link `→ all commands` (`#/docs`) |
| Trace, zero phases | `NO PHASES RECORDED` | "This session id exists but no phase ever started. The workflow may have failed before its first phase, or the id may be from another repo's database." | link `← back to sessions` |
| Phase detail, empty section | *(inline)* | one line in `--text-faint`, e.g. `no gate results`, `no outputs`, `no events`, `no compiled prompts recorded` | — |
| Palette, no matches | `NO MATCH` | "Nothing in this run's index matches that. Try an adw id, a phase name, or `docs`." | — |
| Session row, no agent activity | *(inline stamp)* | `NO AGENT ACTIVITY YET` | — |

Inline empties inside `<DetailSection>` keep the **exact strings** listed in §8.5 — they are the
parity contract.

---

## 6. New UX

### 6.1 Command palette (`Cmd/Ctrl + K`)

**Decision: custom implementation, no `cmdk`.** `cmdk` drags in Radix dialog primitives and a DOM
shape that fights the machined look, for behaviour that is ~180 lines here. Owned by the docs
builder (§7.7 builder D).

**Open/close.** `Cmd+K` / `Ctrl+K` anywhere (`preventDefault`), or clicking the topbar key-cap.
`Esc` closes. Clicking the scrim closes. Opening captures `document.activeElement` and restores
focus on close. Focus is trapped inside the panel while open. `body` keeps its scrollbar
(`overflow: hidden` on `#root`, not `body`, to avoid layout shift).

**Chrome.** Not a floating rounded card. A **drawer plate** that slides down from beneath the head
plate: `position: fixed; top: 56px; left: 50%; transform: translateX(-50%);
width: min(720px, calc(100vw - var(--sp-8) * 2)); z-index: var(--z-palette)`. `--surface-2`,
`border: 1px solid var(--edge-strong)`, `--r-3`, machined edges, **no shadow** — separation comes
from the scrim. Entry: `translateY(-8px) → 0` + `opacity 0 → 1` over `--dur-4 var(--ease-out-quint)`.
Scrim: `--surface-sunk` at `opacity: 0.72`, `z-index: var(--z-scrim)`, fades over `--dur-3`. No blur.

**Input row** — 48px, `border-bottom: 1px solid var(--edge)`. A `>` prompt caret in `--amber`
(`--font-mono`), then an unstyled `<input>` (`--font-mono --fs-md --text-hi`,
`background: transparent`, `border: 0`, `outline: 0`), `placeholder="jump to a run, a phase, or a page"`,
`spellCheck={false}`, `autoComplete="off"`, `aria-label="Command palette search"`.

**Results** — `max-height: min(52vh, 480px)`, `overflow-y: auto`, `role="listbox"`. Grouped by
kind, each group preceded by a sticky stamp header (`RUNS`, `PHASES`, `PAGES`, `ACTIONS`). Each row
(`role="option"`, `id="cmdk-opt-{i}"`) is 40px:

```
[SESSION] a3f19c2b   add a /health endpoint                      ✓ success  2m14s
[PHASE  ] plan       planner · produce an implementable spec        ● running
[PAGE   ] docs       every recipe the justfile ships
```
- kind tag: a stamp in a 68px fixed cell, `--text-ghost`.
- primary: `--font-mono --fs-sm --text-hi`; matched characters wrapped in `<mark>` —
  `background: var(--amber-wash); color: var(--amber-bright)`, no other styling.
- secondary: `--fs-sm --text-dim`, ellipsis.
- trailing: status glyph + word (`StatusChip` in a compact variant) and a tabular duration.
- Active row: `background: var(--surface-4)`, a 2px `--amber` left rule, `--text-hi`.
  `aria-activedescendant` on the input points at it. Auto-scrolled with
  `scrollIntoView({ block: 'nearest' })`.

**Footer rail** — 30px, `border-top: 1px solid var(--edge)`, `--tex-dots`, stamps:
`↑↓ MOVE · ↵ OPEN · ESC CLOSE`, and on the right the result count, tabular.

**Index.** Built on open and refreshed while open (5 s interval; the palette never polls when
closed):
1. **Runs** — every session from `fetchSessions()`. Search text = `adw_id + adw_name + request`.
   Action: `navigate(adw_id)`.
2. **Phases** — every phase of the *currently viewed* session (`snapshot.phases` passed from `App`,
   §7.2). Search text = `name + owner + description`. Action: `navigate(adwId, phase_id)`.
3. **Pages** — `sessions` (`#/`) and `docs` (`#/docs`), always present.
4. **Actions** — when a session is open: `copy adw id`, `archive this run`.

**Match algorithm** (`src/views/docs/fuzzy.ts`, pure, exported for testability):
subsequence match over the lowercased haystack; score `+10` per matched char, `+18` extra when the
match is contiguous with the previous one, `+24` when a match lands at index 0 or right after a
non-alphanumeric, `-1` per skipped char. Non-matching items are dropped. Sort by score desc, then by
original order. Empty query → everything, in natural order (runs newest-first, then phases in `seq`
order, then pages, then actions), capped at **40** rows.

**Keys inside the palette:** `↓`/`Ctrl+N`/`Tab` next · `↑`/`Ctrl+P`/`Shift+Tab` previous ·
`Enter` activate · `Esc` close · `Home`/`End` jump. Selection wraps.

### 6.2 Keyboard navigation

A shared hook, `useListKeyboardNav` (§7.4), drives every list. Bound at the **view** level on a
container with `tabIndex={-1}`, so the keys work without a click as long as focus is inside the view
(the views focus their container on mount).

| Key | Sessions ledger | Trace waterfall | Phase detail |
|---|---|---|---|
| `j` / `↓` | next run | next lane | next event row |
| `k` / `↑` | previous run | previous lane | previous event row |
| `h` / `←` | — | previous phase in lane | — |
| `l` / `→` | — | next phase in lane | — |
| `Enter` | open the run | open the selected phase's detail | expand/collapse the event |
| `Esc` | clear selection | if a phase is selected → `navigate(adwId)`; else → `navigate()` (back to sessions) | close the detail |
| `g g` / `G` | first / last row | first / last lane | first / last event |
| `f` | — | follow the run — arm / resume / disarm (§6.5) | — |
| `/` | focus… *(reserved, not implemented)* | | |

Rules: keys are ignored when the event target is an `<input>`/`<textarea>`, or when a modifier other
than shift is held (so `Cmd+K` always wins). The selected element gets `data-selected` and is
scrolled with `scrollIntoView({ block: 'nearest' })`. Selection index resets when the underlying id
list changes identity but is **preserved across polls** (match by id, not by index).

### 6.3 Live tickers

`useNow(intervalMs)` (§7.4) returns `Date.now()` on an interval and is the **only** source of "now"
for rendering. Rules:

- Interval **250 ms** for the trace view (NOW line, elapsed readout, running block widths) while
  `session.status === 'running'`; the hook returns a frozen value and clears its timer otherwise.
- Interval **1000 ms** for the sessions ledger's per-row durations (a ledger of 50 rows does not
  need 4 Hz).
- Every ticking number uses `.tnum` and a fixed-width format so digits do not jitter.
- `useNow` uses one `setInterval` per subscriber, cleared on unmount; it must never `setState` after
  unmount.

### 6.4 Failure triage & the repro bundle

When a run breaks, the engineer reconstructs the story by clicking phases until they find the red
one, then opens four sections to learn why, then retypes all of it into a debugging session. Both
halves of that are deleted here: a plate that **leads with the failure**, and one button that puts
the whole story on the clipboard as markdown.

Owned by the trace builder (view B). Two new files in `views/trace/` — `TriagePanel.tsx` +
`.module.css`, and `reproBundle.ts`.

**One sanctioned cross-view edge.** `reproBundle.ts` is the shared bundle builder and both views use
it: `views/trace/TriagePanel` and `views/phase/PhaseHeader`. It reads its derivations from
`views/phase/phaseData` (`phaseEventsOf`, `phaseGatesOf`, `phaseOutputsOf`, `gateChecksOf`,
`violationsOf`, `eventDurationMs`) rather than reimplementing them, and re-exports
`phaseFailureEvents` / `phaseReportExcerpt` so the panel never has to reach into `views/phase`
itself. This widens §7.1's "views must never import from another view's directory" by exactly one
module, declared here so it is not an accident. There is no cycle: `phaseData` imports only `lib/`.

#### 6.4.1 When the plate appears

The panel renders **above the spec plate** in `SessionTrace`, and returns `null` otherwise. A phase
qualifies as a failure when **either** is true:

1. `phase.status === 'fail'`, or
2. a gate against it is **still failing on its latest attempt**.

Rule 2 is `latestGates()`: the newest attempt of every `(phase_id, gate)` pair wins, and only that
row's verdict counts. A gate that failed on attempt 1 and passed on attempt 2 was retried and
resolved — carrying the stale failure forward would stamp a red plate across a green run, which is
the one thing triage must never do. Failed gates the tracer wrote against no known phase get their
own section rather than being attributed to a phase that did not earn them.

Failures are ordered by `started_at` (unstarted last), tie-broken by `seq`, so **the plate leads
with the root cause** and the rest are listed compactly.

**Error-class events** are the two members of `EventType` that mean something went wrong — `error`
and `gate_fail` — plus `tool_call` rows where `payloadOk(payload_json) === false`. The third is not
error-class in the taxonomy, but a run that died on a bad bash call has its cause there and nowhere
else, so it is carried alongside and rendered as `✗ tool_call` in `--fail` instead of the steel that
`eventTypeVar()` would give it. Colour is never the only signal: the `✗` rides with it.

#### 6.4.2 Chrome

A `.plate` with a **3px `--fail` verdict rail** down its left side. Not a tinted panel — red is a
verdict here, and it appears only on the rail, the warn glyph, the gate marks and the failed-tool
glyph, never as a wash behind text.

**Head-plate** — `--surface-2`, machined edge, double rule below, `padding: var(--sp-4) var(--sp-6)`:
`DetailSection`'s disclosure conventions (a `ChevronRight` at 14px rotating 90°, `aria-expanded`,
`aria-controls`, the stamp, the dotted `--tex-dots` filler) on a `<button>` that grows, **beside** a
`<CopyPlate>` that does not. The component itself cannot be `DetailSection` — its head is a
full-width button, and a button may not contain another button.

- stamp `FAILURE TRIAGE` in `--fail-bright`, with a lucide `TriangleAlert` at 16px in `--fail`.
- verdict readout, `--font-mono --fs-micro --text-dim .tnum`: `{n} failed phases · {m} failed gates`,
  pluralised, the gate clause dropped at zero.
- **`COPY REPRO BUNDLE`** — `<CopyPlate>` with `accent="var(--fail-bright)"`, **restamped** by a
  **two-class** rule (`.head .copy`) so the override lands whatever order the CSS modules end up in
  the bundle. It stays visible while the panel is collapsed: the collapsed plate is still the fastest
  path to the clipboard.

  The restamp is not decoration. `CopyPlate` is drawn for shell commands — docs rows and empty
  states — so its own type is `--font-mono` at `--fs-sm`, and its label is whatever string it will
  put on the clipboard. Here the label is an *action*, not a command, and §2.2 keeps mono out of the
  UI voice: a button label is body or display. So the two-class rule re-types it as a stamp —
  `--font-display` 700, `--fs-stamp`, `text-transform: uppercase`, `letter-spacing: var(--tr-stamp)`
  — which is also why it may sit below the 14px prose floor (§1.3). The label inherits from `.plate`,
  so restamping the button restamps its text without reaching into `CopyPlate`'s own module. Authored
  casing stays lowercase, exactly as every other stamp in the app: the uppercase is presentation, and
  the accessible name a screen reader announces is still "copy repro bundle".

**Collapse state is remembered per session** in `sessionStorage` under
`sssf.triage.collapsed:<adwId>` — `'1'` means collapsed, absent means open. A failure is loud by
default; dismissing it must survive a reload of the same run without following the engineer into the
next one. Storage access is wrapped: a denied `sessionStorage` (private mode, cookie policy) degrades
to "always open", never to a crash.

**Body** (`padding: var(--sp-6)`):

1. **The root cause**, always visible — a 10px `--r-1` lane-colour chip (the lane's colour passed in
   as `--lane`, §4), the phase name as an `<a href={hrefFor(adwId, phaseId)}>` **deep link** in
   display 700, `<StatusChip>`, a compact runtime `<StatChip>`, then pushed right: `<ModelBadge>` and
   three `<Tag>`s — `KIND`, `OWNER`, `ATTEMPT {attempt}/{retries}`. The attempt tag takes
   `tone="fail"` **only when the retries actually ran out** (`retries > 0 && attempt >= retries`); a
   phase that failed on its first and only attempt exhausted nothing, and saying so in red would be
   an invention. Then the description, then `phase.error` in an `<ErrorBar label="Phase failed">`.
2. **`FAILED GATES`** — a `<DetailSection>`, open by default. One plate per gate with a 3px `--fail`
   left rule, the `✗` mark, the gate name, an `ATTEMPT` tag, a tabular `fmtClock`, and its violation
   list in `--fail`. Repeated violation strings are keyed by text-plus-occurrence, exactly as
   `GatesSection` does.
3. **`GATES WITHOUT A PHASE`** — same rendering, only when loose gates exist.
4. **`ERROR EVENTS`** — a `<DetailSection>`, open by default. The **last 8**, chronological:
   `fmtClock` · type · `eventLabel(e)`; over 8 a `--text-faint` line says how many were withheld and
   where the rest live.
5. **`FINAL REPORT`** — closed by default, present only when the phase's last envelope carries
   something. Prose fields (`summary`, `report`, `message`, `reason`, `notes`, `details`, `error`,
   `output`, in that order) win over the raw envelope, trimmed to **480 chars**. Prose renders in an
   engraved well in the **body** font — an engraved well holding text is still a well, but mono is
   for ids, code and data, never for the app's voice. Only the serialised-JSON fallback gets `<pre>`.
6. **`ALSO FAILED`** — closed by default, one compact row per remaining failure: lane chip, deep
   link, compact `<StatusChip>`, and `{n} gates · {n} errors · {clock}`.

#### 6.4.3 The bundle — `views/trace/reproBundle.ts`

```ts
export const SECTION_LIMIT = 15_000
export const EXCERPT_LIMIT  = 480

export const ERROR_EVENT_TYPES: ReadonlySet<string>   // 'error' | 'gate_fail'
export function isErrorEvent(e: EventRow): boolean
export function isFailedToolCall(e: EventRow): boolean
export function failureEventsOf(events: EventRow[]): EventRow[]

/** Newest attempt of every (phase_id, gate) pair. */
export function latestGates(gates: GateResult[]): GateResult[]
/** Those of the above still failing. */
export function failedGates(gates: GateResult[]): GateResult[]

export interface ReportExcerpt { text: string; prose: boolean }
export function reportExcerpt(envelope: Envelope | undefined, limit?: number): ReportExcerpt | null
export function phaseReportExcerpt(envelopes: Envelope[], phaseId: string, limit?: number): ReportExcerpt | null
export function phaseFailureEvents(events: EventRow[], phaseId: string): EventRow[]

export interface ReproPrompt { title: string; text: string }
export interface ReproBundleInput {
  session: Session | null
  phase: Phase
  events: EventRow[]        // the whole session's; the builder filters
  envelopes: Envelope[]
  gates: GateResult[]
  prompts: readonly ReproPrompt[]
  model: string | null
}
export function buildReproBundle(input: ReproBundleInput): string
```

**Section layout**, in this order. The reader — human or model — gets the story, then the
identifying facts, then the evidence, and only then the two large blobs, which would otherwise push
everything else below the fold.

| # | Section | Form | Present when |
|---|---|---|---|
| 1 | `# SSSF repro bundle — {phase name}` | h1 | always |
| 2 | `## What happened` | one generated paragraph | always |
| 3 | `## Run` | fact list + `**Request**` fenced | always |
| 4 | `## Phase` | fact list | always |
| 5 | `## Phase error` | fenced `text` | `phase.error` |
| 6 | `## Gates` | fenced `text` — every gate's latest attempt, ✓/✗, failed checks with notes, violations | the phase has gates |
| 7 | `## Failure events` | fenced `text`, ISO timestamps | any error-class event |
| 8 | `## Event tail (last N of M)` | fenced `text`, last **40** | the phase has events |
| 9 | `## Phase report {i} — {output_type} · attempt {n} · valid\|invalid` | fenced `json` | one per envelope |
| 10 | `## Compiled system prompt` / `## Compiled user prompt` | fenced `text` | `usePrompts` returned them |
| 11 | provenance footer | `---` + one line | always |

**The generated paragraph** is composed, not templated onto one shape: a phase that failed with no
gates and no error events must still read as a sentence, and a green phase copied from its header
must not read as an incident report. It states the phase, its agent and model, the run and workflow,
the verb for its status, the duration and attempt, then — each only when it has something to say —
the first line of `phase.error`, the gate tally with names, the error-event count with types, a note
when the run is `fail` but this phase is not, and the engineer's flattened request.

**Truncation.** Every fenced section is capped at `SECTION_LIMIT` and marked in place with
`[truncated N chars]`. A single failing test can carry a megabyte of stdout in its gate note, and a
bundle that blows the clipboard — or the context window it was assembled for — helps nobody. The
marker exists so the reader knows material was **removed**, not never recorded.

**Fences size themselves.** Compiled prompts are markdown and routinely contain ``` blocks; the
fence is one backtick longer than the longest run inside its body, so a pasted section never splits
in half. Multi-line values (`request`, `description`) are either flattened or given their own block —
a list item containing a newline stops being a list item.

**No live clock.** `buildReproBundle` takes no `nowMs` and a running phase reports no duration. The
copied-tick in `<CopyPlate>` compares clipboard text to the string it was handed; a ticking duration
would clear the tick under the engineer's hand at 4 Hz.

#### 6.4.4 `COPY PHASE BUNDLE` in the phase header

`PhaseHeader` gains an optional `bundle?: string`, rendered as a `<CopyPlate>` between the tag
cluster and the close button, restamped by the same two-class rule (`.head .bundle`) for the same
reason, quiet in `--text-dim` — it is an escape hatch to a debugging session, not the panel's
headline. Stamped, it reads as one more member of the `OWNER` / `KIND` / `ATTEMPT` cluster it sits
beside rather than as a stray line of code in the head-plate. It copies the **same document** scoped
to the phase on screen, failed or not.

`PhaseDetail` builds it, because that is where the prompts, envelopes, gates and parsed
`agent_start` config already live; it gains an optional `session?: Session | null` (passed down by
`SessionTrace`) purely so the `## Run` facts are not blank. The model comes from
`agentConfig?.model` — the live `agent_start` payload — with no new plumbing.

### 6.5 Follow mode — the waterfall tracks a live run

The engineer starts a run and walks away from the keyboard. Coming back to a trace that has to be
dragged into position is the same clerical work §6.4 deletes for a broken run, so follow mode
deletes it for a live one: arm it once and the waterfall keeps the NOW line, the running block and
the newest event under the reader's eye until the run stops.

Owned by the trace builder (view B). One new file — `src/hooks/useFollowMode.ts` (§7.4) — plus
additive chrome in `SessionTrace` and one additive prop on `TraceLane`. `TriagePanel` is untouched;
the two plates coexist, triage above the spec plate, follow inside it.

#### 6.5.1 Why it is a geometry, not a scroll

The time scale is **fit-to-width** (§5.3.2), and that has a consequence worth stating plainly: for a
running session `t1` includes `nowMs`, so `x(now)` is **always 100**. NOW is welded to the right
edge and the whole run compresses as it gets longer. "Scroll to keep NOW at 70%" is therefore not
expressible against the resting geometry — there is nothing to the right of NOW to scroll into, and
nothing to scroll at all.

So arming follow arms a **second geometry**, and only while armed:

| | Resting | Following |
|---|---|---|
| Track width | `100% − rail − gutter` (fit) | `max(liveMs × 180px/min, fit)`, capped at `24000px` |
| Lead column | `0` | `32%` of the plate — empty track in front of NOW |
| Plate overflow | `hidden` | `overflow-x: auto` |
| NOW sits at | the right edge, always | **70%** of the visible track |

**Live density.** `180px` buys one minute of *real* time — `liveMs` is the sum of
`scale.segments` durations, so elided idle (§5.3.2) is not paid for twice. The axis stays linear
inside each segment; the cap only makes a very long run's minute thinner, it never bends the
mapping.

**The lead** is what makes 70% reachable. Without empty track in front of NOW the pin clamps to
`maxScroll` and NOW lands hard against the right edge — the 70% would quietly become a lie. The lead
is deliberately over-provisioned (a flat `32%` needs no measurement, and the pin target is clamped
anyway, so surplus costs nothing). It is a real grid column carrying `--tex-dots` per §1.5, sitting
after the queue gutter — which means at the pin the reader sees NOW at 70%, the queue in the 30%
beyond it, and idle matrix past that.

The waterfall's grid becomes four columns, driven entirely by custom properties so the resting case
is byte-for-byte the three-column grid §5.3.2 specifies:

```css
grid-template-columns:
  var(--rail-w)                                                         /* 260px / 200px */
  max(var(--track-min), calc(100% - var(--rail-w) - var(--gutter-w)))
  var(--gutter-w)                                                       /* 180px / 0 */
  var(--lead-w);                                                        /* 0 unless armed */
```

`--track-min` and `--lead-w` are `0` in CSS and set inline by `FollowMode.vars`. The lane rails
(`.axisRail`, `TraceLane .rail`) become `position: sticky; left: 0; z-index: var(--z-sticky)` with
an opaque `--surface-1` fill, so a lane keeps its name, model and context gauge while its track runs
underneath. Sticky costs nothing when there is nothing to scroll.

#### 6.5.2 The pin

Computed from measured geometry on every live tick (`useNow(250)` — no CSS animation, no
`scroll-behavior`), in a **layout** effect so the track's new width and the scroll position land in
the same frame:

```
railPx  = trackCell.left − plate.left + scrollLeft     // content-x where the track starts
visible = clientWidth − railPx                          // the rail is sticky over the lead edge
nowPx   = railPx + (clamp(nowPct, 0, 100) / 100) × trackCell.width
target  = clamp(round(nowPx − railPx − 0.70 × visible), 0, scrollWidth − clientWidth)
```

- Movement under **1px** is left alone — the pin is already there, and moving costs a scroll event.
- Corrections of **≥ 96px** (arming, resuming, a resize) glide with `behavior: 'smooth'`; the
  per-tick creep — under a pixel at 180px/min — jumps. A glide is not re-targeted while it settles
  unless its destination itself moved ≥ 96px, or four re-targets a second would restart the
  animation forever.
- **`prefers-reduced-motion: reduce` pins by jumping**, always. This is the one place a builder
  reads the query in JS: the global block in §2.3 forces `scroll-behavior: auto`, but that rule
  cannot reach `scrollTo({ behavior: 'smooth' })`. Read via `matchMedia`, kept live with a `change`
  listener.

#### 6.5.3 Suspension and resume

Suspension is judged from **where the container ended up**, not from a catalogue of input events, so
every route into the scrollbar counts the same: a drag of the bar, a touch flick, shift-wheel, a
focused block scrolled into view.

| | Rule |
|---|---|
| **Suspend** | a `scroll` lands more than **24px** from the position we last commanded. A horizontal `wheel` (`deltaX > deltaY`, or `shiftKey`) also suspends on the first notch, before its scroll lands. |
| **Resume** | the scrolling comes to **rest** (350ms of quiet) within **56px** of the current pin target. |
| **`F`** | resumes immediately when suspended; otherwise flips armed. |

Two numbers, and the gap between them is the whole behaviour: **resume (56) is wider than suspend
(24)** on purpose. A stray trackpad graze suspends and then heals itself; a real scroll back through
the run stays suspended, and stays suspended as the pin target keeps advancing away from it. The
350ms rest is what stops a drag that passes through the NOW region on its way back in time from
re-arming the pin mid-gesture — without it, the first frame of a drag suspends and the second one
resumes, forever.

While suspended the toggle **stays on** and a stamped amber hint reads
`PAUSED — SCROLL BACK OR PRESS F`. Following never fights the reader: no scroll is issued at all
until it resumes.

#### 6.5.4 Chrome

All of it lives in the spec plate's first row (`.followBar`, a single hairline below it), and the
whole row is absent unless `session.status === 'running'` — a switch with no wire is not offered.

- **The switch.** A real `<button>` in stamp type (`FOLLOW`) with a 13px `Crosshair`,
  `--surface-2`, machined edges, `--r-2`. Armed: `--amber` text on `--amber-wash` with an
  `--amber-edge` hairline. Flat — no glow, no shadow bloom. Carries `aria-pressed`.
- **The live readout**, pushed right: the newest event's type in `eventTypeVar()` colour as a stamp,
  then `eventLabel(e)` in `--font-mono --fs-micro --text-dim` (ellipsised), then
  `fmtOffset(now − started_at)` + ` ago` in `--text-faint .tnum`. Existing helpers only — no new
  formatting. Hidden under 860px.
- **The active block.** While armed, each running phase gets a flat 2px `--amber` rule milled
  directly under its block (`top: 62px`, the block's `12px + 48px` plus a 2px gap), transitioning
  `left`/`width` on the same `--dur-3 --ease-out-quart` the block does. It is *added to* the
  existing running hatch (§5.3.2), not a replacement, and it is the reason `TraceLane` gains one
  additive prop: `follow?: boolean`. **No glow.**
- The waterfall foot rail gains `· F FOLLOW` while running, beside the lane keys.

#### 6.5.5 Persistence and teardown

The preference is per run in `sessionStorage` under **`sssf.follow:{adw_id}`** (`'1'`, or the key
removed), read through the same try/catch shape as §6.4's collapse state — storage denied means
follow is simply off, never a thrown render. It **defaults to off**: arming changes the waterfall's
geometry, and a view that reshapes itself before being asked is a surprise, not a service.

Follow is `stored && running`, so the run ending **disarms it by itself** — the switch and its row
disappear, the active rules disappear, `--track-min` and `--lead-w` fall away, the track collapses
back to fit-to-width and the plate stops being a scroll container. The stored preference is left
alone; it only means anything while something is moving. Pending resume timers and any suspension
are cleared on the same edge, and the scroll listeners are removed by the callback ref's cleanup —
a callback ref, not an effect, because the waterfall only mounts once the first poll lands and an
effect keyed on a ref object would never see it appear.

---

## 7. Component contracts

### 7.1 File map & ownership

Five agents. **Views may import from `components/`, `hooks/`, `router/`, `theme/`, `lib/`, and their
own subdirectory. Views must never import from another view's directory.** If two views need the
same thing, it belongs in `components/` and the scaffold agent owns it.

```
src/
  main.tsx                              S   font + css imports, createRoot
  App.tsx                               S   route dispatch, snapshot state, palette host
  vite-env.d.ts                         S   /// <reference types="vite/client" />

  styles/
    tokens.css                          S   §2
    base.css                            S   §3

  theme/
    palette.ts                          S   §4

  router/
    index.ts                            S   parseHash, hrefFor, navigate, isDocsRoute
    useRoute.ts                         S   the hash-router hook

  hooks/
    useNow.ts                           S
    usePoll.ts                          S
    useFirstPaint.ts                    S
    useListKeyboardNav.ts               S
    useCopyToClipboard.ts               S
    useSessions.ts                      S   polls /api/sessions
    useSessionEvents.ts                 S   cursor-drain event tail for one adwId
    useSessionTrace.ts                  S   session + phases + agents + usage + events + envelopes + gates
    useElementWidth.ts                  S   ResizeObserver → px width
    useFollowMode.ts                    B   §6.5 — live geometry, scroll pin, suspension

  components/                           S   shared primitives — ALL owned by scaffold
    TopBar.tsx
    StatusChip.tsx
    StatChip.tsx
    Readout.tsx
    Tag.tsx
    Stamp.tsx
    PhaseDots.tsx
    DetailSection.tsx
    LiveIndicator.tsx
    ErrorBar.tsx
    EmptyState.tsx
    LoadingPlate.tsx
    Markdown.tsx
    JsonBlock.tsx
    ModelBadge.tsx
    CopyPlate.tsx
    *.module.css                        S   one per component

  views/
    sessions/                           A
      SessionsList.tsx
      SessionRow.tsx
      SessionTraceStrip.tsx
      *.module.css
    trace/                              B
      SessionTrace.tsx
      TimeAxis.tsx
      TraceLane.tsx
      PhaseBlock.tsx
      QueueGutter.tsx
      TriagePanel.tsx                   B   §6.4 — the failure plate
      reproBundle.ts                    B   §6.4.3 — shared with views/phase
      timeScale.ts
      lanes.ts
      *.module.css
    phase/                              C
      PhaseDetail.tsx
      PhaseHeader.tsx
      SectionNav.tsx
      AgentConfigSection.tsx
      PromptsSection.tsx
      GatesSection.tsx
      CostSection.tsx
      EvidenceSection.tsx
      OutputsSection.tsx
      EventsPanel.tsx
      EventRow.tsx
      *.module.css
    docs/                               D
      DocsView.tsx
      commands.ts                       D   the GROUPS data, verbatim
      CommandPalette.tsx                D
      fuzzy.ts                          D
      *.module.css

  lib/                                  UNTOUCHED (api, events, format, highlight, markdown,
                                        models, types) — lib/router.ts is DELETED
```

`S` = scaffold agent · `A` = sessions builder · `B` = trace builder · `C` = phase-detail builder ·
`D` = docs + palette builder.

**`PhaseDetail` lives in `views/phase/` but is rendered by `SessionTrace` (view B).** That is the
first sanctioned cross-view import; it is declared here so it is not an accident. Builder B imports
exactly one symbol — `PhaseDetail` — and passes the props in §7.7.

**`views/trace/reproBundle.ts` is the second, and the last.** It is a pure module shared by the
triage plate and the phase header, so the repro bundle exists once; it reads its derivations from
`views/phase/phaseData` and is imported by `views/phase/PhaseHeader`. Full rationale in §6.4.

### 7.2 `App.tsx` — scaffold

```tsx
/** Published by SessionTrace so the topbar and palette can see into the open run. */
export interface TraceSnapshot {
  adwId: string
  phases: Phase[]
  /** Display name of the selected phase, for the breadcrumb. Null when none selected. */
  phaseLabel: string | null
}

/** Health of the polling loops, surfaced by the live indicator. */
export type LiveState = 'live' | 'stale' | 'offline'
```

`App` owns:
- `route = useRoute()`
- `snapshot: TraceSnapshot | null` — set via a stable `onSnapshot` callback passed to `SessionTrace`;
  cleared whenever `route.adwId` changes.
- `lastOkAt: number | null` and `pollError: string | null` — set via `onPollHealth` callbacks passed
  to `SessionsList` and `SessionTrace`; derives `LiveState` with `useNow(1000)`.
- `paletteOpen: boolean` — toggled by the global `Cmd/Ctrl+K` listener (owned by `App`) and the
  topbar key-cap.

Renders: `<TopBar>`, then `<main>` dispatching on the route, then `<CommandPalette>`.

Route dispatch — **exactly** the Vue semantics:
```
route.adwId === 'docs'   → <DocsView />
!route.adwId             → <SessionsList onPollHealth={…} />
otherwise                → <SessionTrace key={route.adwId} adwId={route.adwId}
                                         phaseId={route.phaseId} onSnapshot={…}
                                         onPollHealth={…} />
```
The `key` is mandatory — it remounts the trace when the session changes, which is how all cursor and
event state resets.

### 7.3 `router/` — scaffold

```ts
// router/index.ts
export interface Route { adwId: string | null; phaseId: string | null }

/** Parse window.location.hash. Same parsing as the Vue version, character for character:
 *  strip a leading '#' and optional '/', split on '/', drop empties, decodeURIComponent each. */
export function parseHash(hash: string): Route

/** '#/', '#/<adw>', '#/<adw>/<phase>' — encodeURIComponent on each segment. Verbatim. */
export function hrefFor(adwId?: string | null, phaseId?: string | null): string

/** Sets window.location.hash. */
export function navigate(adwId?: string | null, phaseId?: string | null): void

export function isDocsRoute(route: Route): boolean   // route.adwId === 'docs'
```

```ts
// router/useRoute.ts
/** Subscribes to 'hashchange' via useSyncExternalStore. Returns a stable Route object
 *  (same reference when the hash has not changed) so effects keyed on it do not thrash. */
export function useRoute(): Route
```

`phaseCrumb` (the Vue module-level `ref`) does **not** survive. The breadcrumb label travels through
`TraceSnapshot.phaseLabel`.

### 7.4 Hooks — scaffold

```ts
// useNow.ts
/** Date.now() on an interval. `active: false` freezes the value and clears the timer. */
export function useNow(intervalMs: number, active?: boolean): number

// usePoll.ts
export interface PollState<T> {
  data: T | null
  error: string | null
  /** True once a poll has succeeded at least once. */
  loaded: boolean
  /** Date.now() of the last successful poll, or null. */
  lastOkAt: number | null
  /** Consecutive failures since the last success. */
  attempts: number
  /** Force an immediate poll (used by optimistic mutations). */
  refresh: () => void
}
/**
 * Interval poller with in-flight suppression (a slow request never queues a second),
 * mount/unmount safety, and error retention (the previous `data` survives an error —
 * the UI shows stale data plus the error bar, never a blank screen).
 */
export function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  opts?: { enabled?: boolean; deps?: readonly unknown[] },
): PollState<T>

// useFirstPaint.ts
/** True only for the first render pass after data first arrives — gates the stagger reveal. */
export function useFirstPaint(ready: boolean): boolean

// useListKeyboardNav.ts
export interface ListNavOptions {
  /** Stable ids, in visual order. Selection is preserved by id across updates. */
  ids: readonly string[]
  onActivate: (id: string) => void
  onEscape?: () => void
  /** Extra horizontal handlers — the trace view uses these for h/l across a lane. */
  onLeft?: (id: string) => void
  onRight?: (id: string) => void
  enabled?: boolean
}
export interface ListNav {
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  /** Spread onto the scroll container: tabIndex, onKeyDown, ref. */
  containerProps: {
    tabIndex: number
    onKeyDown: (e: ReactKeyboardEvent) => void
    ref: RefObject<HTMLDivElement | null>
  }
  /** Per-item: { 'data-selected': true | undefined, ref } */
  itemProps: (id: string) => { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
}
export function useListKeyboardNav(opts: ListNavOptions): ListNav

// useCopyToClipboard.ts
/** Returns [copiedText, copy]. copiedText resets to null after `resetMs` (default 1400). */
export function useCopyToClipboard(resetMs?: number): [string | null, (text: string) => void]

// useElementWidth.ts
/** ResizeObserver on the ref'd element. Returns px width (0 until measured). */
export function useElementWidth(ref: RefObject<Element | null>): number

// useSessions.ts
export function useSessions(intervalMs?: number): PollState<SessionSummary[]>   // default 500

// useSessionEvents.ts
export interface EventTail { events: EventRow[]; cursor: number }
/**
 * Cursor-drain event tail for one session. Drains `has_more` pages in a loop before
 * resolving (identical to the Vue `do…while`), appends to an accumulated array, and
 * stops polling once `running` goes false — with one final drain on that transition.
 */
export function useSessionEvents(
  adwId: string, running: boolean, intervalMs?: number, pageLimit?: number,
): { events: EventRow[]; error: string | null }

// useSessionTrace.ts
export interface TraceData {
  session: Session | null
  phases: Phase[]        // sorted by seq asc
  agents: AgentSession[]
  usage: SessionUsage    // { read, written }, defaulted to zeros
  events: EventRow[]     // accumulated, insertion order
  envelopes: Envelope[]
  gates: GateResult[]
}
/**
 * The trace view's whole data layer, 500ms. One tick: fetchSession → drain events →
 * refetch envelopes+gates ONLY on first load or when a fresh event's type is in
 * SIDE_TABLE_TYPES = {gate_pass, gate_fail, handoff, agent_end, phase_end, error}.
 * (That condition is a load-bearing performance decision — preserve it exactly.)
 */
export function useSessionTrace(adwId: string): TraceData & Omit<PollState<unknown>, 'data'>

// useFollowMode.ts                                                    §6.5
export interface FollowModeOptions {
  adwId: string                          // the per-run sessionStorage key
  running: boolean                       // follow is only offered while live
  nowPct: number                         // scale.x(nowMs), 0..100
  liveMs: number                         // real, non-elided ms — drives live density
  tick: number                           // re-pins whenever this changes (nowMs)
  trackRef: RefObject<HTMLElement | null> // the axis track cell
}
export interface FollowMode {
  armed: boolean                         // armed AND live; false the moment the run ends
  suspended: boolean                     // armed, but the reader took the scrollbar
  toggle: () => void                     // resume when suspended, otherwise flip
  scrollerRef: (el: HTMLDivElement | null) => (() => void) | undefined
  vars: CSSProperties                    // --track-min / --lead-w, empty when not following
}
/**
 * Pins the NOW line at 70% of the visible track while a run is live. Owns the
 * live-density geometry, the scroll pin, suspension/resume, and the per-run
 * preference. No CSS animation: the pin is a measured scroll position applied
 * on each live tick.
 */
export function useFollowMode(opts: FollowModeOptions): FollowMode
```

### 7.5 `TopBar` — scaffold

```tsx
export interface TopBarProps {
  route: Route
  /** Display name of the selected phase; falls back to route.phaseId when null. */
  phaseLabel: string | null
  live: LiveState
  /** Age in ms of the last successful poll; null before the first success. */
  lastOkAgeMs: number | null
  onOpenPalette: () => void
}
export function TopBar(props: TopBarProps): JSX.Element
```

### 7.6 Shared primitives — scaffold

```tsx
// StatusChip.tsx
export interface StatusChipProps {
  status: string                       // 'success' | 'fail' | 'running' | 'queued' | anything
  /** Glyph + colour only, no plate — for dense rows like the palette. */
  compact?: boolean
  className?: string
}
```
Machine-shop chip: `display: inline-flex; gap: var(--sp-3); padding: 2px var(--sp-4);
border: 1px solid; border-radius: var(--r-2); font: 500 var(--fs-micro)/1 var(--font-display);
text-transform: uppercase; letter-spacing: var(--tr-stamp);` — icon 14px, `stroke-width: 2.25`.
Icons: `success → Check`, `fail → X`, `running → LoaderCircle` (spinning, `1.1s linear infinite`),
`queued → Circle`, fallback `Circle`. Colours: `success` `--pass` on `--pass-wash`;
`fail` `--fail` on `--fail-wash`; `running` `--amber` on `--amber-wash`; `queued` `--text-dim` with
`border-style: dashed` and no fill. **No glow.**

```tsx
// StatChip.tsx
export type StatKind = 'cost' | 'tokens' | 'runtime' | 'read' | 'written'
export interface StatChipProps {
  kind: StatKind
  /** Raw: cost in dollars, tokens as a count, runtime in milliseconds. */
  value: number | null | undefined
  /** Bare value, no plate — for tight spots like phase blocks and event rows. */
  compact?: boolean
  className?: string
}
```
Icons: `cost → CircleDollarSign`, `tokens → Coins`, `runtime → Timer`, `read → BookOpen`,
`written → PenLine` at 16px (14px compact), `--text-ghost`. Value: `--font-mono --fs-micro`,
`.tnum`, `--text`. Formatting: `cost → fmtCost`, `runtime → fmtDuration(value ?? NaN)`,
everything else `fmtTokens`. **The five `TITLES` strings from `StatChip.vue` are copied verbatim
into a `STAT_TITLES` const and set as the element `title`.** That copy is the product's explanation
of billed-vs-distinct tokens; it must not be reworded.

```tsx
// Readout.tsx  — the instrument-cluster cell (spec plate, §5.3.1)
export interface ReadoutProps {
  label: string                        // stamped, uppercased by CSS
  title?: string                       // hover explanation
  mono?: boolean                       // value in --font-mono (default true)
  children: ReactNode                  // the value
}

// Tag.tsx  — key/value micro-plate (phase header, gates, outputs)
export interface TagProps {
  label: string                        // stamped key
  value: ReactNode
  tone?: 'default' | 'fail' | 'pass' | 'verdict'
  title?: string
}

// Stamp.tsx  — a silk-screen label
export interface StampProps {
  children: ReactNode
  as?: 'span' | 'div' | 'h2' | 'h3'
  tone?: 'faint' | 'dim' | 'amber' | 'pass' | 'fail'
  className?: string
}

// PhaseDots.tsx
export interface PhaseDotsProps { phases: Phase[] }
```
Sorted by `seq` asc. One 8×8 mark per phase, `--r-1`, `gap: var(--sp-2)`:
`success` filled `--pass` · `fail` filled `--fail` with a 1px inset notch · `running` filled
`--amber` with the `lamp` tick · `queued` 1px `--text-ghost` outline, no fill.
`title` = `` `${p.name} — ${p.status}` ``. Zero phases → an `—` in `--text-ghost`.
(Glyph-based dots are replaced by marks; the *status→colour→title* mapping is the parity contract.)

```tsx
// DetailSection.tsx
export interface DetailSectionProps {
  id: string                           // section id — also the scroll anchor for SectionNav
  title: string                        // rendered as a stamp
  icon?: LucideIcon
  /** Rendered after the title when non-null. */
  count?: number | null
  open: boolean
  onToggle: () => void
  children: ReactNode
}
```
Header is a full-width `<button>` (`aria-expanded`, `aria-controls`): a chevron
(`ChevronRight`, 14px, rotating 90° on open over `--dur-2 var(--ease-mech)`), the icon at 16px in
`--text-ghost`, the stamp, the count in `--font-mono --fs-micro --text-faint .tnum`, and a
`--tex-dots` filler stretching to the right edge. `border-bottom: 1px solid var(--edge-soft)`;
hover → `background: var(--surface-2)`. Body: `padding-top: var(--sp-5)`. Section element carries
`id={id}` for the nav rail's `scrollIntoView` and `IntersectionObserver`.

```tsx
// LiveIndicator.tsx
export interface LiveIndicatorProps { state: LiveState; ageMs: number | null }

// ErrorBar.tsx
export interface ErrorBarProps {
  message: string
  /** Consecutive failures; rendered as a tabular counter when > 1. */
  attempts?: number
  /** Age of the last success in ms; rendered as "last ok <dur>" when finite. */
  lastOkAgeMs?: number | null
  sticky?: boolean
}

// EmptyState.tsx
export interface EmptyStateProps {
  title: string                        // stamped
  body: ReactNode
  /** A command to copy — renders a CopyPlate. */
  command?: string
  action?: { label: string; href: string }
}

// LoadingPlate.tsx
export interface LoadingPlateProps {
  label: string                        // e.g. 'READING TRACE DB…'
  /** Number of skeleton rows; 0 renders just the label plate. */
  rows?: number
  height?: number                      // px, when rows === 0. Default 200.
}

// Markdown.tsx  — renderMarkdown() output. Safe: markdown.ts escapes ALL input first.
export interface MarkdownProps { source: string; className?: string }

// JsonBlock.tsx  — highlightJson() output in an engraved <pre>. Safe for the same reason.
export interface JsonBlockProps {
  /** Raw JSON string (or anything — non-JSON falls back to escaped raw). */
  raw: string | null | undefined
  /** Already-pretty text to highlight instead of `raw` (uses highlightJsonText). */
  text?: string
  maxHeight?: string                   // CSS length, e.g. '42vh'
  className?: string
}

// ModelBadge.tsx
export interface ModelBadgeProps {
  model: string | null | undefined
  size?: number                        // icon px, default 16
  className?: string
}
```
Renders `modelIcon(model)` as an `<img>` (omitted when null) plus `modelName(model)` in
`--font-mono --fs-micro --text-dim`; `title` = the full model id.

```tsx
// CopyPlate.tsx  — the engraved copy button used by docs and empty states
export interface CopyPlateProps {
  text: string                         // what lands on the clipboard
  label?: string                       // what is shown; defaults to `text`
  title?: string
  accent?: string                      // CSS colour for hover/active; defaults to var(--amber)
  className?: string
}
```

### 7.7 View contracts

```tsx
// views/sessions/SessionsList.tsx                                            builder A
export interface SessionsListProps {
  onPollHealth: (h: { lastOkAt: number | null; error: string | null; attempts: number }) => void
}

// views/sessions/SessionRow.tsx                                              builder A
export interface SessionRowProps {
  session: SessionSummary
  /** Live clock for the duration readout (1000ms cadence from the parent). */
  nowMs: number
  /** Reveal index for the stagger; already clamped by the parent is fine. */
  index: number
  /** True while first paint — enables .stagger-item. */
  reveal: boolean
  selected: boolean
  /** Emitted optimistically before the POST resolves. '' means the write failed → resync. */
  onArchived: (adwId: string) => void
  itemProps: { 'data-selected'?: true; ref: (el: HTMLElement | null) => void }
}

// views/sessions/SessionTraceStrip.tsx                                       builder A
export interface SessionTraceStripProps {
  session: SessionSummary
  events: EventRow[]
  nowMs: number
}
```

```tsx
// views/trace/SessionTrace.tsx                                               builder B
export interface SessionTraceProps {
  adwId: string
  phaseId: string | null
  onSnapshot: (s: TraceSnapshot) => void
  onPollHealth: (h: { lastOkAt: number | null; error: string | null; attempts: number }) => void
}

// views/trace/lanes.ts                                                       builder B
export interface LaneContext { used: number; window: number; pct: number }
export interface Lane {
  id: string                 // 'engineer' | 'code' | `agent:${owner}`
  label: string
  kind: PhaseKind
  color: string              // hex, from theme/palette
  model: string | null
  context: LaneContext | null
  metaLines: string[]
  phases: Phase[]            // timed phases for this lane
  queued: Phase[]            // phases with no started_at
}
export function buildLanes(
  session: Session | null, phases: Phase[], agents: AgentSession[], events: EventRow[],
): Lane[]

// views/trace/TimeAxis.tsx                                                   builder B
export interface TimeAxisProps {
  scale: TimeScale
  nowMs: number
  running: boolean
  t0: number
}

// views/trace/TraceLane.tsx                                                  builder B
export interface TraceLaneProps {
  lane: Lane
  scale: TimeScale
  nowMs: number
  trackPx: number                     // measured track width, for the label-overflow rule
  selectedPhaseId: string | null
  /** Verdict map: phase_id → envelope payload `passed`. Absent key = no verdict. */
  verdicts: Record<string, boolean>
  /** phase_id → tool-call marks, precomputed once by SessionTrace. */
  toolTicks: Record<string, { t: number; ok: boolean }[]>
  onSelect: (phaseId: string) => void
  laneSelected: boolean               // keyboard lane focus
}

// views/trace/PhaseBlock.tsx                                                 builder B
export interface PhaseBlockProps {
  phase: Phase
  laneColor: string
  scale: TimeScale
  nowMs: number
  trackPx: number
  selected: boolean
  verdictFail: boolean
  ticks: { t: number; ok: boolean }[]
  onSelect: (phaseId: string) => void
}

// views/trace/QueueGutter.tsx                                                builder B
export interface QueueGutterProps {
  lanes: Lane[]
  selectedPhaseId: string | null
  onSelect: (phaseId: string) => void
  /** Horizontal strip layout below the waterfall, used under 1280px. */
  inline?: boolean
}

// views/trace/TriagePanel.tsx                                                builder B  §6.4
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
// Renders null when the run has no failed phase and no still-failing gate.
// Fetches the failing agent's prompts through the shared `usePrompts` cache, so
// opening the phase detail afterwards costs no second request.

// views/trace/reproBundle.ts                                                 builder B  §6.4.3
export function buildReproBundle(input: ReproBundleInput): string   // pure, no clock
```

```tsx
// views/phase/PhaseDetail.tsx                                                builder C
export interface PhaseDetailProps {
  phase: Phase
  /** The run, for the repro bundle's `## Run` facts only (§6.4.4). */
  session?: Session | null
  /** All events for the session; the view filters by phase_id and sorts by rowid. */
  events: EventRow[]
  envelopes: Envelope[]
  gates: GateResult[]
  onClose: () => void
}

// views/phase/PhaseHeader.tsx
export interface PhaseHeaderProps {
  phase: Phase
  durationMs: number
  /** Markdown repro bundle for this phase (§6.4.4). Omitted → no copy action. */
  bundle?: string
  onClose: () => void
}

// views/phase/SectionNav.tsx
export interface SectionNavEntry { id: string; label: string; count?: number | null; present: boolean }
export interface SectionNavProps {
  entries: SectionNavEntry[]
  activeId: string | null
  onJump: (id: string) => void
}

// views/phase/AgentConfigSection.tsx
export interface AgentConfigSectionProps { config: AgentStartPayload }

// views/phase/PromptsSection.tsx
export interface PromptsSectionProps { adwId: string; agent: string }
// Owns its own fetch + Map cache keyed `${adwId}:${agent}`, and its own
// state: 'idle' | 'loading' | 'ready' | 'error'.

// views/phase/GatesSection.tsx
export interface GatesSectionProps { gates: GateResult[] }      // already filtered + sorted

// views/phase/CostSection.tsx
export interface UsageRow {
  label: string; tokens: number; cost: number
  kind?: 'total' | 'nested'
  title?: string
}
export interface CostSectionProps { rows: UsageRow[]; partial: boolean }

// views/phase/EvidenceSection.tsx
export interface EvidencePanelRow { dir: string; images: EvidenceFile[]; texts: EvidenceFile[] }
export interface EvidenceSectionProps { adwId: string; panels: EvidencePanelRow[] }

// views/phase/OutputsSection.tsx
export interface OutputsSectionProps { envelopes: Envelope[] }  // already filtered + sorted

// views/phase/EventsPanel.tsx
export interface EventsPanelProps { events: EventRow[] }        // already filtered + sorted

// views/phase/EventRow.tsx
export interface EventRowProps {
  event: EventRow
  expanded: boolean
  onToggle: (eventId: string) => void
  selected: boolean
}
```

```tsx
// views/docs/DocsView.tsx                                                    builder D
export function DocsView(): JSX.Element      // no props

// views/docs/commands.ts                                                     builder D
export interface Command { cmd: string; what: string; example?: string; note?: string }
export interface Group { title: string; blurb: string; accent: string; commands: Command[] }
export const GROUPS: Group[]                 // verbatim from DocsView.vue, accents remapped (§5.4)

// views/docs/CommandPalette.tsx                                              builder D
export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  /** The currently viewed run, when any — supplies the PHASES group and the ACTIONS group. */
  snapshot: TraceSnapshot | null
}

// views/docs/fuzzy.ts                                                        builder D
export interface FuzzyHit { score: number; /** [start, end) ranges in the haystack */ ranges: [number, number][] }
export function fuzzyMatch(query: string, haystack: string): FuzzyHit | null
```

### 7.8 Build configuration — scaffold

**`package.json`** — remove `vue`, `lucide-vue-next`, `@vitejs/plugin-vue`, `vue-tsc`,
`@fontsource/play`. Add:

```
dependencies:   react ^19  react-dom ^19  lucide-react ^0.5xx
                @fontsource/archivo ^5  @fontsource/ibm-plex-sans ^5  @fontsource/ibm-plex-mono ^5
devDependencies:@vitejs/plugin-react ^5  @types/react ^19  @types/react-dom ^19
                @types/bun  oxlint ^1  typescript ^5.7  vite ^7
```

Scripts — names unchanged, `vue-tsc` → `tsc`:
```json
"dev": "vite",
"server": "bun run server/index.ts",
"dev:all": "bun run server/index.ts & vite",
"build": "tsc --noEmit && vite build",
"preview": "bun run server/index.ts",
"typecheck": "tsc --noEmit",
"lint": "oxlint ."
```

**`vite.config.ts`** — swap `@vitejs/plugin-vue` for `@vitejs/plugin-react`. Everything else
(`@` and `@shared` aliases, port `4601`, the `/api` proxy to `PORT ?? 4600`, `outDir: dist`)
is unchanged.

**`tsconfig.json`** — `"jsx": "react-jsx"`, remove `"jsxImportSource": "vue"`, change `include` to
`["shared/**/*.ts", "server/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]`. Everything
else (strict, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, paths) unchanged.
`verbatimModuleSyntax` means **every type-only import must use `import type`** — a common port
failure; check it.

**`index.html`** — `<div id="root">`, `<script type="module" src="/src/main.tsx">`. Title, favicon,
meta unchanged.

**`.oxlintrc.json`** — add `"react"` to `plugins`. Everything else unchanged.

**Delete:** `src/App.vue`, `src/main.ts`, `src/style.css`, `src/lib/router.ts`,
`src/components/*.vue`.

---

## 8. Parity ledger

Non-negotiable. Every line is a checkbox. `→` names the React owner.

### 8.1 `App.vue` → `App.tsx` + `TopBar.tsx`

- [ ] Inline logo SVG (three offset bars), recoloured per §5.1, no fetch, `aria-hidden`
- [ ] Brand wordmark text `Super Simple Software Factory`
- [ ] Crumb `sessions` → `hrefFor()`, marked current when `!route.adwId`
- [ ] Crumb `<adwId>` → `hrefFor(adwId)` when `adwId && !isDocs`, current when `!route.phaseId`
- [ ] Crumb `<phase name ?? phaseId>` when `adwId && !isDocs && phaseId`, always current
- [ ] Crumb `docs` when `isDocs`
- [ ] `isDocs = route.adwId === 'docs'` — the reserved-word rule, comment preserved
- [ ] `docs` link in the right cluster, highlighted when the docs route is active
- [ ] Live indicator (upgraded from the pulsing dot → three-state, §5.1)
- [ ] Route dispatch with `key={route.adwId}` on `SessionTrace`

### 8.2 `SessionsList.vue` → `views/sessions/SessionsList.tsx`

- [ ] `fetchSessions()` every **500 ms**, in-flight suppression
- [ ] `nowMs` refreshed on each successful poll
- [ ] Error bar text: `api unreachable — retrying {message}`
- [ ] Run count head: `{n} runs`
- [ ] Sort by `ts(started_at)` **descending**
- [ ] `onArchived(adwId)`: non-empty → filter that row out optimistically; empty string → force a
      resync poll
- [ ] Loaded + zero → empty state (copy upgraded per §5.6, from `no sessions yet — run an ADW to
      see it here`)
- [ ] Not loaded + no error → loading state (from `loading sessions…`)

### 8.3 `SessionCard.vue` → `views/sessions/SessionRow.tsx` + `SessionTraceStrip.tsx`

- [ ] Row is an `<a href={hrefFor(adw_id)}>`
- [ ] Archive `<button>` inside it: `preventDefault()` + `stopPropagation()`, optimistic
      `onArchived(adw_id)`, `catch → onArchived('')`
- [ ] Archive button `title="Archive — remove this run from review"`, `aria-label="Archive run"`,
      hidden until row hover or button `:focus-visible`
- [ ] `adw_id` shown
- [ ] `adw_name ?? '—'` with `title` = the raw value
- [ ] `request` with `title` = the raw value
- [ ] Own event tail: one full drain on mount; **500 ms** poll **only while `status === 'running'`**;
      `has_more` drain loop with `limit = 1000`; stop the timer when not running
- [ ] Status-change watch: → running starts the timer; → not-running fires one final drain
- [ ] Range: `t0 = started_at`, else `min(finite event started_at)`, else `nowMs`;
      `t1 = running ? nowMs : ended_at`, else `max(finite event started_at)`, else `t0 + 1000`;
      `span = max(t1 - t0, 1000)`
- [ ] `axisTicks(span, 5)`; the `pct === 0` tick is left-aligned, the rest centre on their position
- [ ] Agent rows built from phases where `kind === 'agent' && owner`, in first-seen order
- [ ] Event dots: only events whose `phase_id` maps to a known owner **and** whose type has a
      non-null dot colour; `xPct` clamped to `[0, 100]`
- [ ] Dot `title` = `` `${type} ${eventLabel(e)} at ${fmtOffset(t - t0)}` ``
- [ ] The single latest dot is flagged only while running
- [ ] Lane colour = config colour from the embedded `agents[]`, else fallback by index
- [ ] Agent label `title` = `` `${owner} ${model}` `` when a model is known, else `owner`
- [ ] `MAX_VISIBLE_ROWS = 4` / `MIN_VISIBLE_ROWS = 3` / `+{N} more agents`
- [ ] No agent rows → `no agent activity yet`
- [ ] `StatusChip(status ?? 'fail')`
- [ ] `PhaseDots(phases ?? [])`
- [ ] `fmtDate(started_at)`
- [ ] `StatChip` cost / runtime / tokens
- [ ] `durationMs`: `running ? nowMs - start : (ended ?? nowMs) - start`; `NaN` when no start
- [ ] Status expressed on the row (running / fail / success), now via the status block (§5.2)

### 8.4 `SessionTrace.vue` → `views/trace/*`

- [ ] 500 ms tick: `fetchSession` → phases sorted by `seq` asc → `agents` → `usage` (defaulted to
      `{read: 0, written: 0}`)
- [ ] Event drain loop, `limit = 1000`, cursor = `max(cursor, page.cursor)`
- [ ] Envelopes + gates refetched **only** on first load or when a fresh event's type ∈
      `{gate_pass, gate_fail, handoff, agent_end, phase_end, error}` — preserve exactly
- [ ] Error bar `api unreachable — retrying {message}`
- [ ] Breadcrumb label = selected phase's `name` (now via `onSnapshot`)
- [ ] Run strip: request (+`title`), `StatusChip(status ?? 'fail')`, `started {fmtDate}`,
      `StatChip` cost / runtime / tokens / read / written — now as the instrument cluster (§5.3.1),
      with the five `StatChip` `TITLES` strings preserved
- [ ] Session duration: `running ? nowMs - start : (ended ?? nowMs) - start`
- [ ] Engineer lane: label `session.engineer ?? 'engineer'`, meta `engineer`, phases `kind ===
      'engineer'`, fixed amber
- [ ] Code lane: rendered **only when code phases exist**; label `code`, meta `workspace`, fixed steel
- [ ] One agent lane per distinct `owner` of `kind === 'agent'` phases, in phase order
- [ ] Lane model = `agents[].model ?? agent_start payload model`
- [ ] `ownerStart`: first `agent_start` per owner; owner resolved from the phase's `owner`, falling
      back to `e.name`
- [ ] Lane colour = `agents[].color ?? agent_start payload color ?? fallback[index]`
- [ ] Context gauge only when **both** `context_tokens` and `context_window` are truthy
- [ ] Context label: `< 1%` → one decimal; else rounded integer
- [ ] Context fill: `max(pct, 2%)` so a non-zero value is always visible
- [ ] Context `title` = `` `{used} / {window} tokens used · {remaining} remaining` `` with en-US
      thousands separators
- [ ] Kind icons `UserRound` / `SquareTerminal` / `Bot`
- [ ] Axis ticks from `axisTicks(span, 7)`
- [ ] Blocks positioned from `started_at`; end = `ended_at ?? (running ? now : start)`
- [ ] Block content: status glyph, `name`, `description`, compact runtime `StatChip`
- [ ] Status glyphs `✓ ✗ ● ○` with the queued fallback `○`
- [ ] Verdict map from envelopes: `payload_json.passed === false` on a `success` phase → verdict-fail
      (glyph `✗`, `--verdict`, plus the stamped `VERDICT` label — §5.3.2)
- [ ] Block `title` = `` `{name} — {status}{ (verdict: fail)}{ · {fmtDuration(duration)}}{\n{description}}` ``
- [ ] Tool-call ticks inside blocks at true intra-block position, clamped `[1, 99]%`, `ok === false`
      rendered as the error mark
- [ ] Queued phases (no `started_at`) rendered separately, `title` = `` `{name} — queued` ``
- [ ] Click a block/queued chip → `navigate(adwId, same ? null : phase_id)` (toggle)
- [ ] Loaded + zero phases → `no phases recorded for this session`
- [ ] Not loaded + no error → `loading trace…`
- [ ] `PhaseDetail` rendered when a phase is selected; close → `navigate(adwId)`
- [ ] Running phases read as live (was a whole-block pulse; now the amber edge + conveyor hatch)

### 8.5 `PhaseDetail.vue` → `views/phase/*`

**Filtering / sorting**
- [ ] Events: `phase_id` match, sorted by `rowid` asc
- [ ] Gates: `phase_id` match, sorted by `attempt` asc then `id` asc
- [ ] Outputs: `phase_id` match, sorted by `attempt` asc

**Header**
- [ ] `phase.name`, `StatusChip(status ?? 'queued')`, runtime `StatChip` when finite
- [ ] Tags `owner` (`—` when null), `kind` (`—` when null), `attempt` = `{attempt ?? 0}/{retries ?? 0}`
- [ ] Close control → `onClose()`
- [ ] `phase.error` → error bar

**Section behaviour**
- [ ] All sections start **closed**
- [ ] Open state resets **only when `phase.phase_id` changes** — never on a poll tick that replaces
      the phase object. Same for expanded gates, expanded events, open prompt panels, raw/rendered
      toggles.

**request** *(kind === 'engineer' only, `Inbox`)*
- [ ] Text = the first `log` event whose parsed payload has a non-empty string `input`
- [ ] Rendered `white-space: pre-wrap`, `overflow-wrap: anywhere`
- [ ] Section omitted entirely when no such event exists

**agent config** *(kind === 'agent' with an `agent_start` payload, `SlidersHorizontal`)*
- [ ] `coding agent` + `SquareTerminal` icon
- [ ] `model` + provider icon + `modelName()`, `title` = the full id
- [ ] `thinking` + `Brain` icon
- [ ] `tools`: rendered when the key is present; `null` → `all tools`; array → one chip per tool
- [ ] `harness`: rendered when the key is present; empty/absent array → `none`; else one chip each
- [ ] `purpose` as plain text
- [ ] `session` (`session_id`) + `Fingerprint` icon
- [ ] Rows appear only for fields the payload actually carries

**description** *(`AlignLeft`)* — [ ] `phase.description`, section omitted when null

**compiled prompts** *(kind === 'agent', `MessagesSquare`)*
- [ ] Fetched per `(adw_id, owner)`, cached in a `Map` for the view's lifetime
- [ ] Refetch **only** when the `(adw_id, owner, kind)` key actually changes — not per poll
- [ ] States: `loading prompts…` / `prompts unavailable` / ready
- [ ] Ready + zero panels → `no compiled prompts recorded`
- [ ] Panels: `system prompt`, `user prompt`; only for non-null values; in that order
- [ ] Per panel: collapsible header with a chevron, the title, and `{n} lines`
- [ ] Per panel body: `rendered` / `raw` toggle; rendered = `renderMarkdown()` output in `.md`;
      raw = the exact text in a `<pre>`
- [ ] Body scrolls at `max-height: 60vh`
- [ ] Section `count` = panel count, but only once state is `ready`
- [ ] Open panels and raw toggles clear when the prompt key changes
- [ ] 404 from the endpoint renders as "no prompts", not an error

**gates** *(`ShieldCheck`, count)*
- [ ] Zero → `no gate results`
- [ ] Per gate: pass/fail left edge, `✓`/`✗` mark, gate name, `attempt` tag,
      `fmtClock(created_at)` right-aligned
- [ ] `checks_json` parses to an array → the row is expandable and shows a `checks` tag whose value
      is `{n}` on a clean gate or `{failed} of {total} failed` on a mixed one; the failed variant
      takes the fail tone
- [ ] `checks_json` is `null` → a plain, non-expandable row (legacy)
- [ ] Expanded: one line per check with `✓`/`✗`, the `item` in mono, and the `note` — inline when
      single-line, in a `<pre>` block (`max-height: 30vh`) when it contains a newline
- [ ] Empty checks array → `nothing to check — the gate inspected no items`
- [ ] Violations from `violations_json` (array of strings, or the raw string when unparseable) —
      shown under an expanded failing gate, and under a legacy row whenever present
- [ ] Check parsing is defensive: non-object entries dropped, missing `item`/`note` → `''`,
      `ok` is `=== true`

**cost** *(kind === 'agent' with an `agent_end` event, `Receipt`)*
- [ ] No `agent_end` → section omitted
- [ ] With `usage`: rows `input`, `output`, [`thinking` nested], `cache read`, `cache write`, `total`
- [ ] `thinking` appears only when `reasoning_tokens` is truthy; cost share =
      `output_cost * reasoning_tokens / output_tokens` (0 when `output_tokens` is 0)
- [ ] `thinking` row `title` = `Thinking tokens — part of output above, billed at the output rate.
      Not added to the total.` (verbatim)
- [ ] `total` row gets a rule above and bold weight; `thinking` is indented and muted
- [ ] Without `usage`: a single `total` row from `event.tokens ?? 0` and `payload.cost ?? 0`, plus
      the note `this run predates the per-component breakdown — only the total was recorded`
- [ ] Malformed `payload_json` → an empty payload, never a crash
- [ ] Tokens formatted with `Intl.NumberFormat('en-US')`; costs with `money()`:
      `0 → '$0'`, `< 0.0001 → '<$0.0001'`, else 4 decimal places
- [ ] Column headers `tokens` / `cost`, right-aligned tabular values

**evidence** *(`Camera`, count)*
- [ ] Flow dirs = basenames of `evidence_dir` from this phase's `tool_call` events whose `name`
      starts with `flow:`
- [ ] `fetchEvidence(adw_id)` runs when the phase changes **and** the flow-dir count is non-zero;
      zero flows → no section, no request
- [ ] Only flows whose `dir` is in this phase's set are shown
- [ ] `.png` files render as thumbnails on a **white** image background, linked to the full size in
      a new tab, captioned `{name} {fmtSize(size)}`
- [ ] Files ending `.diff.png` get the failure edge treatment
- [ ] Non-png files render as link chips, `toolkit.txt` **first**, then alphabetical
- [ ] `fmtSize`: `< 1024 → '{n}B'`, else `'{n/1024, 1dp}KB'`
- [ ] Count = images + texts across all shown flows
- [ ] Fetch failure → no section (never an error banner)

**outputs** *(`Package`, count)*
- [ ] Zero → `no outputs`
- [ ] Per envelope: `output_type`, `agent` tag (`—` when null), `attempt` tag,
      `valid` / `invalid` with pass/fail colouring
- [ ] `payload_json` rendered via `highlightJson()` in an engraved `<pre>`, `max-height: 40vh`

**events panel**
- [ ] Header `events ({n})` with the `Activity` icon
- [ ] Zero → `no events`
- [ ] Per row: `fmtClock(started_at)`, the type (coloured by the type→colour map), `eventLabel(e)`
      with `title` = the same string
- [ ] Label in fail colour when `type === 'tool_call' && !payloadOk(payload_json)`
- [ ] Compact runtime `StatChip` when `eventDurationMs(e)` is finite:
      `ended - started`, falling back to a `tool_call` payload's `duration_ms`
- [ ] Compact tokens `StatChip` when `e.tokens` is truthy
- [ ] Rows expand/collapse individually; expanded state survives polls
- [ ] Expanded, rich `tool_call`: tool name, `failed` marker when `ok === false`, compact duration
      chip when `duration_ms != null`, an `args` block (`highlightJsonText` of pretty-printed args),
      and a `result` block from `result_snippet` when present
- [ ] Expanded, legacy `tool_call` with a payload: `no detail available — legacy event payload` plus
      the highlighted payload
- [ ] Expanded, any other event with a payload: a `payload` block, highlighted
- [ ] Expanded with no payload: `no payload`
- [ ] Type→colour map: `gate_fail`/`error` fail · `gate_pass`/`agent_end` pass · `tool_call` steel ·
      `handoff` slate · `agent_start` orchid (via `eventTypeVar`, §4)

### 8.6 `DocsView.vue` → `views/docs/DocsView.tsx` + `commands.ts`

- [ ] `GROUPS` copied **verbatim** — six groups, every `title`, `blurb`, `cmd`, `what`, `example`
      character for character (including the typographic apostrophes in `project’s`, `run’s`)
- [ ] The source-of-truth comment about mirroring the stamped justfile is carried over
- [ ] Accent per group remapped per §5.4
- [ ] Head: `BookOpen` icon, `Commands` title, the sub-paragraph verbatim with `justfile` and
      `SSSF_CONFIG=other.yaml` as inline code
- [ ] Copy target is `example ?? cmd`; button `title` = `` `copy: ${example ?? cmd}` ``
- [ ] Copy feedback: icon swaps `Copy` → `Check` for **1400 ms**, then back
- [ ] Clipboard failure is silent (the text stays selectable)
- [ ] Per command: the command plate, `what`, and the `example` chip when present
- [ ] Under 720px the command row stacks and the plate goes full width

### 8.7 Primitives

**`StatusChip.vue`** — [ ] icons `Check`/`X`/`LoaderCircle`/`Circle` with the `Circle` fallback ·
[ ] the status word is rendered as text · [ ] `running` spins · [ ] `queued` uses a dashed border ·
[ ] pass/fail/running/queued colours per §7.6.

**`StatChip.vue`** — [ ] five kinds with their icons · [ ] `cost → fmtCost`, `runtime →
fmtDuration`, others → `fmtTokens` · [ ] tabular numerals · [ ] `compact` drops the plate and dims
the value · [ ] **the five `TITLES` strings are copied verbatim** (cost, tokens, runtime, read,
written) — this is the product's explanation of billed-vs-distinct tokens and must not be reworded.

**`PhaseDots.vue`** — [ ] sorted by `seq` · [ ] one mark per phase, status-coloured ·
[ ] `title` = `` `{name} — {status}` `` · [ ] `running` animates · [ ] zero phases → `—`.

**`DetailSection.vue`** — [ ] chevron reflects open state · [ ] optional icon · [ ] optional count
rendered only when `!= null` · [ ] the whole header is the toggle · [ ] the body renders only when
open.

### 8.8 `lib/` reuse checklist

Every one of these must be **imported and used**, not reimplemented:

`fetchSessions` · `fetchSession` · `fetchEvents` · `archiveSession` · `fetchPrompts` ·
`fetchEvidence` · `evidenceFileUrl` · `fetchEnvelopes` · `fetchGates` · `fetchHealth` ·
`ts` · `fmtDuration` · `fmtClock` · `fmtDate` · `fmtTokens` · `fmtCost` · `fmtOffset` ·
`axisTicks` · `payloadOk` · `prettyJson` · `escapeHtml` · `highlightJson` · `highlightJsonText` ·
`renderMarkdown` · `modelIcon` · `modelName` · `parsePayload` · `parseToolCall` · `parseAgentStart` ·
`argsSummary` · `eventLabel` · `hexAlpha` · every type in `lib/types.ts`.

`agentColor` and `dotColor` are used **through** `theme/palette.ts`, never directly.

---

## 9. Definition of done

A view is done when all of the following hold.

1. `bun run typecheck` and `bun run lint` are clean. No `any`, no `@ts-expect-error`, no
   `oxlint-disable` beyond the one `no-await-in-loop` the cursor drain genuinely needs.
2. Its parity checklist in §8 is fully ticked, with the verbatim strings verbatim.
3. Deep links work cold: pasting `#/<adwId>/<phaseId>` into a fresh tab renders the trace with that
   phase selected and its detail open, and the breadcrumb shows the phase **name**.
4. Every colour, size, radius, duration and easing comes from a token. Grep the module CSS for
   `#`, `rgba(`, `px` outside the sanctioned list (§2 spacing note) — each hit must be justified.
5. No banned pattern from §0.3 appears.
6. Keyboard: the view is fully operable with `j`/`k`/arrows/`Enter`/`Esc`; every focusable element
   has a visible focus ring; `Cmd+K` works from inside the view.
7. `prefers-reduced-motion: reduce` — nothing animates except the NOW line's position.
8. Contrast: every text/background pair is ≥ 4.5:1 (≥ 3:1 for ≥ 22px display text).
   `--text-ghost` never carries prose.
9. No layout shift and no reset of user state (open sections, expanded events, keyboard selection,
   scroll position) across the 500 ms poll. This is the single most common way a port of this app
   goes wrong — test it by opening a section and watching it for ten seconds.
10. The staggered reveal fires once, on first data, and never again.

---

## 10. Summary of what changes, at a glance

| | Vue (before) | React (after) |
|---|---|---|
| Base | blue-black `#06080f` + violet/cyan aurora | warm charcoal `oklch(0.155 0.006 75)` + dot matrix |
| Accent | purple + cyan + blue + amber + violet | **amber phosphor only**, + muted pass/fail |
| Surfaces | gradient cards, 16px radius, glow shadows | flat plates, 2–4px chamfers, machined edge-lines |
| Type | Play everywhere | Archivo (display) / IBM Plex Sans (body) / IBM Plex Mono (data) |
| Sessions | uniform 460×420 card grid | full-bleed ledger, chunky status blocks, two-tier rows |
| Trace axis | faked — a 16% "request zone" and cumulative block shifting | **real time axis**, labelled idle-elision breaks, live NOW line |
| Blocks | glowing rounded rectangles that pulse | machined segments; running = amber edge + conveyor hatch |
| Phase detail | two columns of collapsibles | instrument panel with a sticky stamped section rail |
| Live | glowing green dot | three-state lamp with a ticking amber square and an age readout |
| Navigation | mouse only | `Cmd+K` palette, `j/k`/arrows, `Enter`/`Esc`, everywhere |
| Failures | found by clicking phases until one is red | triage plate leads the run; one button copies the whole repro bundle |
| Live runs | NOW welded to the right edge; drag the trace back into place by hand | `F` arms follow — a live-density track that pins NOW at 70% and yields to the reader's scroll |
| Motion | opacity pulses | staggered plate reveals, detented easing, mechanical ticks |
