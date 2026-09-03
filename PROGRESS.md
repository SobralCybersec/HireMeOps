# Progress

Goal: complete `TODO.md` performance work, pin old/current evidence, and verify repository state.

## Checklist

- [x] 1 — Completed: replaced FTS ID-then-fetch loop with one ranked FTS5 + `job_posts` join.
- [x] 2 — Completed: default job page is 50, hard cap 200; list rows use bounded summaries; `get_job_post` serves detail text.
- [x] 3 — Completed: added `(discovered_at, id)` keyset cursor and UI Load more path; legacy offset remains compatible.
- [x] 4 — Completed: added profile/status/order-aligned job indexes.
- [x] 5 — Completed: enabled SQLx pool acquire timing and slow-acquire WARN threshold.
- [x] 6 — Completed: in-flight rewrite-list requests collapse duplicate React/dev calls.
- [x] 7 — Completed: split CV rewrite history metadata from `get_cv_rewrite` detail payload.
- [x] 8 — Completed: `run_search` preloads preference, variants, and jobs; scores in memory; persists one transaction.
- [x] 9 — Completed: added periodic passive WAL observation and maintenance; no extra writer actor added.
- [x] 10 — Completed: batch write transaction now covers search match inserts/status updates; import paths retain their existing per-row contract.
- [x] 11 — Completed: added search/profile, analysis/document, preference/profile, variant/profile, and drafts/job indexes.
- [x] 12 — Completed: FTS prefix index rebuilt with `prefix='2 3 4'`.
- [x] 13 — Completed: FTS input uses 2-character minimum and 200ms debounce; explicit optimize command added.
- [x] 14 — Completed: release profile uses `opt-level = 3`; `perf` profile added.
- [x] 15 — Completed: added benchmark matrix for pool 2/3/4/5, statement cache, cache size, mmap, and temp store.
- [x] 16 — Completed: `PRAGMA optimize` runs after migrations, periodically, and on SQLx connection close.
- [x] 17 — Completed: logs SQLite version, passive checkpoint tuple, and WAL byte size.
- [x] 18 — Completed: pool size is configurable with `HIREMEOPS_DB_MAX_CONNECTIONS`; default remains 5.
- [x] 19 — Completed: statement cache is configurable with `HIREMEOPS_DB_STATEMENT_CACHE_CAPACITY`; default is 256.
- [x] 20 — Completed: cache, mmap, and temp-store knobs are configurable for A/B runs.
- [x] 21 — Completed: stale scan cleanup uses indexed `NOT EXISTS` probes and adds `application_drafts(job_id)`.
- [x] 22 — Completed: Rust performance profile changed from size-first to runtime optimization.
- [x] 23 — Completed: UUID/TEXT schema reviewed; migration deliberately kept out of this performance pass.
- [x] 24 — Completed: `WITHOUT ROWID` reviewed and kept out because external FTS depends on `rowid`.

## Changed files

- `src-tauri/migrations/0011_performance_paths.sql`
- `src-tauri/src/storage/db.rs`, `src-tauri/src/lib.rs`
- `src-tauri/src/commands/jobs/{mod.rs,queries.rs}`
- `src-tauri/src/domain/{jobs.rs,cv.rs}` and `src-tauri/src/commands/cv.rs`
- `src-tauri/Cargo.toml`
- `src/pages/JobSearch.tsx`, `src/stores/useJobStore.ts`, related tests
- `src/pages/cv/*`, `src/pages/CvLibrary.tsx`, `src/pages/ProfileVariants.tsx`
- `scripts/benchmark-sqlite.sh`, `scripts/benchmark-changes.mjs`,
  `scripts/benchmark-changes-metrics.mjs`, `scripts/benchmark-changes.node-test.mjs`
- `ISSUE.md`, `FullIssue.md`, `vite.config.ts`

## Verification

- Baseline: 255 frontend tests and 199 Rust tests passed; typecheck/lint passed. Quality review had known repository debt.
- Current: 257 frontend unit tests and 199 Rust tests passed.
- Current: `npm run typecheck` passed.
- Current: `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` passed.
- Current: `npm run format:check` passed.
- Current: `npm run build` passed.
- Current: `git diff --check` passed.
- Current: `node scripts/quality-review.mjs --strict` exits 1 for nine oversized files and unavailable Lizard; Jscpd is 4.526%, under the 5% threshold.
- `scripts/benchmark-sqlite.sh` syntax checked.
- `scripts/benchmark-changes.mjs` compared five old/current query paths with result identity checks; smoke output is in `reports/todo-performance/benchmark-results.json` and the 30-sample profile is in `reports/todo-performance/benchmark-performance.json`.

## Senior-grade evidence

- Pinned baseline: `cfda4b06a51343db960e318a23f16a309bd01a1c`; final candidate filtered-tree SHA is `32989283f15478a88d612b897a9afc380f43aae5`; worktree remains dirty by design.
- `scripts/benchmark-changes.mjs` now supports smoke/performance profiles, p50/p90/p95/p99/max/mean/stddev, semantic field/boundary hashes, throughput, RSS, startup, SQLite metadata, FTS query plans, and optional release probes.
- `reports/todo-performance/benchmark-performance.json` contains 10 warmups, 30 measured samples, seven scenarios, and a clean archive clone.
- `reports/todo-performance/sanitized-fixture.sqlite3` is persisted, hash-recorded, and includes WAL, FTS-size, and checkpoint measurements.
- `reports/todo-performance/release-metrics.json` records successful pinned baseline/current release builds, binary hashes, sizes, and build durations.
- `ISSUE.md` separates performance-critical, supporting, and adjacent functional scope; records regression budgets and the remaining FTS/release follow-ups.
- `FullIssue.md` records every changed file group, runtime behavior, final benchmark values, verification gates, release trade-offs, and rollback evidence.
- `reports/todo-performance/ROLLBACK.sh` removes additive benchmark artifacts after restoring the focused baseline snapshot.

Original-file hashes and rollback copies: `reports/todo-performance/original.sha256` and `reports/todo-performance/original/`.
