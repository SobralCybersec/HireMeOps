---
title: "Non-Generic AI Frontend Specification"
version: "2.0.0"
status: "Normative"
last_updated: "2026-07-10"
research_revision: "Deep-research consolidation"
applies_to:
  - web applications
  - desktop applications
  - AI assistants
  - agent consoles
  - dashboards
  - command centers
  - internal tools
  - landing pages
---

# Non-Generic AI Frontend Specification

# 1. Purpose

This specification prevents AI coding agents, UI generators, designers, and contributors from defaulting to statistically common, interchangeable interface choices.

The goal is **not** to reject cards, sidebars, gradients, dark mode, dashboards, or component libraries universally. The goal is to reject their unexamined use.

Every major visual and interaction decision MUST be derived from:

1. the product domain;
2. the user's primary task;
3. the information hierarchy;
4. the product's visual metaphor;
5. actual data and system state;
6. accessibility requirements;
7. platform and input constraints.

A screen is non-generic when its structure would be difficult to reuse unchanged for an unrelated product.


## 1.1 Revision scope

Version 2 incorporates a broader review of recurring AI-generated frontend patterns, including:

- generic application shells;
- centered marketing heroes;
- feature-card grids;
- modal-first workflows;
- wizard-first onboarding;
- CRUD-table defaults;
- carousels and infinite feeds;
- tooltip tours;
- toast-only feedback;
- generic loading and empty states;
- search, authentication, profile, FAQ, and footer boilerplate;
- inherited accessibility failures;
- missing security and privacy behavior;
- weak automated enforcement.

The revision also corrects several overbroad recommendations found in informal design commentary:

- familiar conventions are not prohibited merely because they are common;
- no font family is banned by name;
- custom fonts are not required when system fonts better satisfy performance, language, or accessibility needs;
- skeleton screens are not automatically superior to progress text or stable placeholders;
- ARIA MUST NOT be used as a substitute for correct native semantics;
- CAPTCHA is not a universal requirement and MUST NOT be introduced without an abuse model and accessible alternative;
- charts do not need animation or interactivity unless those behaviors support the analytical task;
- visual distinctiveness MUST NOT reduce clarity, predictability, or task completion.

---

## 1.2 Non-generic does not mean unfamiliar

A conventional control MAY be the correct control.

The specification rejects **unreasoned template composition**, not established interaction conventions. A standard button, table, dialog, tab set, form, or sidebar is acceptable when it matches user expectations and the task model.

Novelty MUST NOT create a usability tax.

Before replacing a familiar pattern, document:

- the user problem the replacement solves;
- the expected benefit;
- the new interaction cost;
- keyboard and assistive-technology behavior;
- how users will discover the interaction;
- how the choice will be tested.

A distinctive interface SHOULD remain learnable without a tutorial.

---

## 1.3 Convention, template, and genericity

Use these distinctions:

- **Convention:** a familiar behavior that reduces learning cost, such as a labeled button or standard form control.
- **Pattern:** a reusable solution to a recurring interaction problem.
- **Template:** a preassembled composition intended for broad reuse.
- **Generic interface:** a template-like composition whose structure, styling, and copy are insufficiently connected to the product domain and task.
- **Distinctive interface:** a task-appropriate composition with domain-specific hierarchy, objects, states, language, and interaction.

A pattern does not become invalid because it is common. It becomes generic when it is selected without task evidence or combined with other defaults until the product is interchangeable.

---

## 1.4 Evidence classification

Every new design rule SHOULD be classified as one of:

```yaml
evidence:
  level: "standard | empirical | heuristic | project-preference"
  source: ""
  scope: ""
  known_limitations: ""
```

- **Standard:** accessibility, platform, legal, or security requirement.
- **Empirical:** supported by user research, controlled study, telemetry, or reproducible evaluation.
- **Heuristic:** expert guidance that requires contextual judgment.
- **Project preference:** intentional brand or product constraint.

Project preferences MUST NOT be presented as universal usability facts.

---

# 2. Normative language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

- **MUST / MUST NOT**: required for acceptance.
- **SHOULD / SHOULD NOT**: expected unless a documented exception exists.
- **MAY**: optional.

---

# 3. Core rule

> Do not design a generic interface and apply the product name afterward.

Before implementing a screen, the contributor MUST be able to answer:

- What decision does this screen help the user make?
- What object is the user acting on?
- What information must remain visible during that action?
- What is unique about this domain?
- Why is this layout preferable to a standard SaaS dashboard?
- What changes when the data is empty, delayed, partial, stale, failed, or live?
- How is the screen usable without animation, hover, color, or a mouse?

If these answers are missing, implementation MUST NOT begin.

---

# 4. Prohibited generic defaults

## 4.1 Generic SaaS composition

The following composition MUST NOT be used as an automatic starting point:

- fixed left sidebar;
- top header with search, bell, avatar, and theme toggle;
- page title plus subtitle;
- four KPI cards;
- one large chart;
- recent activity list;
- three equal feature cards;
- generic settings page with stacked rounded sections;
- identical card grid across every route;
- dashboard as the default home screen without a monitoring requirement.

These patterns MAY be used only when the product task genuinely requires them and the design rationale is documented.

### Required replacement question

Instead of asking, “Which cards should appear here?”, ask:

> What persistent workspace, instrument, timeline, canvas, queue, graph, document, map, or command surface best represents this task?

---

## 4.2 Cardification

Containers MUST NOT automatically become floating cards.

Avoid:

- a card inside another card;
- every paragraph in its own bordered container;
- every metric displayed as an isolated tile;
- excessive rounded rectangles;
- shadows used solely to make plain content look designed;
- equal visual weight for unrelated information;
- decorative borders around content that already has clear grouping.

Prefer:

- continuous surfaces;
- sectional dividers;
- typographic hierarchy;
- tables or grids for comparable data;
- spatial relationships;
- aligned instrumentation;
- master-detail layouts;
- object-centric inspectors;
- timelines;
- direct manipulation.

A card MUST have a reason, such as:

- it is movable;
- it is selectable;
- it represents a discrete object;
- it can be independently expanded, dismissed, or reordered;
- it has a different state lifecycle from surrounding content.

---

## 4.3 Generic AI color palettes

The following MUST NOT be selected without domain justification:

- purple-to-blue gradients;
- cyan glow on dark navy;
- cream or beige background with burnt-orange accents;
- black background with neon violet;
- arbitrary “AI” rainbow gradients;
- one accent color applied indiscriminately;
- glass panels over decorative blobs.

The palette MUST be derived from at least one of:

- product domain semantics;
- brand identity;
- environmental metaphor;
- data-status semantics;
- source material;
- platform conventions;
- accessibility constraints.

Color MUST NOT be the only carrier of meaning.

---

## 4.4 Generic typography

Typography MUST NOT be selected merely because it appears in a framework starter or AI-generated example.

Do not default automatically to:

- one font for every semantic role;
- oversized gradient headlines;
- widely tracked uppercase labels everywhere;
- serif italics used only to simulate editorial character;
- tiny low-contrast helper text;
- identical weight and spacing for labels, values, alerts, and body content;
- arbitrary monospace text used to make ordinary content appear technical.

No font family is prohibited solely because it is popular. Inter, Roboto, system fonts, and other common families MAY be correct choices when justified by:

- language coverage;
- rendering quality;
- accessibility;
- performance;
- platform consistency;
- dense-data readability;
- existing brand requirements.

Typography MUST define roles for:

- interface labels;
- body text;
- dense operational data;
- code or machine output;
- numeric values;
- alerts;
- document or editorial content.

At least one typographic decision MUST be product-specific: family, numeric style, display treatment, code face, scale, density, line length, alignment, or layout behavior.

Readability, language support, accessibility, and platform performance take priority over novelty.

---

## 4.5 Empty decorative hero sections

Application screens MUST NOT begin with a marketing-style hero containing:

- “Welcome back”;
- a vague motivational sentence;
- a decorative gradient;
- an oversized product slogan;
- a nonfunctional illustration;
- generic quick-action cards.

The first viewport SHOULD expose current work, system state, unresolved decisions, or the primary object.

Marketing pages MAY use hero sections, but the hero MUST communicate a concrete product distinction and a meaningful next action.

---

## 4.6 Meaningless visual effects

The following MUST NOT be added solely to create visual complexity:

- random particle backgrounds;
- animated grid lines;
- constant glow;
- cursor-following blobs;
- infinite marquee text;
- floating geometric shapes;
- fake terminal output;
- parallax on operational content;
- 3D objects unrelated to data or interaction;
- scanlines applied across all text;
- continuous pulsing of inactive elements;
- animations on every hover.

Every animation MUST perform at least one function:

- explain spatial relationship;
- communicate state change;
- preserve continuity;
- direct attention to a time-sensitive event;
- confirm an action;
- visualize progress;
- reveal hierarchy.

The interface MUST provide a reduced-motion mode. Essential state changes MUST remain understandable without animation.

---

## 4.7 Fake technical aesthetics

A technical product MUST NOT rely on fake complexity.

Prohibited examples:

- hexadecimal strings with no system meaning;
- random telemetry values;
- fake command logs;
- decorative charts with static invented data;
- meaningless “SYSTEM ONLINE” labels;
- terminal windows that cannot execute or inspect anything;
- severity colors disconnected from actual severity;
- arbitrary coordinates or timestamps;
- pseudo-code used as decoration.

Technical elements MUST be connected to real application state or clearly marked as illustrative demo data.

---

## 4.8 Chat as the universal interface

Chat MUST NOT be the only interaction model when the task involves structured state.

Do not use chat as the primary surface for:

- comparing several items;
- editing a workflow;
- reviewing many approvals;
- changing multiple parameters;
- navigating a document;
- inspecting a dependency graph;
- managing a queue;
- manipulating spatial objects;
- tracking a long-running process;
- configuring repeatable automation.

Use task-specific interfaces such as:

- editable tables;
- timelines;
- node graphs;
- canvases;
- inspectors;
- diff viewers;
- form-based configuration;
- command palettes;
- review queues;
- maps;
- split views;
- generated task panels.

Chat MAY remain available as a secondary command and explanation surface.

---

## 4.9 Dashboard without a decision model

A dashboard MUST NOT exist merely because the product has data.

Every dashboard element MUST map to:

- a decision;
- a threshold;
- an anomaly;
- a trend;
- a comparison;
- a responsibility;
- a controllable process.

A metric without an expected action SHOULD be removed or moved to a report.

A chart MUST include, when applicable:

- title;
- units;
- time range;
- comparison baseline;
- legend;
- data freshness;
- empty state;
- loading state;
- error state;
- accessible text alternative;
- interaction affordances.

Do not use donut charts, gauges, or sparklines by habit. Choose the visual encoding based on the analytical question.

---

## 4.10 Bento grids by default

Bento grids MUST NOT be used simply because they appear modern.

They MAY be used when:

- modules are genuinely independent;
- relative size communicates priority;
- scanning is more important than sequential completion;
- responsive rearrangement preserves meaning.

They SHOULD NOT be used for:

- sequential workflows;
- dense comparable data;
- long-form reading;
- settings;
- forms;
- incident response;
- complex cross-panel dependencies.

---

## 4.11 Glassmorphism by default

Glassmorphism MUST NOT be the base visual system.

Translucency MAY be used when it communicates:

- elevation;
- temporary overlay;
- spatial depth;
- environmental continuity;
- a distinct transient layer.

Text contrast MUST remain valid over every possible background state. Blur MUST NOT be required to separate controls from content.

---

## 4.12 Generic iconography and emoji

Emoji MUST NOT substitute for:

- product illustrations;
- status systems;
- severity indicators;
- navigation icons;
- domain symbols;
- empty-state design.

Icons MUST be:

- semantically consistent;
- from a controlled set;
- paired with labels when ambiguity is possible;
- distinguishable without color;
- aligned to the domain vocabulary.

Do not mix several icon libraries without a documented reason.

---

## 4.13 Generic AI copy

Avoid interface copy such as:

- “Unlock the power of AI”;
- “Supercharge your workflow”;
- “Seamlessly transform”;
- “Intelligent insights”;
- “AI-powered excellence”;
- “Revolutionize your productivity”;
- “Welcome back”;
- “Everything you need in one place”;
- “Your smart assistant”;
- “Get started in seconds.”

Copy MUST describe:

- the object;
- the action;
- the consequence;
- the current state;
- the next decision.

Prefer “Retry failed application” over “Continue your journey.”

---

## 4.14 Generic centered hero composition

A centered headline, short paragraph, two buttons, floating badge, rounded product screenshot, and decorative gradient MUST NOT be treated as the universal landing-page composition.

A marketing hero MUST define:

- the specific audience;
- the concrete promise;
- the primary evidence;
- the single dominant next action;
- the role of the visual asset;
- the content budget for the first viewport.

Avoid placing unrelated statistics, testimonials, event notices, pricing callouts, badges, and secondary CTAs in the first viewport.

For application routes, the first viewport SHOULD prioritize current work and system state rather than a marketing hero.

---

## 4.15 Three-column feature grids and alternating feature ladders

The repeated pattern of:

1. icon;
2. heading;
3. two sentences;

across three equal columns MUST NOT be used by default.

Alternating image-left/text-right sections MUST NOT be repeated mechanically to create page length.

These layouts MAY be used when the items are genuinely peers and comparison is useful. Otherwise, use hierarchy that reflects:

- importance;
- sequence;
- dependency;
- audience;
- evidence;
- narrative progression.

Equal columns MUST NOT imply equal importance when the content is not equal.

---

## 4.16 Sidebar navigation as an automatic shell

A fixed left sidebar plus top bar MUST NOT be selected before the information architecture is known.

A persistent sidebar is justified when:

- users switch frequently among several stable work areas;
- navigation labels remain predictable;
- the viewport can support persistent navigation;
- the current location is always clear;
- the sidebar does not displace the primary task excessively.

It SHOULD NOT be used merely because an admin template includes one.

Alternatives include:

- task-local tabs;
- object navigation;
- command palette;
- contextual rail;
- workspace switcher;
- top-level navigation;
- tree view;
- split-view hierarchy.

Mobile behavior MUST be designed explicitly rather than converting every sidebar into an unlabeled hamburger menu.

---

## 4.17 Modal-first workflows

Dialogs MUST NOT contain entire multi-screen workflows by default.

Prohibited:

- nested dialogs;
- dialogs launched from dialogs;
- long forms inside small modal surfaces;
- navigation hidden behind a modal;
- irreversible actions without clear consequences;
- dialogs that cannot restore focus correctly;
- modal content whose URL or state cannot be recovered when recovery is required.

Use a dialog when the task is:

- brief;
- bounded;
- interruptive by nature;
- dependent on the current context;
- safe to cancel.

Use a page, panel, sheet, or dedicated workspace for complex or persistent work.

Native dialog semantics and focus behavior SHOULD be preferred over custom ARIA implementations.

---

## 4.18 Wizard-first onboarding

A stepper MUST NOT be used merely to make a short form appear guided.

A wizard is justified when:

- later steps depend on earlier decisions;
- the task has meaningful stages;
- the user benefits from constrained scope;
- progress can be represented truthfully;
- data can be saved and resumed;
- validation can occur without losing prior work.

A wizard MUST provide:

- meaningful step names;
- current position;
- completion criteria;
- back navigation;
- save/resume behavior when the task is long;
- validation summary;
- recovery after refresh or session loss;
- accessible focus management.

Do not force linearity when users need to compare or revise information across steps.

---

## 4.19 CRUD table as the universal enterprise interface

Tables are appropriate for comparing structured records. They are not a default replacement for information architecture.

A data table MUST define:

- comparison task;
- primary row identity;
- stable columns;
- sorting behavior;
- filtering behavior;
- selection model;
- batch actions;
- editing model;
- keyboard navigation;
- overflow behavior;
- accessible headers;
- empty and error states.

Do not replace a useful dense table with cards solely to appear modern.

Do not use a table when users primarily need:

- narrative detail;
- spatial relationships;
- process state;
- object inspection;
- causal history;
- visual comparison.

For complex records, consider table plus inspector rather than forcing all detail into columns.

---

## 4.20 Carousels and auto-rotating content

Critical content MUST NOT be hidden in an automatically rotating carousel.

Auto-rotation SHOULD be avoided. When used, it MUST:

- provide pause and previous/next controls;
- stop on interaction;
- preserve keyboard focus;
- honor reduced motion;
- expose the current position;
- avoid changing before content can be read;
- contain no essential action available only on one slide.

Manual horizontal collections MAY be valid for media browsing, but they MUST preserve discoverability and keyboard access.

---

## 4.21 Infinite feeds and undifferentiated activity streams

An activity stream MUST NOT become the default representation for every event.

A feed MUST define:

- event taxonomy;
- importance;
- grouping;
- filtering;
- deduplication;
- read state;
- retention;
- pagination or bounded loading;
- link to affected objects;
- sensitive-data treatment.

Critical events MUST NOT compete visually with routine events.

Infinite scroll SHOULD NOT be used when users need:

- stable position;
- comparison;
- return navigation;
- total count;
- archival browsing;
- auditability.

Use pagination, time windows, grouping, saved views, or a queryable event log where appropriate.

---

## 4.22 Product tours and tooltip-driven instruction

A product tour MUST NOT compensate for unclear information architecture.

Tooltips MUST NOT contain essential instructions, validation requirements, or information needed to complete the task.

Tours MAY be used for optional orientation when they are:

- dismissible;
- restartable;
- versioned with the UI;
- keyboard accessible;
- non-blocking;
- short;
- targeted to meaningful differences.

Prefer:

- contextual examples;
- clear labels;
- progressive disclosure;
- sample data;
- inline help;
- searchable documentation;
- safe practice mode.

---

## 4.23 Toast-only feedback

A toast MUST NOT be the only record of:

- failure;
- destructive action;
- permission denial;
- background job result;
- security event;
- irreversible state change.

Use:

- inline validation for field problems;
- persistent banners for blocking page-level problems;
- job or event history for asynchronous operations;
- dialogs only when immediate acknowledgement is required;
- `role="status"` for non-urgent updates;
- `role="alert"` only for urgent updates that require immediate announcement.

Toasts MUST NOT expose secrets or sensitive personal information.

---

## 4.24 Generic loading treatment

A spinner, shimmer, or skeleton MUST NOT be selected without understanding the wait.

Choose loading feedback based on the operation:

| Operation | Preferred feedback |
|---|---|
| brief local state change | immediate state transition or compact status |
| stable known layout | skeleton MAY be appropriate |
| unknown or variable structure | progress text or reserved region |
| measurable transfer | determinate progress |
| multi-phase AI task | phase, partial results, cancellation, checkpoint |
| background operation | persistent job state and notification |
| delayed live data | last-known data plus freshness indicator |

Skeletons MUST NOT imply content structure that may not arrive.

Loading animation MUST honor reduced-motion preferences.

Timeout, cancellation, retry, offline, and partial-success behavior MUST be defined.

---

## 4.25 Generic empty states

“No data” is insufficient.

Empty states MUST distinguish:

- first use;
- no permission;
- no matching filter;
- delayed synchronization;
- deleted or archived content;
- unavailable dependency;
- successful completion;
- error disguised as absence.

An empty state SHOULD explain:

- why the region is empty;
- whether this is expected;
- what action is available;
- what will happen after the action;
- whether sample data is available.

Illustration is optional and MUST NOT replace useful guidance.

---

## 4.26 Generic search-result pages

Search results MUST expose enough context to support selection.

For nontrivial datasets, define:

- query scope;
- matching fields;
- ranking or ordering;
- filters;
- sort;
- result count or bounded estimate;
- highlighted matches where useful;
- result preview;
- zero-result recovery;
- spelling or query assistance;
- loading and stale-index behavior;
- authorization filtering.

Do not add filters merely to appear advanced. Each filter MUST map to a real user distinction.

Search input, logs, and analytics MUST be handled according to privacy and security requirements.

---

## 4.27 Generic authentication and profile pages

Authentication screens SHOULD prioritize clarity, trust, recovery, and platform conventions over visual novelty.

They MUST NOT:

- hide labels inside placeholders;
- prevent password-manager paste;
- expose whether a protected account exists beyond the product's threat model;
- default to unnecessary data collection;
- use decorative complexity that obscures the primary action;
- require CAPTCHA without an abuse model and accessible alternative;
- expose sensitive state in URLs, analytics, or toasts.

Profile screens MUST distinguish:

- public identity;
- private account data;
- security controls;
- organization-managed values;
- preferences;
- destructive account actions.

Security-sensitive actions require explicit consequence and recovery design.

---

## 4.28 FAQ and accordion dumping

An accordion MUST NOT be used to avoid editing or structuring content.

Use accordions when:

- users need a small subset of independent answers;
- headings are meaningful;
- expansion preserves context;
- content remains searchable and linkable where required.

Do not hide primary instructions, legal obligations, pricing constraints, or critical troubleshooting steps behind collapsed panels by default.

Use native disclosure elements where appropriate and verify keyboard and screen-reader behavior.

---

## 4.29 Placeholder footers and legal afterthoughts

A marketing or public product footer MUST NOT be copied unchanged from a generic template.

The footer SHOULD contain only relevant destinations, such as:

- legal and privacy information;
- accessibility statement;
- security or status page;
- support;
- product documentation;
- organization information;
- locale or regional controls where needed.

Do not add empty social links, invented office addresses, fake newsletter forms, or broad navigation columns with no user evidence.

Application workspaces MAY use a minimal utility footer or no footer when persistent workspace behavior makes one unnecessary.

---

## 4.30 Responsive collapse by vertical stacking

Responsive design MUST NOT consist solely of changing every grid to one column.

At each size, reconsider:

- the primary task;
- information priority;
- interaction mode;
- target size;
- navigation;
- persistent context;
- data density;
- chart substitution;
- table strategy;
- panel order;
- unsupported expert operations.

A compact monitoring view MAY be more useful than a compressed editing workspace.

---

## 4.31 Generic AI feature decoration

The following MUST NOT be attached to every AI-related control:

- sparkle icon;
- purple badge;
- “magic” wording;
- pulsing gradient border;
- typing dots;
- robot avatar;
- “Ask AI” button detached from a specific action;
- model selector exposed to users who do not need model control;
- token counter presented as a primary product metric.

AI affordances MUST communicate the actual capability:

- summarize;
- classify;
- compare;
- draft;
- extract;
- execute;
- plan;
- explain;
- transform;
- monitor.

Use action-specific labels rather than a universal “AI” label.

---

## 4.32 Fake social proof and invented credibility

AI-generated interfaces MUST NOT invent:

- customer logos;
- testimonials;
- usage counts;
- ratings;
- awards;
- certifications;
- live-user indicators;
- security claims;
- compliance badges;
- benchmark numbers.

Mock content MUST be visibly marked as mock, fixture, sample, or placeholder content.

A prototype MUST NOT visually imply production security, compliance, uptime, or adoption without evidence.

---

## 4.33 Generic-pattern combination rule

A single common pattern MAY be appropriate. Genericity often emerges from combinations.

The following cluster requires redesign review:

- left sidebar;
- top utility bar;
- four KPI cards;
- large line chart;
- rounded cards throughout;
- common default font without typographic roles;
- violet or cyan accent;
- glass panels;
- sparkle icons;
- “Welcome back” copy;
- recent activity feed;
- no domain-specific object representation.

If four or more unrelated defaults appear together without explicit task rationale, the implementation SHOULD be treated as a template-derived composition.

---

# 5. Required design direction

## 5.1 Choose a primary interface archetype

Each product MUST declare one primary archetype:

- command center;
- expert cockpit;
- IDE or workbench;
- document workspace;
- review queue;
- timeline;
- map-first interface;
- graph-first interface;
- canvas;
- library;
- operations console;
- simulation;
- command palette;
- object inspector;
- collaborative room;
- task-generated interface.

Secondary archetypes MAY be combined, but one MUST control the hierarchy.

Example:

```yaml
interface_archetype:
  primary: "repository control tower"
  secondary:
    - "event timeline"
    - "object inspector"
    - "command palette"
```

---

## 5.2 Define a coherent visual metaphor

The metaphor MUST affect structure and interaction, not only decoration.

A valid metaphor defines:

- what the primary objects are;
- how objects are grouped;
- how state is represented;
- how navigation works;
- what depth means;
- how alerts appear;
- how time is represented;
- how the user acts on the system.

Examples:

| Product | Weak treatment | Strong metaphor |
|---|---|---|
| Coding agent | Chat plus file cards | Repository control tower |
| Job automation | Generic analytics dashboard | Recruitment operations center |
| Cybersecurity | Neon cards | Evidence-driven incident war room |
| Knowledge app | Chat plus documents | Research desk with source map |
| Model manager | Model cards | Compute inventory and deployment console |
| Multi-agent app | Avatar card grid | Live execution topology |

A metaphor MUST NOT reduce usability or make familiar actions harder to recognize.

---

## 5.3 Use domain-derived components

At least three primary components MUST be specific to the domain.

Examples:

- repository topology;
- application pipeline;
- incident evidence chain;
- model memory allocation strip;
- agent execution timeline;
- document source alignment;
- dependency impact map;
- deployment health lane;
- CV first-page library;
- approval confidence matrix.

Generic `Card`, `Badge`, and `Button` components do not satisfy this requirement.

---

## 5.4 Design around objects, not pages

The system SHOULD define domain objects first.

For every main object, specify:

```yaml
object:
  name: ""
  identity_fields: []
  states: []
  transitions: []
  primary_actions: []
  destructive_actions: []
  related_objects: []
  live_fields: []
  permissions: []
  empty_state: ""
  error_state: ""
```

The interface SHOULD let users select, inspect, compare, modify, and trace objects without repeatedly losing context.

---

## 5.5 Preserve operational context

Expert interfaces SHOULD prefer persistent context over page replacement.

Consider:

- master-detail split views;
- dockable inspectors;
- expandable timeline events;
- persistent selection;
- breadcrumb or object-path context;
- side-by-side comparison;
- pinned references;
- command palette;
- keyboard navigation;
- resizable panels;
- synchronized charts and tables.

Do not force users through many routes when the task is one continuous investigation or operation.

---

## 5.6 First-viewport composition

The first viewport MUST read as one intentional composition.

For application screens, it SHOULD answer:

- where the user is;
- what object or process is active;
- what changed;
- what requires attention;
- what action is primary.

For marketing screens, it SHOULD communicate:

- product identity;
- audience;
- concrete value;
- evidence;
- one dominant action.

The first viewport MUST NOT be assembled by filling a checklist of header, cards, chart, feed, and CTA.

---

## 5.7 Task-to-interface selection matrix

Select the primary interaction based on the task shape.

| User task | Prefer | Avoid as default |
|---|---|---|
| Compare records | table, comparison matrix, aligned detail | unrelated cards |
| Monitor live state | status board, timeline, map, alert lanes | marketing dashboard |
| Investigate cause | master-detail, evidence chain, synchronized views | chat-only workflow |
| Review changes | diff, before/after, approval queue | plain generated summary |
| Create structured content | editor, canvas, form, direct manipulation | conversational reconstruction |
| Configure a system | grouped form, schema editor, preview | long chat exchange |
| Navigate hierarchy | tree, breadcrumb, object path | flat card grid |
| Explore spatial data | map, topology, scene | generic table alone |
| Understand sequence | timeline, stages, dependency view | unordered cards |
| Execute commands | command palette, console, action panel | decorative terminal |
| Manage asynchronous jobs | queue, job inspector, event history | transient toasts |
| Read and annotate sources | document workspace, source alignment | chat transcript only |
| Resolve exceptions | triage queue, confidence/evidence panel | raw activity feed |

This table is guidance, not a ban. The chosen pattern MUST be justified by the user's task.

---

## 5.8 Prefer rarely generated but operationally valuable patterns

AI generators frequently underproduce the following patterns even when they are useful:

- master-detail views;
- persistent inspectors;
- compare and diff modes;
- saved filters and views;
- query builders;
- batch actions with previews;
- version history;
- undo and compensating actions;
- conflict resolution;
- offline queues;
- resizable panes;
- keyboard-first workflows;
- direct manipulation;
- synchronized chart/table selection;
- source-aligned annotations;
- high-density expert mode;
- role-specific views;
- state replay;
- audit timelines;
- data provenance;
- functional split views.

These patterns SHOULD be considered before adding more cards or chat messages.

---

## 5.9 Domain-component ratio

For each primary screen:

- at least three meaningful components SHOULD be named in domain language;
- the primary object SHOULD be recognizable without the product logo;
- generic primitives SHOULD support domain components rather than define the screen;
- component names SHOULD describe user concepts, not visual containers.

Prefer:

```text
ApplicationPipeline
FailureEvidencePanel
RepositoryTopology
AgentRunTimeline
ModelMemoryMap
CandidateComparison
```

over:

```text
DashboardCard
InfoBox
GenericPanel
FeatureTile
DataWidget
```

This is a design and code-architecture constraint.

---

# 6. Information hierarchy requirements

Every screen MUST define four levels:

1. **Critical:** requires immediate attention or blocks progress.
2. **Primary:** supports the current user task.
3. **Secondary:** contextual information needed for judgment.
4. **Tertiary:** available on demand.

Equal-sized cards MUST NOT be used to represent unequal importance.

Hierarchy MUST be visible through more than color:

- position;
- scale;
- density;
- grouping;
- label;
- typography;
- border or shape;
- motion, when enabled.


## 6.1 Density is task-dependent

Sparse design is not automatically clearer, and dense design is not automatically cluttered.

The product SHOULD support density appropriate to:

- expertise;
- frequency of use;
- screen size;
- decision speed;
- comparison needs;
- accessibility preferences.

Expert workspaces MAY offer compact, default, and comfortable density modes.

Whitespace MUST express grouping and hierarchy. It MUST NOT be added solely to imitate a premium landing page.

---

## 6.2 Priority, severity, and frequency are different

Do not use the same visual treatment for:

- high-frequency routine actions;
- severe alerts;
- important but nonurgent information;
- rare destructive actions;
- current selection;
- unread updates.

Each dimension MUST have a documented representation.

A frequently used action is not necessarily visually dominant.
A severe event is not necessarily the primary workflow.
Unread does not necessarily mean urgent.

---

---

# 7. State completeness

Every data-driven component MUST define applicable states from this catalogue:

- initial;
- loading;
- optimistic;
- queued;
- partial data;
- success;
- empty;
- filtered empty;
- stale data;
- refreshing;
- offline;
- reconnecting;
- conflict;
- rate limited;
- timeout;
- cancelled;
- recoverable error;
- unrecoverable error;
- permission denied;
- authentication expired;
- dependency unavailable;
- disabled;
- read only;
- live updating;
- completed;
- archived;
- deleted;
- retry scheduled;
- partially successful.

A loading spinner alone is insufficient for complex operations.

For long-running AI or automation actions, show:

- current phase;
- completed work;
- pending work;
- elapsed time;
- whether the process can be paused or cancelled;
- partial results;
- retry behavior;
- retry count;
- next retry time, when known;
- last successful checkpoint;
- failure reason;
- affected objects;
- whether external side effects already occurred.

Never fabricate precise progress percentages without measurable progress.

## 7.1 Optimistic updates

Optimistic UI MAY be used only when:

- failure is recoverable;
- rollback is understandable;
- external side effects are controlled;
- the user is informed if synchronization fails.

A success toast MUST NOT conceal a later synchronization failure.

## 7.2 Partial success

Bulk and agent operations MUST distinguish:

- all succeeded;
- some succeeded;
- none succeeded;
- completion unknown.

Partial success MUST expose item-level outcomes and safe retry scope.

## 7.3 Staleness and freshness

Live or cached data MUST expose freshness when stale information could affect decisions.

Use:

- last updated time;
- connection status;
- source status;
- pending refresh state;
- stale-data indicator;
- last-known-value labeling.

Do not replace visible data with an empty loader during every refresh when safe last-known data can remain visible.

---

# 8. AI-specific interface requirements

## 8.1 Make autonomy visible

The interface MUST distinguish:

- suggestion;
- draft;
- planned action;
- action awaiting approval;
- action in progress;
- completed action;
- failed action;
- automatically retried action;
- action blocked by policy or permission.

Do not represent all agent activity as chat messages.

---

## 8.2 Show evidence and provenance

AI-generated conclusions SHOULD expose:

- source;
- timestamp;
- confidence or uncertainty, when meaningful;
- model or agent responsible;
- tools used;
- relevant input version;
- affected objects;
- approval status.

Confidence MUST NOT be presented as fake precision. Use ranges or categorical labels when the underlying estimate is not calibrated.

---

## 8.3 Separate reasoning from auditability

The interface MUST NOT require hidden chain-of-thought disclosure.

Instead, expose a concise audit trail:

- action requested;
- evidence consulted;
- rule or criterion applied;
- tool executed;
- result;
- uncertainty;
- user-visible consequence.

---

## 8.4 Human control

Autonomous systems MUST provide, when technically possible:

- pause;
- cancel;
- retry;
- edit before execution;
- approve;
- reject;
- undo or compensating action;
- scope restriction;
- clear indication of irreversible actions.

Destructive or externally visible actions MUST NOT be visually equivalent to reversible local actions.

---

## 8.5 Generated UI boundaries

When AI generates task-specific UI, it MUST use a constrained component registry.

Generated interfaces MUST NOT:

- execute arbitrary client code;
- invent unsupported actions;
- bypass permission checks;
- hide system status;
- create inaccessible interaction patterns;
- persist unvalidated schema;
- silently change user data.

Generated controls MUST map to declared actions and validated schemas.

---

## 8.6 AI interaction trope controls

The interface MUST NOT assume that an AI feature requires a chat transcript.

For each AI capability, select a primary artifact:

| Capability | Primary artifact |
|---|---|
| summarize | structured summary linked to sources |
| compare | comparison view or matrix |
| generate code | diff, file patch, test result |
| automate workflow | plan, execution graph, job state |
| classify | labeled queue with evidence |
| research | source workspace and report |
| transform document | before/after or tracked changes |
| analyze data | query, chart, table, assumptions |
| make recommendation | ranked options, criteria, uncertainty |
| control system | explicit action plan and approval state |

Chat MAY explain or modify the artifact, but SHOULD NOT replace it.

---

## 8.7 Model and parameter exposure

Model selectors, temperature controls, token limits, and provider settings SHOULD be shown only to users who need them.

Expose technical controls when they affect:

- cost;
- privacy;
- latency;
- output constraints;
- local versus remote execution;
- reproducibility;
- compatibility;
- organizational policy.

Otherwise, use task-oriented settings and safe defaults.

---

## 8.8 Confidence and uncertainty

The interface MUST NOT display a precise confidence percentage unless it is calibrated and meaningful for the decision.

Prefer:

- evidence strength;
- known limitations;
- missing inputs;
- conflicting sources;
- confidence bands;
- explicit uncertainty;
- validation status.

A visual confidence label MUST NOT replace access to evidence.

---

## 8.9 Agent interruption and recovery

An agent run MUST define:

- safe pause point;
- cancellation behavior;
- rollback or compensating action;
- completed external actions;
- pending approval;
- retry scope;
- resume behavior;
- session-expiry behavior.

The stop control MUST explain whether it stops generation only, stops tool execution, or attempts to cancel external actions.

---

# 9. Accessibility baseline

The product MUST target WCAG 2.2 Level AA for web and hybrid interfaces unless a stricter requirement applies.

At minimum:

- all functionality works with keyboard input;
- focus is visible and not obscured;
- focus order follows task order;
- text and non-text contrast meet requirements;
- semantic landmarks and headings are present;
- controls have accessible names;
- native semantic elements are preferred;
- ARIA is added only when native semantics cannot express the interaction;
- live AI updates are announced appropriately without flooding assistive technology;
- errors are specific and connected to affected fields;
- touch targets satisfy applicable minimum sizing;
- drag interactions have non-drag alternatives;
- hover-only content is also available by focus or explicit activation;
- reduced motion is supported;
- charts have text alternatives or accessible data views;
- color is not the only status signal;
- zoom and reflow remain usable;
- loading, error, and empty states are perceivable;
- authentication works with password managers and paste;
- timeout behavior is communicated and recoverable where possible.

Automated accessibility checks are necessary but insufficient. Keyboard, zoom/reflow, reduced-motion, and screen-reader testing MUST be included before release.

## 9.1 Native semantics before ARIA

Do not add `role`, `aria-label`, or keyboard handlers to a generic element when a native element provides the required semantics.

Prefer:

- `button` for actions;
- `a` for navigation;
- `label` associated with form controls;
- `table` for tabular relationships;
- `details` and `summary` for simple disclosure;
- `dialog` where platform support and behavior are appropriate.

ARIA MUST NOT change the visible meaning of a control or conceal missing visible labels.

## 9.2 Dynamic AI output

Streaming output MUST:

- avoid announcing every token;
- provide a stable region;
- announce meaningful completion or phase changes;
- preserve reading position;
- allow pause or stop where practical;
- avoid stealing focus;
- expose generated content in normal document structure after completion.

## 9.3 Accessibility evidence

A release SHOULD include:

- automated axe or equivalent report;
- keyboard-path test;
- focus-order review;
- 200% and 400% zoom/reflow checks where applicable;
- reduced-motion check;
- high-contrast or forced-colors check where supported;
- screen-reader smoke test for primary workflows;
- accessible-name inspection;
- chart alternative review.

---

# 10. Motion specification

Each animation MUST be documented with:

```yaml
motion:
  trigger: ""
  purpose: ""
  affected_elements: []
  duration_ms: 0
  interruptible: true
  reduced_motion_behavior: ""
  fallback_state: ""
```

Animation MUST NOT delay access to primary controls.

Recommended behavior:

- status feedback: short and direct;
- navigation transitions: preserve spatial continuity;
- live events: animate only the changed region;
- critical alerts: noticeable but not continuously pulsing;
- background decoration: disabled by default in operational views;
- reduced motion: replace movement with opacity, instant state change, or static emphasis.

---

# 11. Data visualization rules

A visualization MUST answer a named question.

Example:

```yaml
visualization:
  question: "Are failed applications increasing compared with the previous seven days?"
  audience: "operator"
  action_if_abnormal: "inspect failure-reason breakdown"
  chart_type: "time series"
  unit: "applications"
  freshness: "live"
  comparison: "previous 7-day period"
```

MUST NOT:

- use a chart as decoration;
- truncate axes deceptively;
- rely on color alone;
- hide units;
- omit time range;
- display more precision than the data supports;
- animate historical data continuously;
- show synthetic demo data as live data;
- use 3D charts for ordinary comparison.

SHOULD provide:

- table view;
- data export;
- visible freshness;
- legend or direct labels;
- accessible summary;
- filtering;
- anomaly explanation;
- linked detail inspection.

---

# 12. Content and error design

Error messages MUST:

- state what happened;
- identify the affected object;
- explain whether user action can fix it;
- preserve valid user input;
- provide a concrete recovery action;
- avoid blame;
- avoid vague text such as “Something went wrong.”

Example:

Bad:

> Something went wrong. Try again.

Better:

> The application could not be submitted because the employer page expired. The saved answers are unchanged. Reload the page and retry submission.

Empty states MUST distinguish:

- first use;
- no results;
- no results after filtering;
- deleted data;
- unavailable data;
- insufficient permission;
- delayed synchronization.

Do not use the same empty-state illustration and message for every case.

---

# 13. Responsive behavior

Responsive design MUST NOT mean stacking every panel vertically.

For each breakpoint, define:

- primary task;
- preserved context;
- hidden or deferred information;
- navigation model;
- panel behavior;
- table behavior;
- chart behavior;
- touch adaptation;
- keyboard availability;
- unsupported workflows.

Dense expert workflows MAY explicitly require desktop width. In that case, mobile MUST provide a useful monitoring or triage mode instead of a broken compressed desktop interface.

---


# 14. Security, privacy, and trust behavior

Security and privacy MUST be visible in the interaction model, not hidden only in backend implementation.

## 14.1 Data minimization

The interface MUST NOT request, display, log, or retain data without a defined purpose.

For each sensitive field, document:

```yaml
sensitive_field:
  name: ""
  purpose: ""
  visibility: ""
  retention: ""
  masking: ""
  export_behavior: ""
  deletion_behavior: ""
  audit_behavior: ""
```

Do not expose secrets, tokens, credentials, personal identifiers, or confidential content in:

- URLs;
- screenshots;
- analytics events;
- client logs;
- toast messages;
- copied debug reports;
- browser history;
- public error reports.

## 14.2 Permission clarity

Before a consequential AI or automation action, the interface SHOULD show:

- capability requested;
- data accessed;
- external system affected;
- scope;
- duration;
- reversibility;
- approval requirement.

Permission language MUST describe the action, not merely the technical permission name.

## 14.3 Secure defaults

Defaults SHOULD minimize external side effects and unnecessary exposure.

Examples:

- previews before mass actions;
- least-privilege scopes;
- masked sensitive values;
- local processing when selected;
- explicit publication;
- disabled auto-submit until configured when risk requires it;
- organization policy enforcement.

Security defaults MUST be derived from the product threat model, not copied from a generic settings page.

## 14.4 Consent and dark-pattern prohibition

The interface MUST NOT:

- preselect optional consent;
- use visual hierarchy to pressure acceptance;
- make rejection substantially harder than acceptance without legal justification;
- disguise advertisements or sponsored actions;
- conceal recurring costs;
- use confirmshaming;
- create false urgency;
- make account deletion intentionally harder than account creation.

## 14.5 Authentication and recovery

Authentication flows MUST define:

- account discovery behavior;
- rate limiting and abuse response;
- recovery path;
- session expiration;
- device or organization policy;
- MFA or passkey behavior where supported;
- error-message disclosure policy;
- accessibility fallback.

Do not add password-composition rules, password meters, CAPTCHA, or identity checks merely because they appear in common templates. Use the current security architecture and authoritative guidance.

## 14.6 Auditability

Externally visible or destructive AI actions MUST produce an audit record containing:

- actor;
- initiating user or policy;
- timestamp;
- target;
- action;
- result;
- relevant approval;
- recoverability;
- failure or retry status.

Audit records MUST be readable without exposing secrets.

---

# 15. Component-library policy

Using a component library is allowed. Shipping its default aesthetic unchanged is not.

When using libraries such as Radix, shadcn/ui, Material, Carbon, Chakra, or similar:

- component semantics MAY be reused;
- accessibility behavior SHOULD be preserved;
- default composition MUST be reconsidered;
- radii, spacing, density, typography, elevation, and states MUST be product-specific;
- examples from library documentation MUST NOT become the product layout;
- unused variants MUST be removed;
- domain components MUST wrap or compose primitives deliberately.

A design system is a constraint system, not a collection of copied components.

---

# 16. Design-token requirements

The project MUST define tokens for:

```yaml
tokens:
  typography:
    interface: ""
    display: ""
    mono: ""
    numeric: ""
  density:
    compact: ""
    default: ""
    comfortable: ""
  radius:
    control: ""
    panel: ""
    modal: ""
  elevation:
    base: ""
    overlay: ""
    critical: ""
  color:
    surface: {}
    text: {}
    border: {}
    status: {}
    data: {}
  motion:
    instant: ""
    fast: ""
    normal: ""
    slow: ""
  layout:
    reading_width: ""
    inspector_width: ""
    workspace_gap: ""
```

The token system MUST encode hierarchy and product identity. It MUST NOT merely rename framework defaults.

---

# 17. Required screen specification

Before generating or implementing a screen, complete this template:

```yaml
screen:
  name: ""
  route: ""
  primary_user: ""
  primary_task: ""
  decision_supported: ""
  primary_object: ""
  secondary_objects: []
  entry_conditions: []
  completion_condition: ""
  critical_information: []
  persistent_context: []
  primary_actions: []
  destructive_actions: []
  keyboard_actions: []
  live_updates: []
  permissions: []
  states:
    loading: ""
    partial: ""
    empty: ""
    filtered_empty: ""
    stale: ""
    offline: ""
    recoverable_error: ""
    fatal_error: ""
    permission_denied: ""
  responsive_behavior: ""
  reduced_motion_behavior: ""
  accessibility_notes: []
  domain_specific_components: []
  rejected_generic_patterns: []
  design_rationale: ""
  convention_changes: []
  generic_pattern_exceptions: []
  security_privacy_notes: []
  sensitive_data: []
  recovery_behavior: ""
  evaluation_plan: ""
```

A screen lacking this specification SHOULD be treated as incomplete.

---

# 18. AI coding-agent instruction block

Copy the following into project instructions for coding agents:

```text
Do not produce a generic SaaS or AI dashboard.

Before coding:
1. Identify the primary user task, domain object, decision, and required persistent context.
2. Select the declared interface archetype and visual metaphor.
3. List the generic patterns you are intentionally rejecting.
4. Define loading, partial, empty, stale, offline, error, permission, and live states.
5. Define keyboard and reduced-motion behavior.
6. Reuse the project's tokens and domain components.

Do not default to:
- a left sidebar plus top bar;
- four KPI cards;
- purple/blue gradients;
- excessive rounded cards;
- glassmorphism;
- decorative particles;
- fake terminal data;
- generic “AI-powered” copy;
- chat as the only interface;
- bento grids without hierarchy;
- animations without functional purpose;
- Inter solely because no typography choice was made.

Do not invent data, commands, metrics, permissions, agent actions, or backend capabilities.

Use cards only for truly discrete or independently actionable objects.
Use charts only when they answer a named question.
Keep expert context visible with split views, inspectors, timelines, tables, canvases, graphs, maps, or command surfaces where appropriate.
All controls must have complete states and accessible keyboard behavior.
Explain the domain-specific rationale in the implementation summary.

Do not replace established controls with novelty unless the project specification explicitly justifies the change.
Do not invent authentication requirements, CAPTCHA, password rules, social proof, security claims, telemetry, or compliance badges.
Do not use ARIA to imitate native controls when native HTML is available.
Do not report success only through a transient toast.
Do not use a wizard, modal, carousel, infinite feed, sidebar, table, or hero automatically; first show why its task properties require that pattern.
For every important asynchronous action, implement queued, running, partial, failed, cancelled, retry, and completed behavior as applicable.
```

---

# 19. Pull-request requirements

A frontend pull request MUST include:

- screenshot or recording at relevant viewport sizes;
- explanation of the primary task;
- explanation of the chosen hierarchy;
- list of rejected generic alternatives;
- loading, empty, error, and permission-state evidence;
- keyboard test result;
- reduced-motion test result;
- accessibility test result;
- responsive behavior notes;
- confirmation that displayed data is real, clearly mocked, or unavailable;
- confirmation that destructive actions are differentiated;
- confirmation that animation has a functional purpose.

Suggested PR checklist:

```markdown
## Frontend quality gate

- [ ] The screen is tied to a defined user task and domain object.
- [ ] The layout is not a copied SaaS/dashboard template.
- [ ] At least three primary elements are domain-specific.
- [ ] Information hierarchy is visible without relying only on color.
- [ ] Loading, partial, empty, filtered-empty, stale, error, and permission states exist.
- [ ] Keyboard navigation works.
- [ ] Focus remains visible and unobscured.
- [ ] Reduced motion works.
- [ ] Charts state their question, units, range, freshness, and fallback.
- [ ] No invented technical data is presented as real.
- [ ] No meaningless animation, glow, particles, or fake terminal content was added.
- [ ] Mobile behavior preserves a useful task rather than merely stacking desktop panels.
- [ ] AI actions show state, provenance, control, and recovery behavior.
- [ ] Accessibility was manually tested in addition to automated checks.
- [ ] The primary workflow does not depend on a product tour.
- [ ] Complex work is not trapped inside nested or oversized dialogs.
- [ ] Toasts are not the sole record of important results.
- [ ] Authentication and sensitive-data behavior were reviewed.
- [ ] Long content, localization, zoom, and narrow viewports were tested.
- [ ] AI features produce task artifacts rather than only chat messages.
- [ ] Mock data and unsupported capabilities are clearly identified.
- [ ] Familiar conventions were changed only with documented user benefit.
```

---


# 20. Automated enforcement

Automation SHOULD detect regressions, not attempt to replace design judgment.

## 20.1 Required automated checks

Projects SHOULD implement applicable checks for:

- WCAG issues with axe or equivalent;
- semantic HTML and invalid ARIA;
- keyboard reachability in critical paths;
- design-token usage;
- raw color and spacing values outside allowed exceptions;
- excessive component nesting;
- nested interactive controls;
- excessive card depth;
- missing component states in Storybook or equivalent;
- reduced-motion behavior;
- visual regression;
- responsive overflow;
- bundle size;
- Core Web Vitals or platform performance budgets;
- unsafe HTML rendering;
- secret exposure;
- sensitive data in client logs;
- dependency and content-security-policy regressions.

## 20.2 Pattern linting

A project MAY add AST or style lint rules for local anti-patterns, such as:

- more than one `Card` ancestor;
- direct use of deprecated generic layout components;
- unapproved gradients;
- hard-coded status colors;
- icon-only controls without accessible names;
- toast calls for blocking errors;
- custom clickable `div` elements;
- unbounded animation loops;
- raw mock metrics in production bundles.

Pattern linting MUST be project-specific. It MUST NOT ban a library, font, color, or component globally without an explicit project rule.

## 20.3 State-story coverage

Each major component SHOULD have reproducible stories or fixtures for:

- default;
- loading;
- empty;
- partial;
- error;
- permission denied;
- stale;
- long content;
- localization stress;
- keyboard focus;
- reduced motion;
- high contrast where supported.

State coverage is more valuable than a single polished happy-path screenshot.

## 20.4 Visual regression

Visual regression tests SHOULD cover:

- primary desktop viewport;
- compact viewport;
- large text;
- long labels;
- empty data;
- error banners;
- opened menus and dialogs;
- focus states;
- dense data;
- reduced-motion snapshot where relevant.

A visual diff MUST NOT be treated as proof of usability.

## 20.5 Experimental genericity detection

Screenshot similarity, component-frequency analysis, and “UI uniqueness” classifiers MAY be used as review signals.

They MUST NOT be release gates because:

- visual similarity may reflect a correct convention;
- novelty metrics can reward unusable interfaces;
- image models may miss interaction and accessibility quality;
- a distinctive visual surface can still have generic information architecture.

---

# 21. Product and review metrics

Measure whether the interface improves work, not whether it merely looks distinctive.

## 21.1 Primary outcome metrics

Use applicable metrics:

- task success rate;
- time on task;
- decision latency;
- error rate;
- recovery success;
- abandonment;
- repeated backtracking;
- support requests;
- discoverability of primary actions;
- alert acknowledgement quality;
- missed-critical-event rate;
- approval reversal rate;
- automation cancellation rate;
- partial-success recovery;
- accessibility defect escape rate;
- performance on target hardware.

## 21.2 Distinctiveness diagnostics

Distinctiveness MAY be reviewed through:

- logo-removal test;
- product-name substitution test;
- domain-component ratio;
- percentage of first-viewport elements tied to real user state;
- number of unexplained generic-pattern exceptions;
- repeated visual treatment count;
- percentage of copy using domain nouns and verbs.

These are diagnostics, not product-success metrics.

## 21.3 Avoid vanity metrics

Do not optimize the interface primarily for:

- number of cards;
- number of animations;
- dashboard density;
- time spent in product;
- raw clicks;
- AI messages sent;
- generated tokens;
- number of surfaced metrics;
- design-system component reuse percentage.

A lower interaction count may be better when the task is completed correctly.

## 21.4 Evaluation protocol

For major workflows, define:

```yaml
evaluation:
  task: ""
  participant_profile: ""
  success_condition: ""
  error_conditions: []
  baseline: ""
  target: ""
  accessibility_modes: []
  instrumentation: []
  review_interval: ""
```

---
# 22. Generic-interface detection score

Review each statement. Add the assigned points when true.

| Signal | Points |
|---|---:|
| Left sidebar, top bar, and card grid appear without task rationale | 3 |
| Four KPI cards occupy the first row | 3 |
| Purple, blue, cyan, or beige palette was chosen by default | 2 |
| Most content is inside rounded cards | 3 |
| Inter or default sans was selected without evaluation | 1 |
| Hero says “Welcome back” or uses motivational copy | 2 |
| Decorative particles, glow, blobs, or grid background | 2 |
| Chat is the only substantial interaction | 3 |
| Charts have no named decision or action | 3 |
| Fake terminal, metrics, hexadecimal strings, or telemetry | 4 |
| Same loading spinner for all operations | 1 |
| Missing empty, stale, permission, or failure states | 4 |
| Hover animation exists without keyboard equivalent | 3 |
| Mobile implementation only stacks all desktop panels | 2 |
| Component-library demo layout remains recognizable | 3 |
| Product name could be replaced without changing the interface | 5 |
| Centered hero plus two CTAs and floating screenshot appears without brand rationale | 2 |
| Three equal feature columns appear without peer-comparison need | 2 |
| Complex workflow is placed inside a modal | 3 |
| Wizard is used for a short or revisable form | 2 |
| Critical result exists only in a toast | 4 |
| Infinite feed has no grouping, filtering, or stable navigation | 3 |
| Product tour is required to understand primary navigation | 3 |
| AI controls use sparkle/magic language instead of action labels | 2 |
| Model selector is exposed without user need | 1 |
| Authentication flow blocks password-manager paste or lacks recovery design | 4 |
| Fake social proof, telemetry, compliance, or security claims appear | 6 |
| Distinctive styling reduces conventional control clarity | 4 |

### Interpretation

- **0–5:** low genericity risk;
- **6–12:** targeted review required;
- **13–20:** redesign major sections or document strong exceptions;
- **21–30:** reject the composition pending redesign;
- **31+:** likely template-derived or unsafe implementation.

A high score is not reduced by adding unusual decoration. The remedy is stronger task, domain, state, and interaction design.

This score is a review aid, not a substitute for design judgment.

---

# 23. Exception process

A prohibited pattern MAY be used when all conditions are met:

1. it directly supports the primary task;
2. a simpler or more domain-specific alternative was considered;
3. accessibility is not reduced;
4. the rationale is documented;
5. the implementation does not combine several generic defaults into an interchangeable template.

Exception record:

```yaml
exception:
  pattern: ""
  screen: ""
  user_need: ""
  alternatives_considered: []
  reason_selected: ""
  accessibility_impact: ""
  reviewer: ""
  review_date: ""
```

---

# 24. Definition of done

A frontend is complete only when:

- it communicates product identity without relying on logo or title;
- its main structure follows the user's task rather than a template;
- domain objects and transitions are represented clearly;
- every important state is implemented;
- AI actions are traceable and controllable;
- the interface remains usable without animation, hover, color, or mouse;
- responsive behavior preserves useful workflows;
- charts and metrics support decisions;
- no decorative technical content is presented as functional;
- the implementation passes the pull-request quality gate;
- any generic-pattern exceptions are documented.

---

# 25. Research basis

## 25.1 Research conclusion

Unconstrained UI-generating models frequently fall back to high-frequency patterns from training data and framework examples. The recurring result is often functional but interchangeable:

- generic SaaS shells;
- equal card grids;
- default dashboard composition;
- centered hero sections;
- common typography without semantic roles;
- fashionable gradients and glass effects;
- chat-first AI interaction;
- incomplete non-happy-path states;
- weak accessibility and recovery behavior.

This specification treats those observations as a prompt for stronger task definition, not as proof that every common pattern is harmful.

## 25.2 Evidence hierarchy

Normative decisions SHOULD prioritize sources in this order:

1. accessibility, security, legal, and platform standards;
2. peer-reviewed or reproducible empirical research;
3. mature public design systems with documented rationale;
4. product telemetry and user research;
5. expert heuristics;
6. trend and industry commentary;
7. project aesthetic preference.

Trend articles and community posts MAY identify recurring aesthetics. They MUST NOT alone justify universal accessibility or usability claims.

## 25.3 Standards and authoritative guidance

1. **W3C — Web Content Accessibility Guidelines (WCAG) 2.2**  
   https://www.w3.org/TR/WCAG22/

2. **W3C WAI — What’s New in WCAG 2.2**  
   https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/

3. **W3C WAI — ARIA Authoring Practices Guide**  
   https://www.w3.org/WAI/ARIA/apg/

4. **WebAIM — The WebAIM Million 2026**  
   https://webaim.org/projects/million/

5. **Material Design 3 — Applying transitions**  
   https://m3.material.io/styles/motion/transitions/applying-transitions

6. **Carbon Design System — Empty states**  
   https://v10.carbondesignsystem.com/patterns/empty-states-pattern/

7. **Carbon Design System — Loading**  
   https://v10.carbondesignsystem.com/patterns/loading-pattern/

8. **Carbon Design System — Status indicators**  
   https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/

9. **GOV.UK Design System — Error message**  
   https://design-system.service.gov.uk/components/error-message/

10. **Nielsen Norman Group — Ten Usability Heuristics**  
    https://www.nngroup.com/articles/ten-usability-heuristics/

11. **OWASP — Application Security Verification Standard**  
    https://owasp.org/www-project-application-security-verification-standard/

12. **OWASP — Authentication Cheat Sheet**  
    https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

## 25.4 Research and analytical references

13. **Dashboard Design Patterns — systematic review of 144 dashboards**  
    https://arxiv.org/abs/2205.00757

14. **OpenAI Developers — Designing delightful frontends with GPT-5.4**  
    https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5.4

15. **Cerebras — Generating Beautiful UIs**  
    https://www.cerebras.ai/blog/generating-beautiful-uis

## 25.5 Industry and cultural observations

The following are useful for identifying contemporary aesthetic repetition but are not normative standards:

16. **The New Yorker — The A.I.-Design Aesthetic That’s Taking Over the Internet**  
    https://www.newyorker.com/the-ai-design-aesthetic-thats-taking-over-the-internet

17. **Creative Bloq — Texture, warmth and tactile rebellion: graphic design trends for 2026**  
    https://www.creativebloq.com/design/graphic-design/texture-warmth-and-tactile-rebellion-the-big-graphic-design-trends-for-2026

18. **DEV Community — Stop Your AI Coding Tool from Generating Generic UI**  
    https://dev.to/_46ea277e677b888e0cd13/stop-your-ai-coding-tool-from-generating-generic-ui-impeccable-design-skill-4g1l

19. **Business Insider — AI-coded website comparison**  
    https://www.businessinsider.com/base44-first-llm-base-1-ai-coded-website-comparison-anthropic-2026-7

## 25.6 Research-derived cautions

The source review produced these cautions:

- Accessibility prevalence data describes the web ecosystem; it does not prove that every AI-generated interface has the same defects.
- Aesthetic repetition can be observed, but “uniqueness” is not a substitute for usability.
- A common font or layout is not inherently inaccessible or low quality.
- A polished visual style can still contain weak information architecture.
- A handcrafted or asymmetric style can still be inaccessible and confusing.
- Automated audits detect only part of WCAG conformance.
- Genericity is best assessed through composition, task fit, domain specificity, state coverage, and user outcomes together.

---

## 25.7 Version 2 research changes

Version 2 adds or strengthens:

- distinction between conventions and templates;
- evidence classification;
- generic-pattern combination rule;
- centered hero and feature-grid constraints;
- sidebar, modal, wizard, table, carousel, feed, tour, toast, loading, empty-state, search, authentication, FAQ, footer, and responsive rules;
- AI-specific trope controls;
- task-to-interface matrix;
- rarely generated expert patterns;
- expanded state model;
- native-semantics guidance;
- streaming-output accessibility;
- security, privacy, consent, and audit behavior;
- automated enforcement;
- product outcome metrics;
- corrected research overclaims.

---

# 26. Project declaration

Complete this section when adopting the specification:

```yaml
project:
  name: ""
  product_domain: ""
  primary_users: []
  primary_interface_archetype: ""
  secondary_archetypes: []
  visual_metaphor: ""
  domain_objects: []
  domain_specific_components: []
  prohibited_project_patterns: []
  approved_exceptions: []
  evidence_policy: ""
  security_model: ""
  privacy_model: ""
  evaluation_metrics: []
  automated_quality_gates: []
  accessibility_target: "WCAG 2.2 AA"
  supported_inputs:
    - keyboard
    - pointer
    - touch
  supported_viewports: []
  design_owner: ""
  engineering_owner: ""
```
