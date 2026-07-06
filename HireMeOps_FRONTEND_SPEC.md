# HireMeOps — Frontend Page Specification

## 1. Frontend Direction

Style:

```txt
Minimal
Professional
Dark/light themes
Anime.js, GSAP, Three.js, Chart.js effects
No bloated game UI
Reduced effects mode for low-end machines
```

Frontend stack:

```txt
React
Vite
TypeScript
Tauri API
State store: Zustand or TanStack Store
Data fetching: Tauri commands + local query cache
Charts: Chart.js
Effects: GSAP/anime.js
Background/3D accents: Three.js, disabled in reduced effects mode
```

UX priority:

```txt
Fast dashboard
Clear automation status
Immediate stop button
Transparent decisions
No hidden automation
```

---

## 2. MVP Pages

HireMeOps MVP should have 10 frontend pages:

```txt
1. Dashboard
2. Profiles
3. CV Library
4. CV Analysis
5. Profile Variants
6. Job Preferences
7. Job Search
8. Applications Queue
9. Automation Cockpit
10. Settings & Logs
```

---

## 3. Global Layout

### 3.1 Shell

```txt
Left sidebar
Top command bar
Main content
Right live-event drawer, optional
Global emergency stop
```

### 3.2 Sidebar items

```txt
Dashboard
Profiles
CV Library
CV Analysis
Profile Variants
Job Preferences
Job Search
Applications
Automation
Settings & Logs
```

### 3.3 Top command bar

Shows:

```txt
Active profile
Active variant
Active browser session
Automation state
LinkedIn session status
Theme toggle
Reduced effects indicator
Emergency Stop
```

Emergency stop must be visible globally.

---

## 4. Page 1 — Dashboard

Purpose:

```txt
Command center for job automation state, results, charts, and warnings.
```

Widgets:

```txt
Active Profile
Browser Session Status
Automation Status
Applications Today
Jobs Discovered
Needs Review
Duplicate URL Skips
Failed Applications
```

Charts:

```txt
Applications/day
Match score distribution
Platform success rate
Failure reasons
```

Primary actions:

```txt
Start automation
Pause automation
Emergency stop
Open needs-review queue
Open latest failure evidence
```

Live event feed:

```txt
Job found
Match scored
CV selected
Application submitted
Retry scheduled
Captcha/manual handoff
Duplicate skipped
Error captured
```

Performance:

```txt
Use compact summary queries.
Charts load asynchronously.
Virtualize event feed if long.
```

---

## 5. Page 2 — Profiles

Purpose:

```txt
Manage multiple job-seeking profiles/personas.
```

Sections:

```txt
Profile list
Profile editor
Profile facts
Links
Work authorization
Salary expectations
Language levels
Browser session binding
Delete profile
```

Profile facts editor:

```txt
Salary minimum
Salary currency
Salary period
Brazil work authorization
EU work authorization
Visa sponsorship requirements
Available start date
Relocation preference
English level
```

Rules:

```txt
Salary facts are per profile.
Work authorization facts are per profile.
Application URL locks are per profile.
Each profile has its own browser profile folder.
```

Delete profile:

```txt
Hard delete profile row.
Delete related database rows.
Delete copied CV files.
Delete evidence files.
Delete browser profile folder.
```

---

## 6. Page 3 — CV Library

Purpose:

```txt
Manage PDF/DOCX files, previews, active CVs, and fallback storage.
```

Features:

```txt
Upload PDF
Upload DOCX
Copy file into app storage
File hash display
Preview PDF on hover/focus
Zoom viewer
DOCX text preview
Multiple active CV badges
Assign CV to role variants
Re-parse
Re-analyze
Delete CV
```

CV card content:

```txt
File name
File type
Created date
File hash short
Assigned variants
Active status
Last parsed date
Last analysis score
```

Hover/focus preview:

```txt
Small PDF preview panel
Zoom on focus
Keyboard accessible
Reduced motion compatible
```

Important:

```txt
Raw CV text is not permanently stored.
When analysis/matching needs text, backend re-parses the copied file.
```

### 6.1 CV Library preview mode

The CV Library must behave like a document library, not a plain upload list.

Primary layout:

```txt
Top bar:
- Upload PDF
- Upload DOCX
- Import manual profile
- Search CVs
- Filter by profile/variant/status

Main grid:
- CV cards with first-page preview thumbnails
- Active CV badges
- Assigned role variant badges
- Last analysis score
- Last used date

Right inspector:
- Metadata
- Assigned variants
- Match usage
- Actions
```

CV card preview behavior:

```txt
- Every PDF card shows a cached preview of page 1.
- Hover/focus enlarges the page-1 preview in a floating preview panel.
- Keyboard focus must trigger the same preview behavior as mouse hover.
- Preview panel supports quick zoom in/out.
- Preview rendering must be lazy-loaded and cached.
- Broken preview must fallback to file icon + metadata.
```

CV open behavior:

```txt
Click card or press Enter:
- Open CV Viewer as a full-page route or large modal.
- Allow reading and navigating the full PDF/CV.
- Keep the sidebar and emergency stop available.
- Do not expose raw local file paths in the frontend.
```

CV Viewer requirements:

```txt
Toolbar:
- Back to library
- File name
- Current page / total pages
- Previous page
- Next page
- Zoom out
- Zoom in
- Fit width
- Fit page
- Search text
- Open metadata panel

Left rail:
- Page thumbnails
- Lazy-rendered thumbnails
- Current page highlight

Main viewer:
- PDF page renderer
- Smooth scroll between pages
- Keyboard navigation
- Ctrl/Cmd + wheel zoom
- Loading skeletons
- Error state

Right panel:
- CV metadata
- Active profiles/variants
- Analysis score
- Extracted sections
- Actions: set active, assign variant, re-parse, re-analyze, delete
```

Keyboard shortcuts:

```txt
Enter: open selected CV
Esc: close preview/modal
ArrowLeft/PageUp: previous page
ArrowRight/PageDown: next page
Ctrl/Cmd + +: zoom in
Ctrl/Cmd + -: zoom out
Ctrl/Cmd + F: search inside CV
```

PDF implementation guidance:

```txt
- Use pdfjs-dist for frontend PDF rendering.
- Use a Tauri command or custom asset protocol to stream copied CV files safely.
- Generate and cache page-1 thumbnails under the profile CV preview folder.
- Do not parse/render every page upfront.
- Render visible pages only.
- Store thumbnail path in cv_documents.preview_path.
```

DOCX behavior:

```txt
- DOCX cards should still appear in the same library grid.
- If a PDF preview is unavailable, show extracted text preview or generated document preview.
- Opening DOCX uses a normalized CV Viewer mode with extracted sections first.
- Later improvement: generate PDF preview from DOCX in the backend.
```

Performance constraints:

```txt
- Do not render all CV previews at once.
- Use intersection observer / virtualization for large CV libraries.
- Cache first-page thumbnails after first render.
- Clear unused preview cache from Settings.
- Respect reduced effects mode.
```

Accessibility:

```txt
- All CV cards are keyboard focusable.
- Hover preview must also work on focus.
- Viewer controls require labels/tooltips.
- Preview zoom must not trap focus.
```


---

## 7. Page 4 — CV Analysis

Purpose:

```txt
Analyze CV quality, match potential, missing keywords, and whether optimization is needed.
```

Sections:

```txt
CV selector
Variant selector
Analysis score
Optimization needed/not needed
Strengths
Weaknesses
Missing keywords
Recommended changes
Role compatibility
AI provider used
Analysis history
```

Actions:

```txt
Run analysis
Compare analyses
Generate optimization suggestions
Accept suggestion into profile variant
Export analysis JSON
```

Rules:

```txt
Only generate optimizations when analysis says needed.
Keep analysis reports.
Do not overwrite CV files automatically.
```

---

## 8. Page 5 — Profile Variants

Purpose:

```txt
Generate and manage role-specific profile versions.
```

Examples:

```txt
Java Backend Developer
Fullstack Developer
Rust Developer
Cybersecurity Analyst
DevOps Junior
```

Variant editor tabs:

```txt
Headline
Summary
Keywords
Preferred CV
Skills order
Projects priority
Experience bullets
```

Actions:

```txt
Create variant
Duplicate variant
Generate from CV
Assign preferred CV
Analyze variant against job
Delete variant
```

Rules:

```txt
Multiple variants per profile.
Preferred CV can be set, but auto-application still selects highest-match CV.
```

---

## 9. Page 6 — Job Preferences

Purpose:

```txt
Control job matching, auto-apply, auto-submit, and filtering.
```

Sections:

```txt
Target roles
Seniority
Locations
Remote modes
Minimum salary
Required skills
Preferred skills
Excluded keywords
Blocked companies
Auto-submit rules
Retry rules
Search query/dork templates
```

Locked defaults:

```txt
Auto-submit minimum score: 60%
Needs-review confidence threshold: 50%
Retry failed transient applications: yes
Retry limit: 10
Daily application limit: none
Daily connection limit: none
```

Rule builder example:

```txt
Auto-submit when:
- Match score >= 60
- Not duplicate URL for this profile
- No captcha/manual check active
- Required profile facts exist
- Generated form answers have confidence >= 50
```

---

## 10. Page 7 — Job Search

Purpose:

```txt
Search LinkedIn and Google dorks through browser automation, store jobs, and score them.
```

Layout:

```txt
Left: search filters and saved queries
Center: job list
Right: selected job details and match explanation
Bottom: live search progress
```

Job card fields:

```txt
Title
Company
Location
Remote mode
Platform
Source query
Posted date
Discovered date
Match score
Duplicate URL warning
Status
```

Statuses:

```txt
discovered
matched
rejected
queued
applied
failed
needs_review
saved
ignored
skipped_duplicate_url
```

Actions:

```txt
Run LinkedIn search
Run Google dork search
Score selected jobs
Queue selected jobs
Skip selected jobs
Open source URL
```

Duplicate behavior:

```txt
Show duplicate warning.
Do not merge duplicate jobs.
Application queue checks URL lock before submitting.
```

---

## 11. Page 8 — Applications Queue

Purpose:

```txt
Manage drafts, generated answers, selected CV, auto-submit status, retries, and results.
```

Sections:

```txt
Queued applications
Needs-review applications
Submitted applications
Failed applications
Skipped duplicates
Application detail drawer
```

Application detail:

```txt
Job
Company
Platform
Selected CV
Selected variant
Match score
Generated answers
Cover letter, only if required
Salary answer
Work authorization answers
Retry attempt count
Latest evidence
```

Actions:

```txt
Approve needs-review
Edit answer
Retry now
Cancel
Open evidence
Export application CSV
```

Rules:

```txt
Cover letter generated only when required.
Salary answered from profile minimum value.
Work authorization answered from saved Brazil/EU facts.
Form-answer confidence below 50% goes to needs-review.
```

---

## 12. Page 9 — Automation Cockpit

Purpose:

```txt
Live control room for automation execution.
```

Sections:

```txt
Current state
Current task
Browser session
Queue
Retry queue
Needs-review panel
Captcha/manual handoff panel
Evidence viewer
Live logs
Controls
```

Controls:

```txt
Start
Pause
Resume
Stop
Emergency Stop
Run once
Dry run
Clear completed
Clear failed
```

Automation states:

```txt
Queued
PreparingBrowser
CheckingSession
Searching
ExtractingJob
ScoringJob
SelectingCV
GeneratingAnswers
FillingForm
Submitting
VerifyingSubmission
Completed
NeedsReview
PausedForCaptcha
PausedByUser
SkippedDuplicateUrl
RetryScheduled
Failed
Stopped
```

Captcha/manual handoff:

```txt
Pause automation.
Show browser.
User solves manually.
User clicks Resume.
Automation continues.
```

Evidence viewer:

```txt
Screenshots
DOM snapshots as raw DOM/text
Console logs
Network errors
Form state
```

---

## 13. Page 10 — Settings & Logs

Purpose:

```txt
Settings, logs, cleanup, data export, backup/restore, AI providers, browser settings.
```

Tabs:

```txt
General
Theme & Effects
AI Providers
Browser
Data Storage
Exports
Backups
Cleanup
Audit Logs
Automation Evidence
```

General:

```txt
Active profile
App language
Startup behavior
Portable mode toggle
```

Theme & Effects:

```txt
Dark
Light
System
Reduced effects: on/off/auto
```

AI Providers:

```txt
OpenAI-compatible endpoint
Anthropic-compatible endpoint
Ollama/local endpoint
Custom proxy endpoint
API key storage
Default model
Test provider
```

Browser:

```txt
Engine: Playwright Chromium
Browser profile folder per HireMeOps profile
LinkedIn session health
Manual login setup
Clear session
```

Data Storage:

```txt
Database location
Database size
Profiles count
Jobs count
Applications count
Open data folder
```

Exports:

```txt
Export profile JSON
Export jobs CSV
Export applications CSV
Export audit CSV
```

Backups:

```txt
Create database-only backup
Restore database backup
Backup history
```

Cleanup:

```txt
Clear AI cache
Clear old audit logs
Clear old evidence
Clear old screenshots
Clear old DOM snapshots
Clear unused artifacts
Factory reset
```

Retention defaults:

```txt
Audit logs: 30 days
Automation evidence: 1 day
AI cache: manual clear
Application artifacts: manual clear
```

---

## 14. Frontend State Stores

Recommended stores:

```txt
useProfileStore
useEventStore
useAutomationStore
useSettingsStore
useThemeStore
useJobFiltersStore
```

Rules:

```txt
Do not duplicate backend entities across many stores.
Use stores for UI/session state.
Use backend queries for persisted data.
One event store consumes all live events.
```

---

## 15. Event Consumption

Frontend should have one app-level event bridge:

```ts
export function startEventBridge() {
  // Tauri event subscription now.
  // SSE-compatible adapter later.
}
```

Responsibilities:

```txt
Append live events.
Update automation status.
Update dashboard counters optimistically.
Show toasts for critical events.
Send non-critical logs to live drawer.
```

Critical event toasts:

```txt
automation.paused_for_captcha
automation.stopped
application.failed
application.needs_review
session.expired
```

---

## 16. Effects Guidelines

Use effects only where they help status clarity.

Good uses:

```txt
Dashboard background particles, very subtle
Automation state transitions
Queue item movement
Chart entrance animations
CV preview zoom
Status pulse for running automation
```

Avoid:

```txt
Heavy 3D scenes on every page
Animations that block interaction
Excessive glow/neon
Game-like clutter
Animations in large tables
```

Reduced effects mode:

```txt
Disable Three.js background.
Disable non-essential GSAP/anime animations.
Keep simple opacity/transform transitions.
Disable particle effects.
Keep charts static or low-animation.
```

---

## 17. Component Inventory

```txt
AppShell
Sidebar
TopCommandBar
EmergencyStopButton
ProfileSwitcher
BrowserSessionBadge
AutomationStatusBadge
LiveEventDrawer
KpiCard
ChartCard
JobCard
JobDetailPanel
MatchScoreBadge
DuplicateUrlWarning
CvCard
CvPreviewPopover
PdfZoomViewer
VariantEditor
RuleBuilder
ApplicationQueueTable
EvidenceViewer
DomSnapshotViewer
AiProviderForm
DataCleanupPanel
BackupRestorePanel
```

---

## 18. Accessibility

Required:

```txt
Keyboard navigation
Visible focus states
Reduced motion support
High contrast dark/light themes
Screen-reader labels on automation controls
Confirm destructive actions
Emergency stop accessible by keyboard shortcut
```

Suggested shortcut:

```txt
Ctrl/Cmd + Shift + S = Emergency Stop
```

---

## 19. Frontend Build Order

### Phase 1

```txt
AppShell
Routing
Theme system
Reduced effects mode
Event bridge mock
Dashboard skeleton
```

### Phase 2

```txt
Profiles page
Profile facts editor
CV Library page
CV preview components
```

### Phase 3

```txt
CV Analysis
Profile Variants
Job Preferences
```

### Phase 4

```txt
Job Search
Applications Queue
Automation Cockpit
Live events
Evidence viewer
```

### Phase 5

```txt
Settings & Logs
AI provider setup
Export/backup/cleanup UI
Portable mode UI
```
