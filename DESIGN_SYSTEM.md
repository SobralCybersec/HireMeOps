# HireMeOps — Design System (Wave 0 Foundation)

The visual language every page inherits. **Aesthetic:** dense command-center /
instrument panel — tight spacing, monospace for data, low motion, dark-first
with a real light theme. When in doubt, choose the calmer, denser option.

- **Tokens & classes:** `src/styles/theme.css`
- **Primitives:** `src/components/ui/` (import from `../components/ui`)
- **Shell:** `src/components/AppLayout.tsx`, `TopCommandBar.tsx`
- **Routing metadata:** `src/app/routes.ts`

---

## 1. Golden rules

1. **Never hard-code color, spacing, type, or radius.** Use the CSS custom
   properties. A raw hex or px in a page component is a bug.
2. **Reach for a primitive before a `<div className="...">`.** If a primitive
   exists (`Button`, `Badge`, `Card`, `KpiCard`, `DataTable`, …), use it.
3. **Both themes must work.** Everything is driven by `--color-*` / `--status-*`
   tokens that flip under `[data-theme="light"]`. Don't special-case a theme.
4. **Respect reduced effects.** CSS transitions are auto-neutralised; for
   JS-driven motion gate on `useReducedEffects()`.
5. **Status = one vocabulary.** Map any domain status through
   `src/components/ui/status.ts`, never re-invent color logic per page.

---

## 2. Tokens (`theme.css`)

| Group | Tokens |
| --- | --- |
| Spacing (4px base) | `--sp-1`…`--sp-12` |
| Type scale | `--text-2xs` (10) … `--text-3xl` (28); base 13px |
| Fonts | `--font-ui` (Inter), `--font-mono` (JetBrains Mono) |
| Weights | `--fw-regular/medium/semibold/bold` |
| Radius | `--radius-sm` (2) `--radius` (4) `--radius-md` (6) `--radius-lg` (8) |
| Z-index | `--z-base/sticky/overlay/drawer/modal/toast` |
| Layout | `--sidebar-w` `--topbar-h` `--statusbar-h` `--eventlog-w` |
| Motion | `--ease-standard` `--ease-emphasized`; `--tx-fast/base/slow` |
| Elevation | `--shadow-1/2/3` (theme-aware) |
| Surfaces | `--color-bg` `--color-surface{,-2,-3,-hover}` |
| Borders | `--color-border` `--color-border-strong` |
| Text | `--color-text` `--color-text-2` `--color-text-muted` `--color-text-inverse` |
| Accent | `--color-accent{,-dim,-text,-hover}` |
| Danger | `--color-danger{,-dim,-hover}` |
| Status ×8 | `--status-{queued,running,success,failed,review,stopped,paused,neutral}-{bg,text}` |

**Status variants** (the 8 above) are the shared status palette. Each has a
matching `.badge--x`, `.dot--x`, and `--status-x-{bg,text}` token.

---

## 3. Class vocabulary (already in `theme.css`)

Layout: `.app-shell .sidebar .topbar .app-body .page-outlet .status-strip`
`.event-log-*` · Pages: `.page` `.page--fill` `.page-header` `.page-title`
`.toolbar{,--border}` `.toolbar-sep` `.toolbar-spacer` · Structure:
`.card` `.two-pane` `.three-pane` `.panel-header` `.settings-layout`
`.stat-grid` `.form-grid` `.dash-grid` `.cockpit-grid` `.analysis-grid` ·
Atoms: `.btn(--primary/ghost/danger, --sm/lg)` `.badge--*` `.stat-tile`
`.list-item` `.data-table` `.field(__input/select/textarea)` `.filter-tab`
`.tag` `.check-label` `.score-bar` `.empty-state` `.danger-zone` `.code` ·
Command bar (new): `.topbar-chip` `.topbar-toggle` `.status-inline`
`.inline-warning` `.chart-card__canvas` `.overlay-surface`.

You rarely write these by hand — the primitives emit them.

---

## 4. Primitives (`src/components/ui`)

| Import | Purpose |
| --- | --- |
| `Button` | `variant` primary/ghost/danger, `size` sm/md/lg, `icon` |
| `Badge` | status pill; `variant: StatusVariant` |
| `StatusDot` | colored dot; `variant`, `size` |
| `KpiCard` | metric tile for `.stat-grid`; `label/value/meta/tone` |
| `Card` | titled panel; `title/actions/compact` |
| `Toolbar` `ToolbarSpacer` `ToolbarSep` | action rows |
| `EmptyState` | centered placeholder; `label/title/body/action` |
| `ScoreBar` | labelled progress; `label/value/max/variant` |
| `ChartCard` | titled fixed-min-height canvas (bring your own renderer) |
| `DataTable<T>` | dense grid; `columns/rows/getRowKey/onRowClick/empty` |
| `MatchScoreBadge` | color-graded score pill; `score: number \| null` |
| `AutomationStatusBadge` | dot + label for `AutomationState` |
| `BrowserSessionBadge` | command-bar session chip; `status/label/detail` |
| `DuplicateUrlWarning` | inline "already processed" notice |

Status helpers: `automationVariant`, `jobStatusVariant`,
`applicationStatusVariant`, `matchScoreVariant`, `humanizeStatus`.

### Example

```tsx
import { Card, KpiCard, Button, Toolbar, ToolbarSpacer, MatchScoreBadge } from "../components/ui";

<div className="page">
  <div className="stat-grid">
    <KpiCard label="Submitted" value={12} meta="this session" />
    <KpiCard label="Failed" value={1} tone="danger" />
  </div>

  <Card title="Automation Control" actions={<MatchScoreBadge score={87} />}>
    <Toolbar>
      <Button variant="primary" onClick={start}>▶ Start</Button>
      <ToolbarSpacer />
      <Button variant="danger">■ Stop</Button>
    </Toolbar>
  </Card>
</div>
```

---

## 5. App shell

- **Sidebar** (spec §3.2): grouped nav from `NAV_GROUPS` in `src/app/routes.ts`.
  Add a page by adding one `NavItem` there + one route in `app/router.tsx`.
- **Top command bar** (spec §3.3): `<TopCommandBar>` — route title · profile ·
  variant · browser session · LinkedIn session · automation status · event
  count · theme toggle · reduced-effects toggle · **Emergency Stop**.
  - Variant / browser / LinkedIn chips are presentational seams: wire them to
    their stores when those land; they need no layout change.
- **Emergency Stop:** click or **Ctrl/Cmd+Shift+S** from any focus. Always wins
  over in-flight automation transitions. Never gate it behind a modal.
- **Status strip:** bottom bar, live `aria-live="polite"` state readout.

---

## 6. Reduced effects & motion

Two cooperating layers:

1. **CSS** — `useThemeStore` toggles `.reduced-effects` on `<html>`, which
   neutralises all transitions/animations. Mode `on`/`off` wins; `auto` follows
   OS `prefers-reduced-motion`.
2. **JS** — `useReducedEffects()` (`src/lib/effects.ts`) for logic branches:

```tsx
const reduce = useReducedEffects();
style={{ transition: motionSafe(reduce, "opacity 200ms var(--ease-standard)", "none") }}
```

Motion is a garnish, not a feature. Prefer opacity/transform; keep it ≤ ~200ms
with `--ease-standard`.

---

## 7. Accessibility (non-negotiable)

- Every interactive element is keyboard reachable with a visible
  `:focus-visible` ring (global rule already applied).
- Color never carries meaning alone — pair status color with a label/dot.
- Icons/glyphs used as buttons need an `aria-label`; decorative dots are
  `aria-hidden`.
- Live regions: event log + status strip use `aria-live="polite"`.
- Hit targets ≥ the provided control heights (24/28/34px); don't shrink below.

---

## 8. Adding a new page — checklist

1. Add `NavItem` to `NAV_GROUPS` and a title to `ROUTE_TITLES` (`app/routes.ts`).
2. Register the route in `app/router.tsx`.
3. Root the page in `<div className="page">` (or `page page--fill` for
   inner-scroll layouts).
4. Compose from `components/ui` primitives; only reach for raw classes when a
   primitive genuinely doesn't exist — then consider adding one here.
5. Route all status coloring through `status.ts`.
6. Verify: light + dark, reduced-effects on, keyboard-only, empty state.
