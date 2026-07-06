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
