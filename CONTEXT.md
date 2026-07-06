# CONTEXT — HireMeOps

Generated from the HireMeOps planning/interview conversation.

> Purpose: give another agent/developer a deep, single-file context snapshot of the product vision, design decisions, database decisions, frontend scope, backend architecture, safety boundaries, and generated project artifacts.

---

## 0. Quick Identity

```txt
Project name: HireMeOps
Product type: local-first desktop job automation cockpit
Stack direction: Rust + Tauri 2 + React/Vite + SQLite + Playwright Chromium sidecar
User style preference: concise, technical, problem-solving oriented
Engineering principles: SSE/event streaming, performance, YAGNI, KISS, DRY, SOLID
Target OS: Windows, Linux, macOS from day one
```

---

## 1. Source Images Uploaded in the Conversation

The user attached six UI inspiration images. They were treated as visual direction for a minimal dashboard with good effects, not as strict copies.

- Image 1: `3362ffb7-2c73-4bed-b8a8-88dc5a476c44(1).png`
- Image 2: `3e0f4f73-8878-49c7-87e3-ff3dcf281ede(1).png`
- Image 3: `3959a78f-cf3c-40fa-83d0-bdc1ad83b85f(1).png`
- Image 4: `5dfa614a-ceee-45d2-b9a8-64999fca29a7(1).png`
- Image 5: `2a136c92-3219-469d-93f2-6d30cc385cc6(1).png`
- Image 6: `1ad29b27-b595-4732-b55a-149cdb0665e8(1).png`

Visual direction derived from the images:

```txt
Minimal interface
Good micro-interactions
anime.js / GSAP effects
Three.js background or subtle scene elements
Chart.js analytics cards
Dark and light themes
Professional dashboard, not overbuilt game UI
```

---

## 2. Original Product Request

The user wanted to start a Rust app/framework where the user uploads their CV first, then the app auto-integrates career-platform features:

```txt
- Upload CV as the starting point.
- Auto-place LinkedIn skills.
- Auto-place projects.
- Auto-place experience.
- Auto-apply on LinkedIn and other websites like Indeed, Catho, etc.
- Auto-connect with people in the user's area.
- Auto-search Google for updated places/jobs.
- Proceed step by step through interview questions.
```

Initial framing from the assistant:

```txt
CV -> structured profile -> job criteria -> job discovery -> match scoring -> application generation -> controlled automation -> tracking
```

Important safety boundary introduced early:

```txt
The app can fill forms, draft content, rank jobs, and prepare/apply where allowed, but should not bypass captchas, evade bot checks, spam people, or send messages without approval.
```

---

## 3. Interview Round 1 — User Answers

```txt
1. Target user:
   Every people that want jobs.

2. First platform:
   LinkedIn.

3. Main mode:
   C — fully automated.

4. CV input:
   PDF and DOCX, plus manual form as optional input.

5. Profile output:
   Everything proposed:
   - Skills
   - Projects
   - Experiences
   - Education
   - Certifications
   - Languages
   - Keywords
   - Cover letter snippets
   - LinkedIn About section

6. Job matching criteria:
   Criteria must be set up by the user. Automatic option checks the updated CV and makes criteria automatically.

7. Auto-connect behavior:
   Auto-connect with recruiters and people whose experience matches.

8. What not to touch:
   Never send messages to people.

9. Data storage:
   Local only for safety.
```

Resulting product shape:

```txt
Local-first job automation cockpit, not only an auto-apply bot.
```

---

## 4. First Frontend/Page Design Proposal

Full product page set proposed initially:

```txt
1. Onboarding
2. CV Import
3. Profile Builder
4. Job Preferences
5. Platform Connections
6. Job Discovery
7. Job Match Review
8. Application Studio
9. Automation Cockpit
10. Network Builder
11. Activity, Logs & Settings
```

MVP reduced proposal at that stage:

```txt
1. Onboarding
2. Profile / CV Import
3. Job Preferences
4. LinkedIn Jobs
5. Applications Queue
6. Automation Logs / Settings
```

Early architecture direction:

```txt
jobops/
├─ src/                         # React frontend
│  ├─ app/
│  ├─ pages/
│  ├─ components/
│  ├─ features/
│  │  ├─ onboarding/
│  │  ├─ cv-import/
│  │  ├─ profile/
│  │  ├─ preferences/
│  │  ├─ jobs/
│  │  ├─ applications/
│  │  ├─ automation/
│  │  └─ settings/
│  └─ lib/
│
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ commands/
│  │  ├─ cv/
│  │  ├─ profile/
│  │  ├─ jobs/
│  │  ├─ matching/
│  │  ├─ applications/
│  │  ├─ automation/
│  │  ├─ platforms/
│  │  │  └─ linkedin/
│  │  ├─ browser/
│  │  ├─ storage/
│  │  ├─ security/
│  │  └─ logging/
│  └─ tauri.conf.json
│
├─ migrations/
├─ AGENTS.md
├─ README.md
└─ docs/
```

Core entities identified:

```txt
CandidateProfile
ProfileVariant
JobPreference
PlatformAccount
JobPost
JobMatch
ApplicationDraft
ApplicationRun
ConnectionTarget
AutomationTask
AuditLog
```

---

## 5. Interview Round 2 — User Answers

```txt
1. App name:
   HireMeOps

2. UI style:
   Minimal with good effects from anime.js, three.js, GSAP, chart.js.

3. First OS:
   Windows, Linux and macOS.

4. Automation engine:
   Embedded browser inside Tauri; assistant was asked to research a good option for Tauri.

5. Application behavior:
   Auto-submit and auto-fill.

6. CV optimization:
   Only generate optimizations if needed, after analysis/review of CV and match.

7. AI model:
   Both local and API; allow user to add endpoint as proxy.

8. Google search:
   Job pages using dorking with quoted terms, AND, OR, site:, etc.

9. Daily limits:
   No limits, max possible.

10. Data model:
   Multiple profiles.
```

Assistant research conclusion:

```txt
Do not make the Tauri embedded WebView the main automation browser.
Use Tauri WebView for HireMeOps UI only.
Use Playwright Chromium sidecar + persistent profile for automation.
```

Reasoning captured:

```txt
Tauri WebView engines differ by OS:
- Windows: WebView2
- macOS: WKWebView
- Linux: WebKitGTK

This is good for UI, weak for stable cross-platform automation. Playwright persistent browser contexts are better for sessions and automation.
```

---

## 6. Database Interview — User Answers

```txt
1. CV files:
   Copy into HireMeOps app storage. Need fallback. Frontend CV menu should display PDFs on hover/focus and allow zoom.

2. Raw CV text:
   Re-parse when needed; do not store permanently.

3. Generated cover letters/form answers:
   Store them. Add setting to clear cache and unused stuff.

4. Failed automation screenshots:
   Save them.

5. Screenshot encryption:
   No need since local.

6. Job descriptions:
   Store full description, summary, name, company, etc.

7. Duplicate jobs from different searches:
   Do not merge.

8. One job supporting multiple applications from different profiles:
   Yes.

9. Separate LinkedIn/browser sessions per profile:
   Yes.

10. API key storage:
   Can encrypt with Argon2id if needed.
   Correction: Argon2id derives a key; encryption should use AES-256-GCM or ChaCha20-Poly1305.

11. Full DB backup/restore:
   Yes.

12. Delete everything about profile button:
   Yes.

13. Audit log retention:
   Auto-delete after N days; later set to 30 days.

14. Automation logs:
   Include both DOM snapshots and screenshots.

15. Google dork results cache:
   No.

16. Job match recalculation when CV changes:
   Yes.

17. Preserve old match scores:
   Yes.

18. Deleted jobs:
   Hard-delete.

19. Team/multi-user later:
   Single-device only.

20. Portable mode:
   Yes; DB can live beside executable.
```

Additional user requirement saved as project principle:

```txt
Frontend and backend must use SSE/good event streaming, good performance, YAGNI, KISS, DRY, SOLID.
```

---

## 7. Retention / Automation / Schema Interview — User Answers

```txt
1. Audit logs:
   Auto-delete after 30 days.

2. Automation evidence:
   Keep for 1 day.

3. CV versioning:
   Multiple active CVs.

4. Profile variants:
   Yes.

5. Auto-submit:
   Apply to every platform eventually, but LinkedIn Easy Apply first.

6. Difficult forms:
   If AI is unsure, mark needs-review.

7. Salary questions:
   Auto-answer salary.

8. Legal/work authorization questions:
   Auto-answer.

9. Captchas/bot checks:
   User requested auto-solve. Final locked behavior: pause for manual solve, no bypass.

10. Browser profile:
   Each HireMeOps profile creates its own browser profile folder.

11. LinkedIn login:
   User logs in manually on first setup so the session can be saved.

12. AI cache:
   Yes.

13. Match recalculation:
   Recalculate everything.

14. Backups:
   Database only.

15. Portable mode:
   Toggable.

16. Theme:
   Dark and light themes.

17. Charts:
   Applications/day, match score distribution, platform success rate, failure reasons.

18. Search:
   Browser automation.

19. Job dedupe warning:
   Yes. It should stop automatically after applying once to the same URL.

20. First build target:
   Cross-platform from day one.
```

Critical correction locked:

```txt
Captcha/bot checks are not auto-solved. Automation pauses, displays the browser, user solves manually, then automation resumes.
```

---

## 8. Final Product-Gap Interview — User Answers

```txt
1. Application URL lock:
   Per profile.

2. Salary facts:
   Per profile.

3. Salary style:
   Value/minimum value configured by the user.

4. Work authorization v1:
   EU and Brazil.

5. CV selection:
   Highest match applies automatically.

6. Cover letters:
   Only when required.

7. Auto-submit threshold:
   60%.

8. Needs-review threshold:
   Below 50% confidence.

9. Failed applications:
   Retry automatically.

10. Retry limit:
   10 attempts.

11. Browser engine:
   Check best option and use it. Final direction: Playwright Chromium sidecar persistent profile.

12. AI provider:
   Allow offline/manual mode; AI provider not strictly required at onboarding.

13. Local model:
   Assistant to set up. Final direction: Ollama first local provider.

14. Proxy endpoint:
   Support both OpenAI-compatible `/v1/chat/completions` and Anthropic-compatible.

15. Manual form profile:
   Full LinkedIn-like editor.

16. Data export:
   JSON and CSV.

17. Evidence viewer:
   Leave DOM snapshots as DOM/raw content.

18. Portable mode:
   Move existing data automatically when toggled.

19. Theme:
   Reduced effects automatically on low-end machines.

20. Project artifacts:
   Create all artifacts:
   - implementation spec
   - database schema
   - frontend page spec
   - AGENTS.md
   - project index
```

---

## 9. Locked Technical Decisions

```txt
App: HireMeOps
Desktop framework: Tauri 2
Frontend: React/Vite
Backend: Rust
Database: local SQLite
Migrations: SQLx
Storage: SQLite + filesystem
Portable mode: supported and togglable; moves data automatically
Browser automation: Playwright Chromium sidecar + persistent browser profile
Embedded Tauri WebView: UI only, not primary automation engine
First platform: LinkedIn Easy Apply
Future platforms: Indeed, Catho, Gupy, InfoJobs, Google Jobs, company career pages
AI: OpenAI-compatible, Anthropic-compatible, Ollama/local, custom proxy, offline/manual mode
Events: internal Rust event bus + Tauri events; SSE-compatible abstraction for future API mode
```

---

## 10. Locked Product Rules

```txt
- Auto-fill: yes.
- Auto-submit: yes when match >= 60%.
- First auto-submit flow: LinkedIn Easy Apply.
- Duplicate jobs are stored separately.
- Duplicate application prevention is per profile by canonical URL lock.
- If a job URL has already been applied to for the same profile, automation skips it.
- Cover letters are generated only when required.
- Salary answers use minimum salary value configured per profile.
- Work authorization facts support Brazil + EU in v1.
- Difficult/low-confidence form questions become needs-review below 50%.
- Failed applications retry automatically up to 10 attempts.
- Recruiter/person connections are allowed without messages.
- Messages to people are never sent.
- Captcha/bot checks pause for manual user solve; no bypass.
```

---

## 11. Locked Data Retention Rules

```txt
Audit logs: 30 days
Automation evidence: 1 day
AI cache: enabled; user can clear manually
Google dork cache: disabled
Application artifacts: stored, with cleanup settings
Backups: database only
CV files: copied into app storage
Raw CV text: not stored permanently; re-parse as needed
Screenshots: saved locally, not encrypted
DOM snapshots: saved as DOM/raw content, deleted after retention
Deleted jobs: hard-deleted
Profile deletion: delete all related data
```

---

## 12. Locked Frontend Page Set

Final MVP/frontend page set after decisions:

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

Dashboard charts:

```txt
- Applications/day
- Match score distribution
- Platform success rate
- Failure reasons
```

CV Library must support:

```txt
- PDF/DOCX list
- copied CV storage
- hover/focus preview
- zoom viewer
- active CV badges
- multiple active CVs
- role variant links
- re-parse
- re-analyze
- delete CV
```

Automation Cockpit must support:

```txt
- Start / pause / stop
- Emergency stop
- Current browser task
- Queue
- Needs-review items
- Captcha/manual handoff panel
- Evidence viewer
- Live event stream
```

---

## 13. Locked Backend Module Direction

```txt
src-tauri/src/
├─ main.rs
├─ commands/
├─ events/
│  ├─ bus.rs
│  └─ types.rs
├─ storage/
│  ├─ db.rs
│  ├─ migrations.rs
│  ├─ repositories/
│  └─ encryption.rs
├─ profiles/
├─ cv/
│  ├─ import.rs
│  ├─ parser.rs
│  ├─ preview.rs
│  └─ analysis.rs
├─ jobs/
├─ matching/
├─ applications/
├─ automation/
│  ├─ queue.rs
│  ├─ runner.rs
│  ├─ evidence.rs
│  └─ stop_token.rs
├─ browser/
├─ platforms/
│  └─ linkedin/
├─ ai/
│  ├─ provider.rs
│  ├─ openai_compatible.rs
│  ├─ anthropic_compatible.rs
│  ├─ ollama.rs
│  └─ proxy.rs
└─ logging/
```

Traits/interfaces to keep SOLID:

```txt
BrowserEngine
PlatformAdapter
AiProvider
CvParser
JobMatcher
EvidenceStore
ApplicationSubmitter
```

---

## 14. Event/SSE Direction

Use long-running event streams for:

```txt
- CV parsing progress
- CV analysis progress
- job search progress
- match scoring progress
- application queue progress
- browser automation status
- logs
- error events
- dashboard counters
```

Event shape:

```ts
type AppEvent = {
  id: string
  type:
    | "cv.parse.progress"
    | "cv.analysis.done"
    | "job.search.item_found"
    | "job.match.done"
    | "application.started"
    | "application.failed"
    | "automation.paused"
    | "automation.evidence_saved"
    | "log"
  profileId?: string
  taskId?: string
  payload: unknown
  createdAt: string
}
```

Preferred desktop architecture:

```txt
Rust task runner -> event bus -> Tauri emit -> frontend store
```

Also keep SSE-compatible abstraction for a future local HTTP/API mode.

---

## 15. Browser Automation Research Notes

Sources used in the prior artifact generation:

```txt
Tauri architecture:
https://v2.tauri.app/concept/architecture/

Tauri WebView versions:
https://v2.tauri.app/reference/webview-versions/

Tauri sidecars:
https://v2.tauri.app/develop/sidecar/

Playwright persistent context:
https://playwright.dev/docs/api/class-browsertype

LinkedIn automated activity policy:
https://www.linkedin.com/help/linkedin/answer/a1340567

LinkedIn prohibited software policy:
https://www.linkedin.com/help/linkedin/answer/a1341387

SQLx:
https://github.com/launchbadge/sqlx

SQLx migrate macro:
https://docs.rs/sqlx/latest/sqlx/macro.migrate.html
```

Key conclusion:

```txt
Tauri WebView is for UI. Automation should use Playwright Chromium persistent context as a sidecar.
```

---

## 16. Safety / Compliance Boundaries

```txt
Allowed design behavior:
- User-owned browser profile.
- User logs into LinkedIn manually.
- Local browser automation with visible/manual handoff.
- Auto-fill and auto-submit where configured.
- Pause on uncertain forms.
- Pause on captcha/bot checks.
- No recruiter messages.
- Connections without notes/messages.
- Full audit log.
- Emergency stop.

Disallowed design behavior:
- Captcha/bot-check bypass.
- Stealth evasion.
- Mass spam messaging.
- Sending messages to people.
- Storing raw CV text permanently.
- Cloud sync/team features in v1.
```

---

## 17. Generated Project Files

The following files were generated before this CONTEXT export:

```txt
HireMeOps_IMPLEMENTATION_SPEC.md
HireMeOps_DATABASE_SCHEMA.md
HireMeOps_FRONTEND_SPEC.md
HireMeOps_AGENTS.md
HireMeOps_PROJECT_INDEX.md
HireMeOps_specs_md.zip
```

This `CONTEXT.md` embeds the content of the main generated Markdown files below as appendices.

---

# Appendices — Generated Artifacts



---

## Appendix: `HireMeOps_PROJECT_INDEX.md`

# HireMeOps — Project Artifact Index

This folder contains the first locked project specification set for HireMeOps.

## Files

```txt
HireMeOps_IMPLEMENTATION_SPEC.md
HireMeOps_DATABASE_SCHEMA.md
HireMeOps_FRONTEND_SPEC.md
HireMeOps_AGENTS.md
```

## Current Locked Decisions

```txt
App name: HireMeOps
UI: minimal, dark/light, anime.js/GSAP/Three.js/Chart.js effects
OS: Windows, Linux, macOS from day one
Storage: local SQLite + filesystem
Portable mode: togglable, moves data automatically
Profiles: multiple
CVs: multiple active CVs per profile
Browser sessions: one isolated browser profile per HireMeOps profile
Automation engine: Playwright Chromium persistent context sidecar
First platform: LinkedIn Easy Apply
Auto-fill: yes
Auto-submit: yes, threshold 60%
Needs-review threshold: form-answer confidence below 50%
Retry failures: yes, max 10 attempts
Duplicate jobs: stored separately
Duplicate application prevention: per-profile URL lock
Salary: minimum value configured per profile
Work authorization: Brazil + EU facts in v1
Cover letters: only when required
Google dorks: browser automation, no cache
AI: OpenAI-compatible, Anthropic-compatible, Ollama/local, custom proxy, offline/manual mode
AI cache: yes
Audit logs: 30 days
Automation evidence: 1 day
Backups: database only
Exports: JSON and CSV
Captcha/bot checks: pause for manual user solve, no bypass
Messages to people: never
```

## Build Order

```txt
1. Tauri shell, routing, theme, event bus, SQLite
2. Profiles, facts, CV Library, parser/preview
3. CV Analysis, variants, preferences
4. AI providers and cache
5. Job search, matching, duplicate warnings, URL locks
6. Playwright Chromium sidecar, sessions, LinkedIn Easy Apply
7. Automation queue, retries, evidence, emergency stop
8. Settings, exports, backup/restore, portable move
```

## Research References

```txt
Tauri architecture:
https://v2.tauri.app/concept/architecture/

Tauri WebView versions:
https://v2.tauri.app/reference/webview-versions/

Tauri sidecars:
https://v2.tauri.app/develop/sidecar/

Playwright persistent context:
https://playwright.dev/docs/api/class-browsertype

LinkedIn automated activity policy:
https://www.linkedin.com/help/linkedin/answer/a1340567

LinkedIn prohibited software policy:
https://www.linkedin.com/help/linkedin/answer/a1341387

SQLx:
https://github.com/launchbadge/sqlx

SQLx migrations:
https://docs.rs/sqlx/latest/sqlx/macro.migrate.html

OWASP Password Storage Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

OWASP Cryptographic Storage Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

Ollama OpenAI compatibility:
https://docs.ollama.com/api/openai-compatibility

Anthropic Messages API:
https://platform.claude.com/docs/en/api/messages
```



---

## Appendix: `HireMeOps_IMPLEMENTATION_SPEC.md`

# HireMeOps — Implementation Specification

## 1. Product Summary

**HireMeOps** is a local-first Rust/Tauri desktop application for job search automation.

Core flow:

```txt
CV import -> structured profile -> CV/job analysis -> job discovery -> match scoring -> application generation -> auto-fill/auto-submit -> audit logs
```

Primary target user:

```txt
Anyone looking for jobs.
```

MVP platform:

```txt
LinkedIn first, specifically Easy Apply flows.
```

Later platforms:

```txt
Indeed
Catho
Gupy
InfoJobs
Google Jobs / company career pages
```

Primary constraints:

```txt
Local-first
Single-device
Multiple profiles
Multiple active CVs
Cross-platform from day one: Windows, Linux, macOS
Minimal UI with high-quality effects
SSE/event-streamed backend progress
Good performance
YAGNI, KISS, DRY, SOLID
```

---

## 2. External Research Decisions

### 2.1 Tauri UI vs automation browser

Tauri should be used for the desktop shell and UI. It should **not** be the main browser automation engine.

Reason:

- Tauri renders app UI through platform WebViews.
- Windows uses WebView2.
- macOS uses WKWebView.
- Linux uses WebKitGTK.
- That is good for lightweight UI, but not ideal for robust cross-platform browser automation.

Decision:

```txt
Tauri WebView = HireMeOps UI
Automation Browser = Playwright-controlled Chromium sidecar
```

Sources:

- Tauri architecture: https://v2.tauri.app/concept/architecture/
- Tauri WebView versions: https://v2.tauri.app/reference/webview-versions/
- Tauri sidecars: https://v2.tauri.app/develop/sidecar/

### 2.2 Browser automation engine

Use **Playwright Chromium persistent context** for v1.

Reason:

- Persistent context supports a `userDataDir`, which stores browser session data.
- Each HireMeOps profile can have its own isolated browser profile folder.
- Chromium support is the most mature automation path.
- Firefox/WebKit can be added later behind the same `BrowserEngine` trait.

Decision:

```txt
v1 BrowserEngine = Playwright Chromium persistent profile
v2 BrowserEngine candidates = Firefox, WebKit, platform-specific WebView2 experimental
```

Sources:

- Playwright `launchPersistentContext`: https://playwright.dev/docs/api/class-browsertype
- Tauri sidecars: https://v2.tauri.app/develop/sidecar/

### 2.3 LinkedIn risk boundary

LinkedIn's official help pages say they do not allow third-party software that scrapes, modifies, or automates activity on LinkedIn.

HireMeOps must therefore be designed as a user-controlled local automation tool with clear risk disclosure, audit logs, stop controls, and no stealth/bypass features.

Required product guardrails:

```txt
No captcha bypass
No anti-detection logic
No stealth evasion
No recruiter messages
No fake identity generation
No account creation automation
Emergency stop required
Full audit trail required
```

Allowed product behavior in this spec:

```txt
User logs in manually.
The app can reuse that user-owned local browser session.
The app can auto-fill and auto-submit when the user enables it.
The app pauses on bot checks/captchas and asks the user to solve manually.
```

Sources:

- LinkedIn automated activity policy: https://www.linkedin.com/help/linkedin/answer/a1340567
- LinkedIn prohibited software policy: https://www.linkedin.com/help/linkedin/answer/a1341387

---

## 3. Locked Product Decisions

### 3.1 App identity

```txt
Name: HireMeOps
```

### 3.2 UI style

```txt
Minimal professional UI
Dark and light themes
Good effects with anime.js, GSAP, Three.js, Chart.js
Reduced effects mode for low-end machines
```

### 3.3 Operating systems

```txt
Windows
Linux
macOS
```

Cross-platform abstractions must exist from day one.

### 3.4 Automation mode

```txt
Auto-fill: enabled
Auto-submit: enabled
First target: LinkedIn Easy Apply
Later: every supported platform adapter
```

### 3.5 Captchas and bot checks

```txt
Automation pauses.
The browser is shown to the user.
The user solves manually.
Automation resumes after user confirmation.
```

No auto-solving or bypass.

### 3.6 Messaging

```txt
Never send messages to people.
```

Recruiter networking can send connection requests without notes/messages only.

### 3.7 CV behavior

```txt
Input: PDF, DOCX, manual LinkedIn-like profile editor
CV files copied into app storage
Raw CV text re-parsed when needed, not stored permanently
Multiple active CVs per profile
Highest-match CV selected automatically for each job
CV optimization only generated when analysis says it is needed
Cover letters generated only when required
```

### 3.8 Profiles

```txt
Multiple profiles
Multiple role variants per profile
Separate browser profile/session per HireMeOps profile
Salary facts stored per profile
Application URL lock is per profile
```

### 3.9 Search

```txt
LinkedIn first
Google dorking through browser automation
No Google dork result cache
```

Supported query syntax examples:

```txt
site:linkedin.com/jobs "Java Developer" "Remote"
site:greenhouse.io "Backend Developer" "Brazil"
site:lever.co "Software Engineer" "Remote"
("Java Developer" OR "Backend Developer") AND ("Remote" OR "Brazil")
```

### 3.10 AI providers

```txt
OpenAI-compatible API
Anthropic-compatible API
Local provider support
Custom proxy endpoint support
Offline/manual mode allowed
```

Recommended local provider:

```txt
Ollama first, because it supports OpenAI-compatible chat completions.
```

Sources:

- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Anthropic Messages API: https://platform.claude.com/docs/en/api/messages

---

## 4. Automation Rules

### 4.1 Auto-submit threshold

```txt
Minimum match score for auto-submit: 60%
```

### 4.2 Needs-review threshold

```txt
Generated form-answer confidence below 50% -> needs-review
```

### 4.3 Difficult forms

```txt
If the AI is unsure: needs-review
If profile facts are missing: needs-review
If legal/work authorization facts are missing: needs-review
If salary minimum is missing: needs-review
```

### 4.4 Salary questions

```txt
Auto-answer using the minimum salary value configured per profile.
```

Example facts:

```txt
salary_expectation_min = 5000
salary_expectation_currency = BRL
salary_expectation_period = monthly
```

### 4.5 Work authorization

v1 supported regions:

```txt
Brazil
European Union
```

Auto-answer only from saved profile facts.

Example facts:

```txt
work_authorized_brazil = true
work_authorized_eu = false
requires_visa_sponsorship_brazil = false
requires_visa_sponsorship_eu = true
```

### 4.6 Failed application retries

```txt
Retry automatically: yes
Max attempts: 10
```

Retry policy:

```txt
Retry only transient failures:
- browser crash
- timeout
- navigation interruption
- temporary network error
- stale selector after refresh

Do not retry final failures:
- already applied
- duplicate URL lock
- captcha/manual verification pending
- missing required profile fact
- unsupported form field
- account/session restricted
```

### 4.7 Duplicate URL behavior

```txt
Duplicate jobs are stored as separate job rows.
UI warns about duplicate URL.
Before applying, app checks per-profile application_url_locks.
If URL already applied for that profile, skip automatically.
```

Status:

```txt
skipped_duplicate_url
```

---

## 5. Retention and Cleanup

```txt
Audit logs: auto-delete after 30 days
Automation evidence: auto-delete after 1 day
AI cache: enabled, manual cleanup setting
Google dork cache: disabled
Application artifacts: stored until manually cleared
Generated cover letters/form answers: stored
Backups: database only
Deleted jobs: hard-deleted
Deleted profiles: hard-deleted with related local files
```

Automation evidence includes:

```txt
Screenshots
DOM snapshots
Console logs
Network errors
Form state
```

Screenshots are stored locally and not encrypted.

---

## 6. Architecture

### 6.1 Top-level architecture

```txt
React/Vite frontend
  -> Tauri commands
  -> Rust service layer
  -> SQLite + filesystem
  -> Background task queue
  -> Event bus
  -> Tauri events / SSE-compatible event stream
  -> Playwright Chromium sidecar
  -> AI provider adapters
```

### 6.2 Repository layout

```txt
hiremeops/
├─ src/
│  ├─ app/
│  ├─ pages/
│  ├─ components/
│  ├─ features/
│  │  ├─ dashboard/
│  │  ├─ profiles/
│  │  ├─ cv-library/
│  │  ├─ cv-analysis/
│  │  ├─ profile-variants/
│  │  ├─ job-preferences/
│  │  ├─ job-search/
│  │  ├─ applications/
│  │  ├─ automation/
│  │  └─ settings/
│  ├─ stores/
│  ├─ lib/
│  └─ types/
│
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ commands/
│  │  ├─ events/
│  │  ├─ storage/
│  │  ├─ profiles/
│  │  ├─ cv/
│  │  ├─ jobs/
│  │  ├─ matching/
│  │  ├─ applications/
│  │  ├─ automation/
│  │  ├─ browser/
│  │  ├─ platforms/
│  │  │  └─ linkedin/
│  │  ├─ ai/
│  │  ├─ security/
│  │  └─ logging/
│  ├─ migrations/
│  └─ tauri.conf.json
│
├─ docs/
├─ AGENTS.md
├─ README.md
└─ package.json
```

### 6.3 Rust modules

```txt
events/
- bus.rs
- types.rs
- emitter.rs

storage/
- db.rs
- migrations.rs
- paths.rs
- repositories/
- encryption.rs

profiles/
- service.rs
- variants.rs
- facts.rs

cv/
- import.rs
- parser.rs
- pdf.rs
- docx.rs
- preview.rs
- analysis.rs

jobs/
- search.rs
- repo.rs
- canonical_url.rs
- dedupe.rs

matching/
- scorer.rs
- explanation.rs
- cv_selector.rs

applications/
- draft.rs
- form_answers.rs
- submit_guard.rs
- url_lock.rs

automation/
- queue.rs
- runner.rs
- state_machine.rs
- retry.rs
- evidence.rs
- stop_token.rs

browser/
- engine.rs
- playwright_chromium.rs
- session.rs
- captcha_handoff.rs

platforms/linkedin/
- adapter.rs
- login.rs
- job_search.rs
- job_detail.rs
- easy_apply.rs
- connect.rs

ai/
- provider.rs
- openai_compatible.rs
- anthropic_compatible.rs
- ollama.rs
- cache.rs
- prompts.rs
```

---

## 7. Core Traits

### 7.1 BrowserEngine

```rust
pub trait BrowserEngine {
    async fn launch_profile(&self, profile_id: ProfileId) -> Result<BrowserSession>;
    async fn open_page(&self, session: &BrowserSession, url: &str) -> Result<PageHandle>;
    async fn stop(&self, session_id: &str) -> Result<()>;
    async fn capture_evidence(&self, page: &PageHandle) -> Result<AutomationEvidence>;
}
```

### 7.2 PlatformAdapter

```rust
pub trait PlatformAdapter {
    fn platform(&self) -> Platform;
    async fn check_session(&self, profile_id: ProfileId) -> Result<SessionStatus>;
    async fn search_jobs(&self, query: SearchQuery) -> Result<Vec<JobPost>>;
    async fn read_job(&self, url: &str) -> Result<JobPost>;
    async fn apply(&self, request: ApplyRequest) -> Result<ApplicationResult>;
    async fn connect(&self, request: ConnectRequest) -> Result<ConnectionResult>;
}
```

### 7.3 AiProvider

```rust
pub trait AiProvider {
    fn provider_kind(&self) -> AiProviderKind;
    async fn chat(&self, request: AiChatRequest) -> Result<AiChatResponse>;
    async fn stream_chat(&self, request: AiChatRequest) -> Result<AiStream>;
}
```

### 7.4 CvParser

```rust
pub trait CvParser {
    fn supports(&self, file_type: CvFileType) -> bool;
    async fn parse(&self, path: &Path) -> Result<ParsedCvText>;
}
```

### 7.5 JobMatcher

```rust
pub trait JobMatcher {
    async fn score(&self, input: MatchInput) -> Result<JobMatch>;
    async fn select_best_cv(&self, input: CvSelectionInput) -> Result<CvDocumentId>;
}
```

---

## 8. Event Streaming / SSE-Compatible Design

Long-running operations must emit events.

Desktop implementation:

```txt
Rust event bus -> Tauri emit -> frontend event store
```

Future API-compatible implementation:

```txt
GET /events
Content-Type: text/event-stream
```

Event shape:

```ts
export type AppEvent = {
  id: string
  type:
    | 'cv.import.started'
    | 'cv.parse.progress'
    | 'cv.analysis.done'
    | 'job.search.started'
    | 'job.search.item_found'
    | 'job.match.done'
    | 'application.started'
    | 'application.needs_review'
    | 'application.failed'
    | 'application.completed'
    | 'automation.paused_for_captcha'
    | 'automation.evidence_saved'
    | 'automation.stopped'
    | 'log'
  profileId?: string
  taskId?: string
  payload: unknown
  createdAt: string
}
```

Rules:

```txt
One event bus.
One frontend subscription layer.
No page-specific backend polling.
Paginated queries for persisted data.
Events for live progress only.
```

---

## 9. Automation State Machine

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

State rules:

```txt
Queued -> PreparingBrowser
PreparingBrowser -> CheckingSession
CheckingSession -> Searching or NeedsReview
Searching -> ExtractingJob
ExtractingJob -> ScoringJob
ScoringJob -> SelectingCV or Skipped
SelectingCV -> GeneratingAnswers
GeneratingAnswers -> NeedsReview if confidence < 50%
GeneratingAnswers -> FillingForm if confidence >= 50%
FillingForm -> PausedForCaptcha if bot check detected
FillingForm -> Submitting
Submitting -> VerifyingSubmission
VerifyingSubmission -> Completed or RetryScheduled or Failed
```

Emergency stop must interrupt all active automation tasks.

---

## 10. Performance Rules

```txt
Do not block UI during parsing, search, scoring, or automation.
Use background tasks for all long work.
Use SQLite indexes on profile_id, status, created_at, platform.
Store large DOM snapshots and screenshots on disk.
Keep only file paths and metadata in SQLite for large evidence.
Paginate jobs, logs, applications, evidence, and AI cache pages.
Recalculate all matches after CV change through queued tasks, not synchronously.
Use bounded concurrency for browser tasks.
Use cancellation tokens for stop/pause.
Use lazy rendering and virtualization in large tables.
```

---

## 11. Security Model

### 11.1 Sensitive data

Sensitive values:

```txt
API keys
AI proxy keys
browser session metadata
profile facts like phone/email
backup encryption key metadata
```

### 11.2 Argon2id correction

Argon2id is used for password/key derivation, not direct encryption.

Recommended:

```txt
Argon2id(passphrase + salt) -> key
AES-256-GCM or ChaCha20-Poly1305 -> encrypted sensitive fields
```

Sources:

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

### 11.3 API keys

Storage options:

```txt
Primary: OS keychain if available
Fallback: encrypted SQLite field using passphrase-derived key
```

---

## 12. MVP Scope

### Included

```txt
Tauri desktop app
React/Vite frontend
SQLite database
File storage layout
Multiple profiles
Multiple active CVs
CV import PDF/DOCX
Manual LinkedIn-like profile editor
Profile variants
Job preferences
LinkedIn browser session setup
LinkedIn Easy Apply automation
Google dork search through browser automation
Job match scoring
Best CV selection
Auto-fill
Auto-submit when score >= 60%
Needs-review when confidence < 50%
Retry failed transient applications up to 10 attempts
Duplicate URL lock per profile
Application queue
Automation cockpit
Evidence capture
Audit logs
AI providers: OpenAI-compatible, Anthropic-compatible, Ollama/custom local
JSON and CSV exports
Database-only backup/restore
Portable mode with automatic data move
```

### Excluded from v1

```txt
Cloud sync
Team/multi-user
SaaS auth
Mobile app
Recruiter message sending
Captcha solving/bypass
Anti-detection/stealth engine
Raw HTTP scraping of LinkedIn private pages
Merging duplicate jobs
Google dork result cache
```

---

## 13. Build Order

### Phase 1 — Foundation

```txt
Tauri app shell
React routing/layout
SQLite migrations
Storage paths
Event bus
Settings store
Dark/light theme
Reduced effects setting
```

### Phase 2 — Profiles and CV

```txt
Profiles CRUD
Manual profile editor
CV import/copy
PDF/DOCX parsing
CV preview/zoom
CV analysis
Profile variants
Profile facts
```

### Phase 3 — Jobs and matching

```txt
Job preferences
Search query builder
Job storage
Match scoring
Best CV selection
Duplicate URL warning
Application URL locks
```

### Phase 4 — AI providers

```txt
OpenAI-compatible provider
Anthropic-compatible provider
Ollama provider
Custom proxy endpoint
AI cache
Prompt templates
```

### Phase 5 — Browser automation

```txt
Playwright Chromium sidecar
Persistent profile per HireMeOps profile
Manual login setup
Session health check
LinkedIn job search
LinkedIn Easy Apply filling
Auto-submit
Captcha/manual handoff
Evidence capture
```

### Phase 6 — Automation cockpit

```txt
Queue runner
Retry policy
Pause/resume/stop
Emergency stop
Live events
Logs/evidence viewer
Cleanup scheduler
```

### Phase 7 — Export/backup/release

```txt
JSON export
CSV export
Database-only backup
Database restore
Portable mode toggle and migration
Cross-platform packaging
```



---

## Appendix: `HireMeOps_DATABASE_SCHEMA.md`

# HireMeOps — Database Schema

## 1. Database Strategy

Database:

```txt
SQLite local database
SQLx migrations
Single-device only
Local-first
Portable mode supported
Database-only backup/restore
```

Reasons:

- SQLite is sufficient for local-first desktop state.
- SQLx supports SQLite and migrations.
- Heavy artifacts should live on disk, not in hot database tables.

Sources:

- SQLx: https://github.com/launchbadge/sqlx
- SQLx migrate macro: https://docs.rs/sqlx/latest/sqlx/macro.migrate.html

---

## 2. File Storage Layout

Normal mode:

```txt
<AppData>/HireMeOps/
├─ hiremeops.sqlite
├─ profiles/
│  └─ <profile_id>/
│     ├─ cvs/
│     │  ├─ original/
│     │  └─ previews/
│     ├─ evidence/
│     │  ├─ screenshots/
│     │  └─ dom/
│     └─ exports/
├─ browser-profiles/
│  └─ <profile_id>/
│     └─ linkedin-chromium/
├─ backups/
└─ logs/
```

Portable mode:

```txt
<ExecutableDir>/HireMeOpsData/
├─ hiremeops.sqlite
├─ profiles/
├─ browser-profiles/
├─ backups/
└─ logs/
```

Portable toggle behavior:

```txt
When enabled, move existing data automatically.
When disabled, move data back to app data directory automatically.
Show progress through events.
Create a rollback marker before moving.
```

---

## 3. Migration 0001 — Core Profiles

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  target_title TEXT,
  summary TEXT,
  location TEXT,
  remote_preference TEXT,
  seniority TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_profiles_active ON profiles(is_active);
```

---

## 4. Profile Links

```sql
CREATE TABLE profile_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  url TEXT,
  value_encrypted TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_profile_links_profile ON profile_links(profile_id);
```

Kinds:

```txt
linkedin
github
portfolio
email
phone
website
other
```

---

## 5. Profile Facts

Facts are used for auto-answering salary, legal, work authorization, availability, and language fields.

```sql
CREATE TABLE profile_facts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_profile_facts_key
ON profile_facts(profile_id, fact_key);
```

Required v1 facts:

```txt
salary_expectation_min
salary_expectation_currency
salary_expectation_period
work_authorized_brazil
work_authorized_eu
requires_visa_sponsorship_brazil
requires_visa_sponsorship_eu
available_start_date
willing_to_relocate
english_level
```

---

## 6. CV Documents

Raw CV text is not stored permanently. CV files are copied into app storage and re-parsed when needed.

```sql
CREATE TABLE cv_documents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  preview_path TEXT,
  parser_version TEXT,
  last_parsed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_cv_documents_profile ON cv_documents(profile_id);
CREATE INDEX idx_cv_documents_hash ON cv_documents(file_hash);
```

---

## 7. Profile Variants

```sql
CREATE TABLE profile_variants (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_title TEXT NOT NULL,
  summary TEXT,
  headline TEXT,
  keywords_json TEXT,
  preferred_cv_document_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preferred_cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL
);

CREATE INDEX idx_profile_variants_profile ON profile_variants(profile_id);
```

Examples:

```txt
Java Backend Developer
Fullstack Developer
Rust Developer
Cybersecurity Analyst
DevOps Junior
```

---

## 8. Multiple Active CVs

```sql
CREATE TABLE profile_active_cvs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cv_document_id TEXT NOT NULL,
  role_variant_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE CASCADE
);

CREATE INDEX idx_profile_active_cvs_profile
ON profile_active_cvs(profile_id);

CREATE INDEX idx_profile_active_cvs_variant
ON profile_active_cvs(role_variant_id);
```

Selection rule:

```txt
For each job, score all active CVs and pick the highest match automatically.
```

---

## 9. CV Analysis Reports

```sql
CREATE TABLE cv_analysis_reports (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cv_document_id TEXT,
  role_variant_id TEXT,
  model_provider TEXT,
  model_name TEXT,
  score INTEGER,
  summary TEXT,
  optimization_needed INTEGER NOT NULL DEFAULT 0,
  missing_keywords_json TEXT,
  strengths_json TEXT,
  weaknesses_json TEXT,
  recommendations_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_cv_analysis_profile_created
ON cv_analysis_reports(profile_id, created_at);
```

---

## 10. Skills

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  proficiency TEXT,
  years_experience REAL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_skills_profile ON skills(profile_id);
CREATE INDEX idx_skills_name ON skills(name);
```

---

## 11. Experiences

```sql
CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  company TEXT,
  title TEXT NOT NULL,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  bullets_json TEXT,
  skills_json TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_experiences_profile ON experiences(profile_id);
```

---

## 12. Projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  role TEXT,
  url TEXT,
  repository_url TEXT,
  technologies_json TEXT,
  highlights_json TEXT,
  metrics_json TEXT,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_profile ON projects(profile_id);
```

---

## 13. Education

```sql
CREATE TABLE education (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  institution TEXT NOT NULL,
  degree TEXT,
  field TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_education_profile ON education(profile_id);
```

---

## 14. Certifications

```sql
CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  issuer TEXT,
  issue_date TEXT,
  expiration_date TEXT,
  credential_id TEXT,
  credential_url TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_certifications_profile ON certifications(profile_id);
```

---

## 15. Languages

```sql
CREATE TABLE languages (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_languages_profile ON languages(profile_id);
```

---

## 16. Job Preferences

```sql
CREATE TABLE job_preferences (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_roles_json TEXT NOT NULL,
  seniority_json TEXT,
  locations_json TEXT,
  remote_modes_json TEXT,
  min_salary INTEGER,
  salary_currency TEXT,
  required_skills_json TEXT,
  preferred_skills_json TEXT,
  excluded_keywords_json TEXT,
  blocked_companies_json TEXT,
  auto_apply_enabled INTEGER NOT NULL DEFAULT 1,
  auto_submit_enabled INTEGER NOT NULL DEFAULT 1,
  auto_submit_min_score INTEGER NOT NULL DEFAULT 60,
  needs_review_confidence_threshold INTEGER NOT NULL DEFAULT 50,
  retry_failed_enabled INTEGER NOT NULL DEFAULT 1,
  retry_limit INTEGER NOT NULL DEFAULT 10,
  daily_application_limit INTEGER,
  daily_connection_limit INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_job_preferences_profile ON job_preferences(profile_id);
```

`NULL` daily limits means no app-level limit configured.

---

## 17. Search Queries

```sql
CREATE TABLE search_queries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  preference_id TEXT,
  platform TEXT NOT NULL,
  query TEXT NOT NULL,
  query_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES job_preferences(id) ON DELETE SET NULL
);

CREATE INDEX idx_search_queries_profile ON search_queries(profile_id);
CREATE INDEX idx_search_queries_enabled ON search_queries(enabled);
```

Types:

```txt
linkedin_search
google_dork
company_career_page
manual
```

---

## 18. Job Posts

Duplicate jobs are not merged. Do not create a unique index on URL.

```sql
CREATE TABLE job_posts (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  platform TEXT NOT NULL,
  external_id TEXT,
  url TEXT NOT NULL,
  canonical_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote_mode TEXT,
  description TEXT NOT NULL,
  summary TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  currency TEXT,
  seniority TEXT,
  employment_type TEXT,
  posted_at TEXT,
  discovered_at TEXT NOT NULL,
  last_seen_at TEXT,
  content_hash TEXT,
  discovery_source TEXT,
  search_query_id TEXT,
  duplicate_group_hash TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (search_query_id) REFERENCES search_queries(id) ON DELETE SET NULL
);

CREATE INDEX idx_jobs_profile_status ON job_posts(profile_id, status);
CREATE INDEX idx_jobs_discovered ON job_posts(discovered_at);
CREATE INDEX idx_jobs_canonical_url ON job_posts(profile_id, platform, canonical_url);
CREATE INDEX idx_jobs_company ON job_posts(company);
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

---

## 19. Job Matches

Preserve old match scores for history.

```sql
CREATE TABLE job_matches (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  preference_id TEXT,
  cv_document_id TEXT,
  role_variant_id TEXT,
  score INTEGER NOT NULL,
  role_score INTEGER,
  skill_score INTEGER,
  seniority_score INTEGER,
  location_score INTEGER,
  salary_score INTEGER,
  complexity_score INTEGER,
  matched_skills_json TEXT,
  missing_skills_json TEXT,
  risk_flags_json TEXT,
  recommendation TEXT NOT NULL,
  explanation TEXT,
  model_provider TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (preference_id) REFERENCES job_preferences(id) ON DELETE SET NULL,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_matches_profile_job ON job_matches(profile_id, job_id);
CREATE INDEX idx_matches_score ON job_matches(score);
CREATE INDEX idx_matches_created ON job_matches(created_at);
```

Recommendations:

```txt
auto_apply
review_first
skip
save_for_later
```

---

## 20. Application Drafts

```sql
CREATE TABLE application_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  match_id TEXT,
  cv_document_id TEXT,
  role_variant_id TEXT,
  cover_letter TEXT,
  form_answers_json TEXT,
  generated_summary TEXT,
  optimization_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES job_matches(id) ON DELETE SET NULL,
  FOREIGN KEY (cv_document_id) REFERENCES cv_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (role_variant_id) REFERENCES profile_variants(id) ON DELETE SET NULL
);

CREATE INDEX idx_application_drafts_profile_status
ON application_drafts(profile_id, status);
```

---

## 21. Application Artifacts

```sql
CREATE TABLE application_artifacts (
  id TEXT PRIMARY KEY,
  application_draft_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  cache_status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (application_draft_id) REFERENCES application_drafts(id) ON DELETE CASCADE
);

CREATE INDEX idx_application_artifacts_draft
ON application_artifacts(application_draft_id);
```

Types:

```txt
cover_letter
form_answer
resume_variant
cv_review
optimization_note
```

---

## 22. Application Runs

```sql
CREATE TABLE application_runs (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failure_reason TEXT,
  browser_session_id TEXT,
  FOREIGN KEY (draft_id) REFERENCES application_drafts(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_app_runs_profile_status ON application_runs(profile_id, status);
CREATE INDEX idx_app_runs_job ON application_runs(job_id);
CREATE INDEX idx_app_runs_started ON application_runs(started_at);
```

Modes:

```txt
auto_fill
auto_submit
dry_run
manual_assist
```

Statuses:

```txt
started
completed
failed
needs_review
retry_scheduled
skipped_duplicate_url
paused_for_captcha
```

---

## 23. Application URL Locks

Per-profile lock to prevent applying twice to the same URL.

```sql
CREATE TABLE application_url_locks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_job_id TEXT NOT NULL,
  first_application_run_id TEXT,
  locked_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (first_job_id) REFERENCES job_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (first_application_run_id) REFERENCES application_runs(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_application_url_locks_profile_url
ON application_url_locks(profile_id, platform, canonical_url);
```

---

## 24. Connection Targets

No recruiter messages in v1.

```sql
CREATE TABLE connection_targets (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_url TEXT NOT NULL,
  full_name TEXT,
  headline TEXT,
  company TEXT,
  location TEXT,
  match_reason TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  discovered_at TEXT NOT NULL,
  connected_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_connection_targets_profile_status
ON connection_targets(profile_id, status);
```

Statuses:

```txt
discovered
queued
connected
skipped
blocked
failed
```

---

## 25. Automation Tasks

```sql
CREATE TABLE automation_tasks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  target_id TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  scheduled_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  payload_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_profile_status ON automation_tasks(profile_id, status);
CREATE INDEX idx_tasks_scheduled ON automation_tasks(status, scheduled_at);
CREATE INDEX idx_tasks_priority ON automation_tasks(priority);
```

Types:

```txt
parse_cv
analyze_cv
recalculate_matches
search_jobs
score_job
select_cv
generate_application
apply_job
connect_person
google_dork_search
sync_platform
cleanup
backup
restore
move_portable_data
```

---

## 26. Automation Evidence

Evidence is stored on disk. Database stores metadata and paths.

```sql
CREATE TABLE automation_evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  application_run_id TEXT,
  evidence_type TEXT NOT NULL,
  file_path TEXT,
  content TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (task_id) REFERENCES automation_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (application_run_id) REFERENCES application_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_evidence_task ON automation_evidence(task_id);
CREATE INDEX idx_evidence_run ON automation_evidence(application_run_id);
CREATE INDEX idx_evidence_expires ON automation_evidence(expires_at);
```

Types:

```txt
screenshot
dom_snapshot
console_log
network_error
form_state
```

Default expiration:

```txt
1 day
```

---

## 27. Browser Sessions

```sql
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  engine TEXT NOT NULL,
  user_data_dir TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_browser_sessions_profile_platform
ON browser_sessions(profile_id, platform);
```

Engines:

```txt
playwright_chromium
playwright_firefox_future
webview2_experimental_future
```

---

## 28. AI Providers

```sql
CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,
  default_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ai_providers_enabled ON ai_providers(enabled);
```

Provider types:

```txt
openai_compatible
anthropic_compatible
ollama
custom_proxy
disabled
```

---

## 29. AI Cache

```sql
CREATE TABLE ai_cache (
  id TEXT PRIMARY KEY,
  provider_id TEXT,
  model_name TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response_text TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_ai_cache_hash
ON ai_cache(model_name, prompt_hash, input_hash);

CREATE INDEX idx_ai_cache_last_used
ON ai_cache(last_used_at);
```

Use cases:

```txt
CV analysis
Job summary
Match explanation
Form answer generation
Cover letter generation
```

---

## 30. Retention Policies

```sql
CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  days INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
```

Default rows:

```sql
INSERT INTO retention_policies (id, key, days, enabled, updated_at)
VALUES
  ('rp_audit_logs', 'audit_logs', 30, 1, datetime('now')),
  ('rp_automation_evidence', 'automation_evidence', 1, 1, datetime('now')),
  ('rp_ai_cache', 'ai_cache', NULL, 0, datetime('now')),
  ('rp_application_artifacts', 'application_artifacts', NULL, 0, datetime('now'));
```

---

## 31. Cleanup Runs

```sql
CREATE TABLE cleanup_runs (
  id TEXT PRIMARY KEY,
  cleanup_type TEXT NOT NULL,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error TEXT
);

CREATE INDEX idx_cleanup_runs_started ON cleanup_runs(started_at);
```

Cleanup commands:

```txt
clear_ai_cache
clear_old_audit_logs
clear_old_dom_snapshots
clear_old_screenshots
clear_unused_application_artifacts
clear_failed_task_history
factory_reset
delete_profile
```

---

## 32. Audit Logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  profile_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_profile_created ON audit_logs(profile_id, created_at);
CREATE INDEX idx_audit_expires ON audit_logs(expires_at);
CREATE INDEX idx_audit_severity ON audit_logs(severity);
```

Default expiration:

```txt
30 days
```

Severity:

```txt
debug
info
warning
error
critical
```

---

## 33. App Settings

Use this for persistent app-level settings. Lightweight UI-only settings can also use Tauri Store, but SQLite keeps backup/export simpler.

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Required keys:

```txt
theme = dark | light | system
reduced_effects = true | false | auto
portable_mode = true | false
data_dir = path
active_profile_id = uuid
browser_engine = playwright_chromium
```

---

## 34. Data Export Records

```sql
CREATE TABLE export_runs (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
```

Supported exports:

```txt
profile_json
jobs_csv
applications_csv
audit_csv
```

---

## 35. Backup Records

Database-only backup.

```sql
CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY,
  backup_path TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
```

Backup excludes:

```txt
Copied CV files
Screenshots
DOM snapshots
Browser profile folders
Exports
```

---

## 36. Security Notes

Argon2id is for key derivation/password hashing. Use authenticated encryption for encrypted fields.

Recommended sensitive field flow:

```txt
User passphrase -> Argon2id -> key -> AES-256-GCM / ChaCha20-Poly1305 -> encrypted field
```

Sources:

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html



---

## Appendix: `HireMeOps_FRONTEND_SPEC.md`

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



---

## Appendix: `HireMeOps_AGENTS.md`

# AGENTS.md — HireMeOps

## Project Identity

HireMeOps is a local-first Rust/Tauri desktop app for job search automation.

Core flow:

```txt
CV import -> profile extraction -> CV/job analysis -> job discovery -> match scoring -> application generation -> browser automation -> audit trail
```

Primary MVP platform:

```txt
LinkedIn Easy Apply
```

Cross-platform targets from day one:

```txt
Windows
Linux
macOS
```

---

## Non-Negotiable Product Rules

- Never implement recruiter message sending.
- Never implement captcha solving or captcha bypass.
- Never implement stealth evasion, anti-detection bypass, fingerprint spoofing, or account restriction evasion.
- On captcha/bot/manual verification, pause automation and hand control to the user.
- Always provide emergency stop for browser automation.
- Always audit automation actions.
- Keep data local-first.
- Do not add cloud sync, team accounts, SaaS auth, or mobile features in v1.

LinkedIn-related automation must include risk disclosure and user-controlled settings because LinkedIn's official policies prohibit third-party tools that automate activity on LinkedIn.

---

## Architecture Rules

### Desktop shell

Use Tauri for the desktop shell and UI bridge.

```txt
Tauri WebView = UI only
Browser automation = Playwright Chromium sidecar
```

Do not use Tauri's embedded WebView as the main automation browser.

### Browser automation

v1 engine:

```txt
Playwright Chromium persistent context
```

Each HireMeOps profile must have its own browser profile folder.

### Database

Use:

```txt
SQLite
SQLx migrations
Local filesystem artifacts
```

Do not introduce PostgreSQL, MySQL, cloud DBs, Redis, queues-as-a-service, or multi-tenant abstractions in v1.

### Event streaming

All long-running operations must emit progress events.

Desktop v1:

```txt
Rust event bus -> Tauri emit -> frontend event store
```

Keep event types SSE-compatible for a future local API mode.

---

## Engineering Principles

### YAGNI

Do not build what is not in v1:

```txt
Cloud sync
Team/multi-user
SaaS auth
Mobile app
Marketplace
Plugin store
Multi-tenant database
Captcha bypass
Stealth automation
Messaging automation
```

### KISS

Prefer:

```txt
SQLite over distributed storage
Filesystem paths over blob columns for large evidence
One queue runner over multiple queues
One event bus over page-specific polling
One browser engine first
Simple traits over over-engineered frameworks
```

### DRY

Avoid duplicate logic for:

```txt
Event emission
Audit logging
Error handling
Profile ID scoping
File path resolution
AI provider calls
Automation evidence capture
Application URL locking
```

### SOLID

Use traits for replaceable systems:

```txt
BrowserEngine
PlatformAdapter
AiProvider
CvParser
JobMatcher
EvidenceStore
```

Keep implementations small and focused.

---

## Performance Rules

- Never block the frontend during CV parsing, AI calls, search, scoring, or automation.
- Use background tasks for long-running work.
- Use cancellation tokens for stop/pause.
- Use pagination for jobs, logs, applications, evidence, and cache pages.
- Store screenshots/DOM snapshots on disk, not inside hot SQLite rows.
- Use indexes for `profile_id`, `status`, `created_at`, `platform`, and URL locks.
- Recalculate all matches after CV changes through queued jobs, not synchronous UI actions.
- Use bounded concurrency for browser automation.
- Do not run multiple uncontrolled browser sessions per profile.

---

## Security Rules

- API keys must not be stored in plaintext.
- Prefer OS keychain when available.
- Fallback to encrypted SQLite fields.
- Argon2id is for passphrase/key derivation, not direct encryption.
- Use authenticated encryption such as AES-256-GCM or ChaCha20-Poly1305 for encrypted fields.
- Do not store raw CV text permanently.
- Copied CV files are stored locally in app-managed storage.
- Screenshots and DOM evidence are local and retained for 1 day by default.
- Audit logs are retained for 30 days by default.

---

## Automation Rules

### Auto-submit

Auto-submit only when:

```txt
Match score >= 60
Application URL is not locked for this profile
Required saved profile facts exist
Generated answers have confidence >= 50
No captcha/manual verification is active
No unsupported required field exists
```

### Needs-review

Mark application as needs-review when:

```txt
Generated form answer confidence < 50
Required profile fact missing
Legal/work authorization fact ambiguous
Salary fact missing
Unsupported custom required question
Captcha/manual verification is needed
Session expired
```

### Retry

Retry transient failures automatically up to 10 attempts.

Retry allowed:

```txt
Timeout
Temporary network error
Browser crash
Navigation interruption
Stale selector after refresh
```

Retry not allowed:

```txt
Duplicate URL lock
Already applied
Captcha/manual verification pending
Missing required profile fact
Unsupported required field
Account/session restriction
```

---

## Frontend Rules

- Minimal UI.
- Dark and light themes.
- Reduced effects mode required.
- Effects should improve state clarity, not add clutter.
- Use Chart.js for dashboard charts.
- Use GSAP/anime.js for small transitions.
- Use Three.js only for optional lightweight background accents.
- Do not animate large virtualized tables.
- Emergency stop must always be visible.
- Pages must not directly poll long-running tasks; use event store.

Required pages:

```txt
Dashboard
Profiles
CV Library
CV Analysis
Profile Variants
Job Preferences
Job Search
Applications Queue
Automation Cockpit
Settings & Logs
```

---

## Backend Module Boundaries

Recommended modules:

```txt
events/
storage/
profiles/
cv/
jobs/
matching/
applications/
automation/
browser/
platforms/linkedin/
ai/
security/
logging/
```

Do not mix browser automation code into frontend components.
Do not put SQL queries directly inside Tauri command handlers.
Use service/repository boundaries.

---

## Database Rules

- Duplicate jobs must be stored as separate rows.
- Do not add a unique index on job URL.
- Use `application_url_locks` to prevent applying twice to the same URL per profile.
- Deleted jobs are hard-deleted.
- Deleted profiles are hard-deleted with related local files.
- Multiple active CVs per profile are supported through `profile_active_cvs`.
- Old match scores are preserved for history.
- CV changes enqueue full match recalculation.
- Backups include database only.
- Exports support JSON and CSV.

---

## AI Provider Rules

Supported provider types:

```txt
openai_compatible
anthropic_compatible
ollama
custom_proxy
```

Offline/manual mode must be allowed.
AI provider setup should not block basic profile/CV management.

AI cache required for:

```txt
CV analysis
Job summaries
Match explanations
Form answer generation
Cover letter generation
```

Cache key:

```txt
model_name + prompt_hash + input_hash
```

---

## Code Style

Rust:

- Use `anyhow` for application-level errors unless a typed error improves the caller.
- Use typed IDs or newtypes when practical.
- Keep Tauri commands thin.
- Use services for business logic.
- Use repositories for SQL access.
- Use `serde` DTOs for command/event boundaries.
- Add indexes with migrations when adding query paths.

TypeScript:

- Use strict types.
- Keep components small.
- Keep backend DTOs centralized under `src/types` or generated bindings.
- Prefer composition over large prop chains.
- Avoid duplicated API wrappers.

---

## Verification Commands

Adjust package manager if the repo chooses npm/pnpm/bun.

Frontend:

```bash
npm run lint
npm run typecheck
npm run build
```

Rust:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

Tauri:

```bash
npm run tauri build
```

---

## Definition of Done

A feature is not done unless:

```txt
It is behind the correct profile scope.
It emits events for long-running work.
It writes audit logs for automation actions.
It has cancellation behavior if long-running.
It does not block the UI.
It handles failure states explicitly.
It follows local-first storage rules.
It avoids prohibited automation behavior.
It has minimal, scoped code changes.
```

