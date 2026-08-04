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
- [=] `let` over `mut`; imports/naming tidy — folded into every touched file; no systematic gratuitous-`mut` or dead-import problem found (clippy's `-D warnings` guards unused imports on both builds).
- [=] Comments explain **intent/invariants/non-obvious decisions** — applied on every file touched (e.g. the `INSERT_JOB_POST_SQL` doc explains the `?19` reuse + why binds stay per-scraper); existing comments already follow this.

## Observability (tracing) — done BEFORE finishing SSE
- [x] Replaced print macros with `tracing` — only 1 production site (`cv.rs` `eprintln!`→`warn!`); the 2 in `cv/export.rs` are test-only. `tracing` already used in 14 files.
- [x] Structured spans on automation `run_task` (task_id) + `drive` (task_id/session_id/url/platform) via `#[tracing::instrument]`.
- [x] Consistent capability targets (`hiremeops::automation`, `hiremeops::cv`).

## Architecture
- [x] **Folder/module cohesion (backend)** — split god-modules: `automation.rs` test module → sibling file; `commands/jobs.rs` (2748L) → `commands/jobs/` (`mod`/`queries`/`scrapers`, paths stable). Scrapers stayed in the command layer (IPC+orchestration), not forced into domain.
- [=] **Folder cohesion (frontend)** — assessed. Layer-based layout (`app`/`components`/`pages`/`stores`/`lib`/`types`, pages sub-grouped `cv`/`settings`/`jobsearch`) is conventional and clean; a capability re-org would touch every import for marginal gain → declined (YAGNI). Targeted wins taken instead: co-located `JobSearch.helpers.ts`, removed 3 dead files.
- [x] **NewType** — `JobId`/`ProfileId` (`domain/ids.rs`, `#[serde(transparent)]`), adopted at the scoring boundary; arg-swap is now a compile error.
- [=] **Builder** evaluation completed — current design retained (YAGNI). `EasyApplyInput` is a serde DTO built via struct-update; a builder would be ceremony.
- [=] **RAII** evaluation completed — already appropriate (`ScratchDir`/sqlx `Tx` use `Drop`). A session Drop guard is wrong here (async close + session intentionally kept open for operator review).
- [=] **Factory** evaluation completed — already appropriate (`oauth::provider_config`); `BrowserDriver` single-impl → none needed.
- [=] **TypeState** evaluation completed — not applicable; transitions are runtime/event-driven; the existing runtime enums are correct.
- [=] Composition over inheritance / DIP — confirmed. `init_state` (lib.rs) is the composition root: it builds the concrete `PlaywrightDriver` + `SqlitePool`; domain services depend on the `BrowserDriver` trait (proven by `MockDriver` in tests). Concretes at the edge, abstractions in the core. No change.

## Database (sqlx / SQLite)
- [x] FTS5 (`0010_job_posts_fts.sql`) + `bm25`-ranked bound-arg `search_job_posts` + sanitizer; wired to `list_job_posts`; tested.
- [x] Prepared queries + grouped args (FTS path); apply convention as query fns are touched.
- [=] N+1 / transactions — checked. `score_job` is pure in-memory (no per-job round-trip). The only query-in-loop sites are the scrapers' per-card INSERT + dedupe check — inherent write-per-row at tiny volume, not a read N+1. Per-row autocommit kept deliberately: wrapping a scrape page in one tx would hold SQLite's single write-lock across `await`ed network scrapes. No change.

## Real-time / SSE — MANDATORY  [Rust + .js bridge + frontend]
- [x] **(1) Scrape streaming — DONE end-to-end.**
  - Frontend: `useJobStore.upsertJob` + `eventBridge::dispatchJobFound` on `job.search.item_found` (tested).
  - Rust: `emit_job_found` helper re-selects the ingested row → `JobPostDto` → `JobSearchItemFound` event, called after each `ingested += 1` in all 9 scrapers (`app: AppHandle` added to the cmds). Best-effort (never aborts a scrape). clippy green both builds, 207 tests.
- [=] **(2) AI bridge token streaming — evaluated; buffered delivery RETAINED + progress events (LO decision).** True token streaming fails LO's success criteria: it forces an in-page `fetch`/`ReadableStream` (reintroduces the SPA-context-destruction crash the Node-layer request deliberately avoids) and relies on ChatGPT's undocumented delta SSE. Per LO, kept the working buffered+poll path untouched and instead emit coarse `ai.progress` status (`generating`/`ready`/`failed`) at the `draft_application` command boundary → frontend `useAiStatusStore` (bridge `dispatchAiProgress`, tested). Live AI feedback, zero reliability risk. Extend emission to other AI commands (cv analysis / indeed answers) as they're touched.

## JavaScript / Node bridge (`.mjs` / `.js`)
- [=] `src-tauri/resources/playwright-bridge/index.mjs` (988L) — audited. Single `send(id, result, error)` frame helper + top-level catches; stdio protocol unchanged (backward-compatible). No SSE rework (buffered retained per LO). Deep dead-code sweep of runtime-only browser glue deferred as browser-verification-gated.
- [=] `automation/worker.js` (3120L) — audited. Single `writeLine({ id, ok, … })` frame helper (success `ok:true` / failure `ok:false, error`) through one dispatch + top-level catch; consistent. Same deferral rationale as above.
- [=] `scripts/*.mjs` — vendor-prep only (`prepare-tauri-playwright-resources.mjs`); purpose confirmed, left as-is.

## Principles sweep
- [x] **DRY** — done. Emit path already DRY'd (`emit_job_found`). The 9 column-identical `INSERT INTO job_posts` blocks now share one `INSERT_JOB_POST_SQL` const (schema-coupled SQL lives once; a column change is 1 edit, not 9). Deliberately extracted ONLY the SQL, not a full `persist_job(NewJobPost{..})` helper: the per-scraper `.bind(..)` chains legitimately differ (real vs `None` salary/contact_email/remote_mode), and a typed struct would need exact conversions over 9 heterogeneous, browser-only card types that can't be runtime-verified here — the const is the zero-risk, statically-verifiable 90% of the win. clippy clean both builds, 207 tests.
- [=] **KISS/YAGNI** — confirmed throughout: no speculative abstractions added; Builder/RAII/Factory/TypeState declined where they'd be ceremony.
- [=] **SOLID/DI** — SRP improved via module splits; services depend on traits (`JobSearchService`, `BrowserDriver`) injected at the edge (`lib.rs`); `AppState` wires concretes. Adequate for a local-first desktop app; no change warranted.

## Frontend pass (TypeScript/React)
- [=] **Folder cohesion** — see Architecture: layer layout kept (YAGNI), targeted extraction + dead-file removal taken.
- [x] **Remove dead React components/hooks** — deleted `NativeWebviewSurface.tsx` (220L, zero refs — `BrowserPreview` is the live one), `lib/useCountUp.ts`, `lib/useDragScroll.ts`. **`EmergencyStopButton` fully removed (LO's call):** button + `emergencyStop` store action + `isEmergencyStopped` flag + tests + dead `.emergency-stop-btn` CSS + the now-orphaned `automation_emergency_stop` Tauri command & its registration. The shared abort latch (`AppState.emergency_stop` set by `automation_stop`/`pause`, cleared by `start`/`resume`) is untouched — `stop` still aborts a run.
- [=] Real-time wiring: `job.search.item_found` live-append DONE; `ai.token` live-append superseded by the `ai.progress` buffered-delivery decision (Real-time §2).
- [x] No `any` at IPC boundary — `lib/tauriInvoke.ts` is fully generic (`<T>` + `Record<string, unknown>`); **zero** `any` in non-test `src`. [=] Branded `JobId`/`ProfileId` TS types declined (YAGNI): backend already enforces the NewType at the scoring boundary; branding TS would thread casts through every DTO/store/invoke for low mix-up risk in a solo local app.
- [x] Gates green — `tsc` clean, **eslint 0/0** (was 29: react-hooks bumped to v7, whose `recommended` bundles experimental react-compiler rules; disabled those 3 with rationale since each false-positives on correct code, fixed 2 real classic `exhaustive-deps`, extracted helpers to clear `only-export-components`, removed dead code, trivial `no-useless-escape` + dead-var fixes), vitest 256/256. CI `frontend` job now runs `typecheck · lint · test` (lint step was missing despite the name).
- [x] **Prettier — clean.** Ran `pnpm format` across `src` (cleared the pre-existing drift); `format:check` now GREEN and wired into the CI `frontend` job (typecheck · lint · format · test) so it can't drift back.
