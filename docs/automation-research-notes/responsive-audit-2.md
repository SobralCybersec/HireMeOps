# Responsive / horizontal-overflow audit #2

Read-only. Target: Tauri + WebKitGTK (Wayland) desktop app, narrow/half-screen windows clip the
right edge. Files audited: JobSearch.tsx, CommandCenter.tsx/.css, CvLibrary.tsx, CvAnalysis.tsx,
ApplicationsQueue.tsx, styles/theme.css.

Note up front: `src/styles/theme.css` is already heavily hardened — `.app-body` uses
`minmax(0, 1fr)` (theme.css:236), there is a global `.page > * { min-width: 0 }` escape valve
(2763), a `.table-wrapper { overflow-x: auto }` (1143/2766), and a full responsive block
(2634-2743) that collapses two-pane/three-pane/dash/cockpit grids at 1180/900/640px. So the
remaining problems are a handful of specific gaps, not a systemic failure.

---

## HIGH — real clipping bugs

### 1. `.three-panel__panel` typo defeats the three-pane min-width:0 escape valve
- **File:line:** src/styles/theme.css:2749
- **Culprit:** the global escape valve reads
  `.app-main :is(.field, .card, .stat-tile, .panel, .three-panel__panel) { min-width: 0; }`
  — `.three-panel__panel` does not exist. The real class is `.three-pane__panel`
  (defined 1785, used in JobSearch.tsx:1215/1375/1456). So the three-pane panels never
  receive `min-width: 0`.
- **Why it clips:** `.three-pane` (1770) is `grid-template-columns: 220px 1fr 290px` with
  `overflow: hidden` (1774). The middle `1fr` grid item keeps its default `min-width: auto`,
  so a long unbroken job title / URL / company string in the Jobs column expands the track,
  pushes the grid past its box, and `overflow: hidden` clips the right edge instead of
  ellipsing. Exactly the reported bug class.
- **Fix:** correct the typo to `.three-pane__panel`, or (clearer) add it directly:
  `.three-pane__panel { min-width: 0; overflow-y: auto; ... }` at 1785. One-word fix, big payoff.

### 2. `.cv-grid` has a hard 260px column floor and no narrow fallback
- **File:line:** src/styles/theme.css:1884-1888 (used by CvLibrary.tsx via `className="cv-grid"`)
- **Culprit:** `grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));`
  `minmax(260px, …)` refuses to shrink below 260px. On a window whose content lane is narrower
  than ~260px + padding (sidebar-collapsed half-screen / Wayland dock), a single column is
  wider than the lane → horizontal overflow. Unlike `.analysis-grid`/`.two-pane`/`.three-pane`,
  `.cv-grid` has **no** entry in the 900/640px responsive block, so nothing rescues it.
- **Fix:** `grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));`
  The `min(100%, 260px)` lets the tile collapse to the container width when the lane is
  narrower than 260px. (Same one-line pattern applies as defense-in-depth to `.stat-grid`
  minmax(130px) at 1041 and `.form-grid` minmax(200px) at 1674 — lower severity because the
  floors are smaller and form-grid already hard-collapses at 640px.)

---

## MEDIUM — can overflow with long content, guard is missing

### 3. JobSearch detail metadata grid: inline `1fr 1fr` without min-width:0
- **File:line:** src/pages/JobSearch.tsx:1494-1500
- **Culprit:** inline `style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}`. This grid
  lives inside the Detail panel (the fixed `290px` third column of `.three-pane`). Each `1fr`
  track defaults to `min-width: auto`; a long unbroken Location value or platform slug in a
  `DetailField` can force the track wider than ~145px and blow out the already-narrow 290px
  pane. Compounded by bug #1 (the pane can't shrink) and `.three-pane` `overflow: hidden`.
- **Fix:** `gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)"` (or add `min-width: 0` to the
  `DetailField` wrapper). Cheap insurance even after #1 is fixed.

---

## LOW — noted, unlikely to bite in practice

### 4. `.cc-field { min-width: 12rem }` in flex rows
- **File:line:** src/pages/CommandCenter.css:726-732; used CommandCenter.tsx:311/417/428
- **Culprit:** `.cc-field { flex: 1; min-width: 12rem; }` (192px hard floor). Two fields in a
  non-wrapping flex row on a narrow window would overflow. Mitigated in practice: the main
  consumer `.cc-foot` sets `flex-wrap: wrap` (CommandCenter.css:787), so fields drop to the next
  row instead of overflowing. Only a risk if `.cc-field` is ever placed in a `nowrap` flex row.
- **Fix (if it ever surfaces):** drop the floor to `min-width: 0` or `min(100%, 12rem)`.

### 5. CommandCenter grids — checked, OK
- `.cc-body` (72) `1fr 1fr` → 1fr at ≤900px (75). `.cc-midgrid`/`.cc-botgrid` (343) `1fr 1fr`
  → 1fr at ≤720px (349). `.cc-platforms` (285) `repeat(5, 1fr)` → `repeat(2,1fr)` at ≤720px (290).
  All 1fr children, all with media fallbacks. No fixed-px column that can't shrink. No action.
- `.cc-jobrow__main` (556) correctly pairs `min-width: 0` + `flex: 1` with the ellipsis children
  (565/571). Good — this is the pattern the rest of the app should copy.

### 6. ApplicationsQueue — checked, OK
- No `<table>`, no fixed-px grid. Layout is flex with `flexWrap: "wrap"` and token gaps
  (ApplicationsQueue.tsx:307/403); the one fixed measure is `minWidth: "16rem"` on a
  `flex: 1` block (359) inside a wrapping row. No overflow path found.

### 7. JobSearch filter/query rows — checked, OK
- The nowrap+ellipsis run at JobSearch.tsx:1345-1356 sets `overflow: hidden` on the flex item
  itself, which computes `min-width: 0`, so it ellipses correctly rather than overflowing.

---

## Fix priority
1. theme.css:2749 — fix `.three-panel__panel` → `.three-pane__panel` (or add min-width:0 at 1785). **Highest ROI.**
2. theme.css:1884 — `.cv-grid` → `minmax(min(100%, 260px), 1fr)`.
3. JobSearch.tsx:1497 — `minmax(0, 1fr) minmax(0, 1fr)`.
4. (optional) apply `min(100%, X)` to `.stat-grid` (1041) & `.form-grid` (1674); relax `.cc-field` floor (CommandCenter.css:730).
