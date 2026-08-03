# Backend + Frontend Refactor — Living Checklist

**Constraint: do not break current behavior.** Every implemented item is verified with a
build/test before it's checked. Structure-first: clean boundaries before forcing patterns.

## Legend
- `[x]` implemented & verified
- `[=]` **evaluation completed** — decision recorded, no code change (pattern retained/not applicable)
- `[~]` in progress
- `[ ]` not started
- `✅` already satisfied by pre-existing code

_Long implementation notes live in git history / commit messages, not here — this stays scannable._

## Execution order
Dependency → Code Style → **Observability** → Architecture → Database → SSE → principles → Frontend.
(Observability before streaming so the new emit code is instrumented from the start.)

---

## Dependency Policy
- [x] Every dependency documents its purpose (one-line `#` in `Cargo.toml`).
- [x] No duplicate functionality (lopdf/pdf-extract are distinct; removed dead `directories`).
- [x] Prefer `std` before a crate (already true: `OnceLock`/`LazyLock`/`time`).
- [ ] Re-audit `Cargo.toml` quarterly (next: 2026-11).

## Dependency hygiene
- ✅ No `regex`/`chrono`/`once_cell`/`lazy_static`/`parking_lot`/`async-trait`.
- [x] Feature flip `default = []` (chromiumoxide opt-in); every app/build path carries `-f real-browser`; verified lean + real-browser.
- [x] `anyhow` out of domain (typed `DomainError::Message`); `Other(#[from] anyhow::Error)` kept for auth/gated.
- [x] `lopdf`/`pdf-extract` kept (distinct roles); `directories` removed (dead).

## Code Style
- [x] `fmt` + `clippy` in CI (`.github/workflows/ci.yml`) — `-D warnings` on lean + all-features.
- [x] `cargo fmt --all` clean.
- [x] `clippy -D warnings` GREEN on both builds (mechanical auto-fixes; `unwrap_err`→`match`; complex tuple→`type` alias; `too_many_arguments`→targeted `#[allow]` on IPC/driver contracts; lean-only unused feature-gated).
- [x] Removed risky non-test `unwrap`/`expect` (audit: 17 prod sites; fixed 3 real risks; 14 are idiomatic locks / entry-point / configured-pipe).
- [ ] `let` over `mut`; imports/naming tidy (fold into other passes as files are touched).
- [ ] Comments explain **intent/invariants/non-obvious decisions**, not restate code.

## Observability (tracing) — done BEFORE finishing SSE
- [x] Replaced print macros with `tracing` — only 1 production site (`cv.rs` `eprintln!`→`warn!`); the 2 in `cv/export.rs` are test-only. `tracing` already used in 14 files.
- [x] Structured spans on automation `run_task` (task_id) + `drive` (task_id/session_id/url/platform) via `#[tracing::instrument]`.
- [x] Consistent capability targets (`hiremeops::automation`, `hiremeops::cv`).

## Architecture
- [x] **Folder/module cohesion (backend)** — split god-modules: `automation.rs` test module → sibling file; `commands/jobs.rs` (2748L) → `commands/jobs/` (`mod`/`queries`/`scrapers`, paths stable). Scrapers stayed in the command layer (IPC+orchestration), not forced into domain.
- [ ] **Folder cohesion (frontend)** — TOP remaining architecture item (see Frontend pass). Clean folders make later refactors easier.
- [x] **NewType** — `JobId`/`ProfileId` (`domain/ids.rs`, `#[serde(transparent)]`), adopted at the scoring boundary; arg-swap is now a compile error.
- [=] **Builder** evaluation completed — current design retained (YAGNI). `EasyApplyInput` is a serde DTO built via struct-update; a builder would be ceremony.
- [=] **RAII** evaluation completed — already appropriate (`ScratchDir`/sqlx `Tx` use `Drop`). A session Drop guard is wrong here (async close + session intentionally kept open for operator review).
- [=] **Factory** evaluation completed — already appropriate (`oauth::provider_config`); `BrowserDriver` single-impl → none needed.
- [=] **TypeState** evaluation completed — not applicable; transitions are runtime/event-driven; the existing runtime enums are correct.
- [ ] Composition over inheritance / DIP — confirm service traits injected at the edge (spot-check during Observability pass).

## Database (sqlx / SQLite)
- [x] FTS5 (`0010_job_posts_fts.sql`) + `bm25`-ranked bound-arg `search_job_posts` + sanitizer; wired to `list_job_posts`; tested.
- [x] Prepared queries + grouped args (FTS path); apply convention as query fns are touched.
- [ ] Watch for N+1; keep transactions explicit and minimal.

## Real-time / SSE — MANDATORY  [Rust + .js bridge + frontend]
- [x] **(1) Scrape streaming — DONE end-to-end.**
  - Frontend: `useJobStore.upsertJob` + `eventBridge::dispatchJobFound` on `job.search.item_found` (tested).
  - Rust: `emit_job_found` helper re-selects the ingested row → `JobPostDto` → `JobSearchItemFound` event, called after each `ingested += 1` in all 9 scrapers (`app: AppHandle` added to the cmds). Best-effort (never aborts a scrape). clippy green both builds, 207 tests.
- [=] **(2) AI bridge token streaming — evaluated; buffered delivery RETAINED + progress events (LO decision).** True token streaming fails LO's success criteria: it forces an in-page `fetch`/`ReadableStream` (reintroduces the SPA-context-destruction crash the Node-layer request deliberately avoids) and relies on ChatGPT's undocumented delta SSE. Per LO, kept the working buffered+poll path untouched and instead emit coarse `ai.progress` status (`generating`/`ready`/`failed`) at the `draft_application` command boundary → frontend `useAiStatusStore` (bridge `dispatchAiProgress`, tested). Live AI feedback, zero reliability risk. Extend emission to other AI commands (cv analysis / indeed answers) as they're touched.

## JavaScript / Node bridge (`.mjs`)
- [ ] `resources/playwright-bridge/index.mjs` — SSE streaming rework (above); confirm no dead code, consistent error frames, backward-compatible stdio protocol.
- [ ] `scripts/*.mjs` — confirm purpose; leave unless vendor flow needs change.

## Principles sweep
- [x] **DRY** — reviewed. Emit path already DRY'd (`emit_job_found`). Main remaining candidate: the 9 column-identical `INSERT INTO job_posts` blocks in scrapers. Recommended fix documented: a `persist_job(db, app, NewJobPost{..})` helper (each scraper maps its card → struct → helper). **Staged, not big-banged**: a blind 9×24-field re-map is runtime-untestable (browser-only) and a semantic field mismap compiles silently → do one scraper, verify against a real scrape, then roll out. Design recorded; execution deferred to a browser-verifiable session.
- [=] **KISS/YAGNI** — confirmed throughout: no speculative abstractions added; Builder/RAII/Factory/TypeState declined where they'd be ceremony.
- [=] **SOLID/DI** — SRP improved via module splits; services depend on traits (`JobSearchService`, `BrowserDriver`) injected at the edge (`lib.rs`); `AppState` wires concretes. Adequate for a local-first desktop app; no change warranted.

## Frontend pass (TypeScript/React)
- [ ] **Folder cohesion** (top item) — assess capability grouping (jobs/profile/automation/cv/settings) where it cuts cross-imports; don't churn for its own sake.
- [ ] **Remove dead React components/hooks** — dead UI accumulates like dead Rust modules.
- [ ] Real-time wiring: `job.search.item_found` (done) + `ai.token` live-append.
- [ ] No `any` at IPC boundary; mirror `JobId`/`ProfileId` as branded TS types where it prevents mix-ups.
- [ ] Gates green: `tsc`, eslint, prettier, vitest (triage the 16 pre-existing full-repo eslint errors).
