---
name: HireMeOps
description: Local-first job-search operations cockpit.
colors:
  primary: "oklch(0.6 0.17 258)"
  primary-hover: "oklch(0.68 0.17 255)"
  background: "oklch(0.14 0.028 258)"
  surface: "oklch(0.17 0.03 258)"
  surface-2: "oklch(0.2 0.032 258)"
  surface-3: "oklch(0.18 0.03 258)"
  surface-hover: "oklch(0.24 0.035 258)"
  surface-sunken: "oklch(0.16 0.028 258)"
  border: "oklch(0.36 0.04 258)"
  border-strong: "oklch(0.44 0.05 258)"
  text: "oklch(0.95 0.01 250)"
  text-muted: "oklch(0.68 0.03 250)"
  danger: "oklch(0.63 0.2 24)"
  success: "oklch(0.64 0.1 150)"
  warning: "oklch(0.76 0.12 70)"
  light-background: "#edf2f9"
  light-surface: "#f4f7fc"
  light-accent: "#0068ac"
  light-text: "#0c1a2e"
  light-border: "#c0cfe6"
typography:
  display:
    fontFamily: "Orbitron, Rajdhani, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  headline:
    fontFamily: "Roboto Condensed, Rajdhani, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  title:
    fontFamily: "Roboto Condensed, Rajdhani, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Rajdhani, Inter, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.04em"
  data:
    fontFamily: "JetBrains Mono, IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  none: "0px"
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
  4xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "28px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "4px 12px"
    height: "30px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "16px"
  nav-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
---

# Design System: HireMeOps

## Overview

**Creative North Star: "Console de Operações"**

HireMeOps reads as an instrument for running a live job-search operation: dark, focused, information-dense, and calm under load. The supplied visual reference reinforces a desktop workspace with a persistent left rail, quiet grouped cards, restrained borders, and utility surfaces that support the main task without competing with it.

The system uses a deep blue-black field, cyan telemetry accent, condensed uppercase headings, and monospaced values. HUD details are sparse and functional: a short accent line, a corner bracket, a status dot, or a focused glow should explain state or hierarchy. Light mode carries the same structure into cool slate-blue surfaces rather than becoming a separate visual language.

**Key Characteristics:**
- Dense command-center layout with clear operational grouping.
- Dark instrument field with cyan state signaling.
- Condensed display hierarchy paired with readable Inter body copy.
- Monospaced metrics, IDs, timestamps, and system status.
- Hairline borders, restrained radii, and functional depth.

## Colors

Palette character: blue-night instrument surfaces carry most of the screen; cyan marks active control and live state; semantic colors remain independent so danger, success, and review are never confused with the primary accent.

### Primary
- **Telemetry Cyan** (`oklch(0.6 0.17 258)`): Primary actions, active navigation, focused controls, live automation state, and small HUD markers.
- **Telemetry Cyan Hover** (`oklch(0.68 0.17 255)`): Hover and emphasized interactive states.

### Secondary
- **Warning Gold** (`oklch(0.76 0.12 70)`): Review-required and attention states.

### Tertiary
- **Operational Green** (`oklch(0.64 0.1 150)`): Successful completion and healthy system states.
- **Vermilion Danger** (`oklch(0.63 0.2 24)`): Stop, failure, destructive action, and blocked automation states.

### Neutral
- **Instrument Field** (`oklch(0.14 0.028 258)`): Default dark application background.
- **Panel Surface** (`oklch(0.17 0.03 258)`): Cards, rails, and primary containers.
- **Raised Surface** (`oklch(0.2 0.032 258)`): Headers, inputs, and controls.
- **Hover Surface** (`oklch(0.24 0.035 258)`): Hovered navigation and controls.
- **Structural Border** (`oklch(0.36 0.04 258)`): Hairline boundaries and separators.
- **Strong Border** (`oklch(0.44 0.05 258)`): Hover and focused boundary emphasis.
- **Primary Text** (`oklch(0.95 0.01 250)`): Headings, values, and high-priority copy.
- **Muted Text** (`oklch(0.68 0.03 250)`): Supporting labels, metadata, and inactive controls.

### Named Rules
**The Signal Lane Rule.** Use cyan for interaction and live state. Semantic colors own success, review, and danger states.

**The Quiet Field Rule.** Keep most surface area neutral; accent belongs to decisions, state, and orientation.

## Typography

**Display Font:** Orbitron (with Rajdhani and system sans fallbacks)
**Body Font:** Inter (with system sans fallbacks)
**Label/Mono Font:** Rajdhani for UI labels; JetBrains Mono for data and system output.

**Character:** Orbitron and Roboto Condensed give navigation and section titles a compact technical voice. Inter keeps prose and controls readable; JetBrains Mono makes metrics, IDs, and logs scan as reliable system output.

### Hierarchy
- **Display** (700, 16px, 1.2): Product mark and top-level shell identity.
- **Headline** (700, 16px, 1.2): Page titles and primary workspace headings; uppercase with 0.06em tracking.
- **Title** (600, 12px, 1.3): Card and section headers; uppercase with 0.1em tracking.
- **Body** (400, 13px, 1.5): Descriptions, helper text, and operational copy.
- **Label** (500, 12px, 1.3): Buttons, navigation labels, form labels, and compact metadata.
- **Data** (500, 12px, 1.5): Metrics, timestamps, IDs, logs, and tabular values.

### Named Rules
**The Two-Speed Type Rule.** Use condensed display type for orientation and Inter for comprehension; use mono only when alignment or system semantics matter.

## Layout

The primary topology is a desktop two-part workspace: a persistent left rail and a flexible page outlet. The rail is 220px when expanded and 64px when collapsed. Main content uses compact grids, toolbars, cards, tables, and side-by-side operational panels. A 4px base rhythm scales through 8, 12, 16, 24, 32, 40, and 48px.

Keep content grouped into visible zones rather than one undifferentiated canvas. Use the supplied reference's quiet left navigation and stacked workspace cards as the compositional baseline. Preserve horizontal scanning for tables and metrics; allow dense regions to scroll within their own container instead of forcing the whole shell to grow.

The interface supports dark and light themes. Light mode preserves the same rail, card, border, and hierarchy model with cool slate-blue surfaces. Responsive behavior should collapse secondary utility regions before shrinking primary controls below comfortable hit targets.

## Elevation & Depth

Depth is primarily tonal: background, sunken field, panel, raised surface, and hover surface do most of the work. Shadows are structural and reserved for overlays, active command-center zones, and interaction lift. Cyan glow is a signal, not ambient decoration.

### Shadow Vocabulary
- **Low structural** (`0 1px 2px rgba(0, 4, 12, 0.5)`): Subtle separation on dark surfaces.
- **Overlay** (`0 6px 18px rgba(0, 6, 18, 0.55)`): Menus, dialogs, and floating utility regions.
- **Lifted zone** (`0 16px 40px rgba(0, 8, 24, 0.62)`): Focused or elevated command-center regions.
- **HUD glow** (`0 0 0 1px rgba(56, 189, 248, 0.25), 0 0 12px -2px rgba(56, 189, 248, 0.35)`): Focused interactive signature only.

### Named Rules
**The Tonal Stack Rule.** Establish depth with surface steps before adding shadow.

**The Functional Glow Rule.** Glow must identify focus, activity, or a live state; never use it as a general background effect.

## Shapes

The form language is crisp and compact. Buttons use square corners; cards and controls use restrained 2–6px radii. Borders are one-pixel hairlines in the structural border token, with stronger borders reserved for hover, focus, and active state. Corner brackets and short top accent lines are signature geometry on selected HUD frames and panels, not universal decoration.

Inputs, selects, textareas, cards, tables, and badges share the same compact radius family. Avoid pill geometry except where a status badge needs a compact semantic capsule.

## Components

### Buttons
- **Character:** Compact command controls with explicit state contrast.
- **Shape:** Square corners (0px), 28px default height, 24px small, 34px large.
- **Primary:** Telemetry Cyan fill, inverse text, 12px horizontal padding.
- **Ghost:** Transparent fill, structural border, muted text; hover raises the surface one tonal step.
- **Danger:** Danger-dim fill with danger border/text; hover becomes solid danger with inverse text.
- **Hover / Focus:** 120ms standard transition; 2px cyan outline with 2px offset on focus-visible; 0.97 scale on active.

### Chips
- **Style:** Compact mono label, 2px radius, 2px 7px padding.
- **State:** Background and text follow semantic status pairs: queued, running, success, failed, review, stopped, paused, and neutral.

### Cards / Containers
- **Character:** Quiet operational panels with a small amount of HUD framing.
- **Corner Style:** 4px radius.
- **Background:** Panel Surface; header uses Raised Surface.
- **Shadow Strategy:** Flat at rest; shadow only when the card is an active zone, overlay, or lifted interaction.
- **Border:** One-pixel Structural Border; selected panels may add a faint cyan top rule and corner marker.
- **Internal Padding:** 16px body; 8px 16px header; compact bodies remove padding for tables and lists.

### Inputs / Fields
- **Style:** Raised Surface, one-pixel border, 4px radius, 30px control height, compact label-to-control gap.
- **Focus:** Cyan border, cool cyan 3px ring, and a small label shift toward the accent.
- **Error / Disabled:** Danger border and danger ring for invalid state; disabled controls use 40% opacity and a stable surface.

### Navigation
- **Style:** Persistent left rail with compact grouped links, uppercase micro-labels, and a collapsible 220px/64px width.
- **Default:** Muted text on the instrument field.
- **Hover:** Surface-hover background and primary text.
- **Active:** Accent-dim background, accent text, and a translucent accent border.
- **Mobile / narrow:** Collapse or hide secondary rail labels while keeping the active route and primary actions discoverable.

### Signature Component: HUD Frame
Use corner brackets, a short cyan top rule, and a status dot to frame live automation, command-center zones, or system evidence. Keep the treatment sparse enough that ordinary cards remain quiet.

## Do's and Don'ts

### Do:
- **Do** keep the main workspace dark, quiet, and grouped like a desktop operations console.
- **Do** use cyan as a precise interaction and telemetry signal.
- **Do** use mono typography for values, timestamps, identifiers, and logs.
- **Do** preserve hairline borders, compact radii, and visible state transitions.
- **Do** retain keyboard focus rings and reduced-motion behavior.
- **Do** let neutral surfaces carry most of each screen, matching the supplied visual reference.

### Don't:
- **Don't** turn every panel into a glowing HUD frame.
- **Don't** use cyan for success, warning, or failure when semantic colors are available.
- **Don't** introduce large rounded cards, soft consumer-app gradients, or decorative hero treatments into operational screens.
- **Don't** replace readable body text with condensed or monospaced display faces.
- **Don't** hide important automation state behind a spinner without a label, status, or evidence path.
- **Don't** remove reduced-motion fallbacks or visible focus treatment.
