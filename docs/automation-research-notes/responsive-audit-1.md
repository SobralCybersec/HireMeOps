# Responsive / Horizontal-Overflow Audit — Profiles / Variants / SettingsLogs

Read-only. Target: WebKitGTK (Tauri) window on Wayland, "right-crop" where content
exceeds the viewport and the ancestor `overflow:hidden` clips it.

Layout chain for the buggy page:
`.page-outlet(overflow:hidden,min-width:0)` → `.ws` → `.ws-stage` →
`.ws-panel(position:absolute; inset:0; overflow:hidden)` → `.page.page--fill(overflow:hidden)`
→ scroll `<div overflowY:auto>` → `ProfileDetail` → `.section-group` → `.form-row`.

Key fact: `.ws-panel` and `.page--fill` are `overflow:hidden`. Anything a flex row
pushes past the right edge is **clipped, not scrollable** — this is exactly the
symptom (button cut off, grid clipped right).

---

## FINDING 1 — Page header: non-wrapping flex + fixed 16rem dropdown clips the primary button  ⬅ THE VISIBLE "+ New Profile cut off" BUG

**File:** `src/pages/Profiles.tsx:112-149` (header container), `:127-139` (Dropdown), `:141-148` ("+ New Profile" button)
**Twin:** `src/pages/ProfileVariants.tsx:420-469` (same pattern; clips "+ Generate from CV" / Delete)

The header is a flex row with **no `flex-wrap`**:

```
Profiles.tsx:112-121
style={{ padding, borderBottom, background, display: "flex",
         alignItems: "center", gap: "var(--sp-3)", flexShrink: 0 }}
```

Inside it sits a Dropdown pinned to a fixed, **non-shrinking** width:

```
Profiles.tsx:133   <Dropdown ... style={{ minWidth: "16rem" }} ... />   // 256px, inline min-width wins over any min-width:0
```

`.toolbar-spacer` (`:140`, `flex:1`) can collapse to 0, but title + subtitle +
256px dropdown + button have a combined intrinsic width that, in the merged
Workspace (real content region = viewport − 220px sidebar), exceeds the pane.
With no `flex-wrap`, the trailing `+ New Profile` button (`:141`) overflows right
and is clipped by the `overflow:hidden` on `.page--fill`/`.ws-panel`.

**FIX (JSX, both files):**
1. Add `flexWrap: "wrap"` and `rowGap` to the header style so controls wrap to a
   second line instead of clipping:
   ```
   display: "flex", alignItems: "center", gap: "var(--sp-3)",
   flexWrap: "wrap", flexShrink: 0
   ```
2. Let the Dropdown shrink instead of holding 256px hard. Replace
   `style={{ minWidth: "16rem" }}` with a shrinkable basis, e.g.
   `style={{ flex: "1 1 12rem", minWidth: 0 }}` (Profiles.tsx:133, ProfileVariants.tsx:439).
   With wrap enabled, keeping a `minWidth:"16rem"` is also acceptable — the button
   will drop to row 2 rather than clip.

---

## FINDING 2 — 3-column `.form-row` collapses on VIEWPORT width, not container width (stays 3-wide & cramped inside the sidebar-offset Workspace)

**File:** `src/styles/theme.css:2583-2613` (`.form-row`, `.form-row--3`, `.form-row--4`, the `@media (max-width:720px)` collapse)
**Consumers:** `src/pages/Profiles.tsx:356,394,439,485,521` — every `<FormRow cols={3}>` (Salary/Currency/Period; Brazil/EU/Visa; Start/Relocation/English; Location/Years; Links). Component: `src/components/ui/Field.tsx:131-145`.

The grid itself is well-defended against true overflow:
- `theme.css:2586` tracks are `repeat(var(--form-row-cols,2), minmax(0, 1fr))` → tracks can shrink to 0.
- `.field` has `min-width:0` (`theme.css:1289`), `.field__input/select/textarea` are `width:100%; min-width:0` (`theme.css:1334-1335`), and `.app-main :is(input,select,textarea){max-width:100%}` (`theme.css:2752-2754`).

So the grid does **not** mathematically overflow. The real defect: the collapse
to one column is gated on **viewport** width:

```
theme.css:2603   @media (max-width: 720px) { .form-row, .form-row--3, .form-row--4 { grid-template-columns: 1fr } }
```

Inside the merged Workspace the usable pane is `viewport − 220px sidebar`
(`--sidebar-w`, theme.css:84; `.app-shell` grid `var(--sidebar-w) minmax(0,1fr)`,
theme.css:236). At e.g. a 1000px viewport the pane is ~780px but the 720px query
has NOT fired, so three columns are jammed into ~780px — selects render with their
`- select -` / long option labels clipped internally, reading as the reported
"3-column grid clipped on the right." The breakpoint is measuring the wrong box.

**FIX (theme.css:2583-2586) — make wrapping container-driven, drop the media query dependency:**
```css
.form-row {
  display: grid;
  gap: var(--sp-3) var(--sp-4);
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  align-items: start;
}
```
`auto-fit` + `minmax(min(100%, 200px), 1fr)` wraps based on the actual pane width
(no JS, no viewport guess): 3-up when it fits, 2-up / 1-up as the pane narrows,
and `min(100%, …)` guarantees a single column never forces overflow on very
narrow panes. This supersedes `.form-row--3/--4` fixed counts and the 720px
media block for these forms (they can stay as harmless fallbacks). If exact
column counts must be preserved elsewhere, instead lower the breakpoint's basis
by switching the `@media` to a container query (`@container`) on `.section-group`.

---

## FINDING 3 — Scroll wrapper lacks `min-width:0` / `max-width:100%` guard (defense-in-depth)

**File:** `src/pages/Profiles.tsx:166` — `<div style={{ flex:1, minHeight:0, overflowY:"auto" }}>`

This is the only bounded scroll box for the detail form, but it sets `overflowY`
only. It relies entirely on descendants behaving. Given the page is already known
to right-crop, add `minWidth:0` (it is a flex child of the `.page--fill` column)
and optionally `overflowX:"hidden"` so a stray wide child scrolls/clips locally
instead of dragging the pane wide. Low priority — the `.app-main` global
`min-width:0`/`max-width:100%` rules (theme.css:2749-2754) largely cover this, but
this wrapper is not one of the classes they target (`.field/.card/.stat-tile/.panel/.three-panel__panel`).

---

## CLEARED (checked, NOT overflow sources)

- `src/pages/SettingsLogs.tsx:728,794` — grids already use
  `repeat(auto-fill, minmax(200px/160px, 1fr))`. Correctly responsive; no fixed N,
  no fixed px width, no tables, no `white-space:nowrap`. Nothing to fix.
- `src/pages/Workspace.tsx` / `Workspace.css` — `.ws-panel` is `overflow:hidden` +
  flex-column with `.ws-panel > * { min-height:0 }` (Workspace.css:57-67). Sound.
  It does NOT add horizontal overflow; it is the CLIP surface that makes Finding 1
  visible, not the cause.
- `.field__input/select/textarea` widths (theme.css:1334-1335) and
  `.field { min-width:0 }` (theme.css:1289) — correct, classic-flexbox-overflow
  guard already in place.
- ProfileVariants inline create form (`ProfileVariants.tsx:472-560`) already sets
  `flexWrap:"wrap"` (`:482`) with `flex:"1 1 …"` bases — good, no change.
- Variant editor tab bar (`ProfileVariants.tsx:587-616`) uses `overflowX:"auto"` +
  `whiteSpace:"nowrap"` on tabs — intentional horizontal scroll, correct.

---

## Priority order
1. **Finding 1** (header wrap + shrinkable dropdown) — fixes the visible clipped
   "+ New Profile" button. 2 JSX edits (Profiles.tsx:112/133, ProfileVariants.tsx:420/439).
2. **Finding 2** (form-row → `auto-fit minmax(min(100%,200px),1fr)`) — fixes the
   cramped/clipped 3-col grids independent of the sidebar offset. 1 CSS edit (theme.css:2583-2586).
3. **Finding 3** (scroll wrapper min-width:0) — hardening. 1 JSX edit (Profiles.tsx:166).
