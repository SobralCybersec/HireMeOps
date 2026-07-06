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
