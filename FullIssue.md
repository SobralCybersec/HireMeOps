# Full Issue — End-to-End Performance and Feature Change Set

## Status

**Complete for this pass.**

This document is the full review record for the current worktree. It expands the concise issue notes in ISSUE.md into:

- file-by-file change inventory;
- runtime and user-visible behavior;
- schema and query changes;
- benchmark design and final measurements;
- correctness and semantic-equivalence checks;
- release-size trade-offs;
- verification gates;
- rollback procedure;
- intentionally deferred follow-up work.

The change set contains performance work plus adjacent CV, browser/provider, export, and UI work. Those scopes are separated below so review remains explicit.

---

## 1. Executive summary

The main change removes repeated database and IPC work from job search, job listing, scoring, import, and CV-history paths.

Measured result on the final 30-sample run:

- five read paths improved by **1.972x–9.979x p50**;
- CV history transfer volume fell **98.3%**;
- job import throughput increased **66.4%** in this run;
- match-write throughput increased **6.8%** in this run;
- result identities, required fields, ordering, and pagination boundaries remained equivalent;
- persisted FTS diagnostics remain the next profiling target because relevance sorting still uses a temporary B-tree;
- release binary size increased **27.05%** in the separately captured release comparison.

This is an end-to-end data-path optimization:

~~~
SQLite -> SQLx -> Rust domain -> serialization -> Tauri IPC -> frontend store -> React
~~~

The benchmark proves the measured paths. It does not claim that synthetic local timings equal production SLOs.

---

## 2. Change identity

| Item | Value |
|---|---|
| Baseline ref | cfda4b06a51343db960e318a23f16a309bd01a1c |
| Baseline source | git archive cfda4b06a51343db960e318a23f16a309bd01a1c |
| Candidate commit | none; worktree remains uncommitted |
| Candidate filtered tree | 32989283f15478a88d612b897a9afc380f43aae5 |
| Worktree | dirty by design |
| Benchmark fixture | reports/todo-performance/sanitized-fixture.sqlite3 |
| Fixture SHA-256 | 0888397fafe8da185d3afb003cec5302040dbad8db7b6eb68238af2c02201bb0 |
| Fixture size | 5,000 job rows |
| Performance report | reports/todo-performance/benchmark-performance.json |
| Smoke report | reports/todo-performance/benchmark-results.json |
| Release report | reports/todo-performance/release-metrics.json |

The candidate tree is created from the current source plus worktree changes through a temporary Git index. Generated reports, issue documents, and progress documents are excluded to prevent self-referential benchmark hashes. FullIssue.md is also excluded from the candidate tree for the same reason.

Diff accounting at document time:

- tracked diff: 38 files, 2,499 additions, 1,276 deletions;
- untracked additions: benchmark scripts, migration, UI extraction/test, examples, issue records, baseline snapshots, reports, fixture, rollback assets, and this document;
- generated report files are evidence artifacts, not application runtime inputs.

---

## 3. Scope split

### Performance-critical changes

- query-shape indexes and FTS prefix index;
- bounded job summaries;
- keyset pagination;
- FTS JOIN path;
- search preload and batched persistence;
- batched job import and match writes;
- CV rewrite summary/detail separation;
- SQLite pool, WAL, cache, mmap, temp-store, and optimize hooks;
- benchmark runner, persisted fixture, diagnostics, semantic checks, throughput, RSS, and release measurements.

### Supporting refactors

- Command Center extraction;
- shared CV parsing and export types;
- browser bridge session helpers;
- provider status/login/logout flow;
- AI prompt parsing and citation cleanup;
- frontend store and domain-type updates;
- test and Vite discovery adjustments.

### Adjacent functional changes

- CV certificate, language, cover-letter, and LaTeX parsing/export support;
- browser-provider session controls;
- Patchright dependency update;
- CV export and history UI changes;
- examples used by export flows.

Adjacent changes are included in the same worktree and are documented here. They are not used as performance claims.

---

## 4. File-by-file diff inventory

### 4.1 Repository and package configuration

| File | Change | Reason |
|---|---|---|
| .gitignore | Adds local/generated challenge artifacts to ignore rules. | Keep unrelated generated files out of normal diffs. |
| PROGRESS.md | Updates progress, completed work, evidence, known debt, and verification state. | Preserve execution history. |
| package.json | Adds benchmark:changes; includes benchmark modules in formatting checks. | Make benchmark and formatting commands reproducible. |
| pnpm-lock.yaml | Locks dependency graph updates. | Reproducible installs. |
| automation/package.json | Updates Patchright from 1.61.1 to 1.62.1. | Keep automation/browser package current with bridge resources. |
| src-tauri/Cargo.toml | Adds regex; changes release profile/runtime dependency configuration. | Strip citation artifacts and tune release/runtime behavior. |
| src-tauri/Cargo.lock | Locks the Rust dependency graph. | Reproducible Rust builds. |
| vite.config.ts | Uses Vitest config entry point and excludes generated performance reports from test discovery. | Prevent generated snapshots/reports from being treated as source tests. |

### 4.2 Database and Rust runtime

| File | Change | Result |
|---|---|---|
| src-tauri/migrations/0011_performance_paths.sql | Adds hot-path indexes; rebuilds external-content FTS5 with Unicode tokenization and prefix='2 3 4'; restores insert/update/delete triggers and populates FTS from job_posts. | Aligns indexes with list, search, scoring, CV, and draft queries. |
| src-tauri/src/storage/db.rs | Centralizes SQLite URL/options; applies WAL/busy-timeout/foreign-key setup; exposes cache and mmap environment knobs; runs PRAGMA optimize; observes WAL state and file sizes. | Makes runtime tuning measurable and operationally visible. |
| src-tauri/src/lib.rs | Wires database maintenance and the new job-search command path into application state/command registration. | Makes optimized paths reachable from the app. |
| src-tauri/src/domain/jobs.rs | Adds bounded summaries, preload structures, in-memory scoring inputs, batch writes, status updates, and stale-scan cleanup path. | Removes repeated preference/variant/job reads and repeated write boundaries. |
| src-tauri/src/domain/cv.rs | Adds CV rewrite summary/detail data structures and parsing/metadata support. | Keeps history lists lightweight while retaining detail retrieval. |
| src-tauri/src/commands/jobs/mod.rs | Registers job query, pagination, search, and index-maintenance commands. | Exposes optimized query contracts to IPC. |
| src-tauri/src/commands/jobs/queries.rs | Reworks list/search queries for bounded projections, FTS JOIN, keyset cursors, deterministic ordering, and summary/detail payloads. | Removes N+1 reads, overfetch, and deep OFFSET work. |
| src-tauri/src/commands/cv.rs | Adds CV summary/detail command behavior and related parsing inputs. | Supports lightweight history and complete detail views. |
| src-tauri/src/cv/export.rs | Extends export assembly for structured CV sections and cover-letter data. | Produces consistent export payloads. |
| src-tauri/src/cv/latex.rs | Adds LaTeX rendering for contact, education, experience, and related CV sections. | Enables structured PDF/LaTeX export. |

### 4.3 AI, browser, and provider flows

| File | Change | Result |
|---|---|---|
| src-tauri/src/ai/browser_bridge.rs | Adds browser-session lifecycle, timeout, status, login/logout, model, and chat bridge behavior. | Makes browser-backed provider state observable and controllable. |
| src-tauri/src/ai/mod.rs | Routes provider actions and normalizes bridge results/errors. | Keeps provider commands in one dispatch path. |
| src-tauri/src/ai/prompt.rs | Expands CV rewrite/prompt parsing; strips web-search citation artifacts; supports certificates, languages, cover letters, and structured sections. | Produces cleaner, typed AI-derived CV data. |
| src-tauri/src/commands/browser_provider.rs | Adds provider status/session command exposure. | Connects provider controls to frontend settings. |
| src-tauri/resources/playwright-bridge/index.mjs | Adds session status/logout behavior, cookie cleanup, navigation/session checks, and provider action routing. | Provides deterministic browser-provider lifecycle behavior. |
| src-tauri/resources/playwright-bridge/package.json | Updates embedded Patchright version to 1.62.1. | Keeps packaged bridge dependency aligned. |

### 4.4 Frontend and state

| File | Change | Result |
|---|---|---|
| src/pages/CommandCenter.tsx | Reduces page orchestration surface. | Keeps page entry point smaller after extraction. |
| src/pages/command-center/CommandCenterVariant.tsx | New extracted Command Center variant component. | Isolates variant rendering and state. |
| src/pages/JobSearch.tsx | Consumes bounded job summaries, cursor pagination, load-more state, search results, and optimized detail behavior. | UI no longer assumes large full-row list payloads. |
| src/stores/useJobStore.ts | Adds pagination cursor state, summary/detail loading, batched search state, and typed job actions. | Preserves UI behavior over new IPC contracts. |
| src/stores/useJobStore.test.ts | Covers cursor state, loading behavior, and new job-store contracts. | Regression protection for frontend state transitions. |
| src/types/domain.ts | Adds/updates shared job and CV domain types. | Keeps Rust-to-TypeScript payloads explicit. |
| src/pages/CvLibrary.tsx | Uses summary history and detail loading; adds CV import/metadata behavior. | Large histories render from lightweight rows. |
| src/pages/CvAnalysis.tsx | Adapts analysis view to updated CV data contracts. | Keeps analysis UI compatible with structured CV data. |
| src/pages/ProfileVariants.tsx | Adapts variant data and related controls. | Preserves profile-variant workflow. |
| src/pages/cv/index.ts | Updates CV module exports. | Centralizes new CV types/helpers. |
| src/pages/cv/rewrite.ts | Adds rewrite request/result handling for summary/detail and structured fields. | Aligns UI with Rust rewrite contracts. |
| src/pages/cv/types.ts | Adds structured CV, rewrite, certificate, language, and cover-letter types. | Avoids untyped payload drift. |
| src/pages/cv/CvExportButton.tsx | Adds export format/action behavior and user feedback. | Exposes structured export flow. |
| src/pages/cv/CvExportButton.test.tsx | New export button regression tests. | Verifies export action and state behavior. |
| src/pages/cv/cv.css | Adds styles required by updated CV sections/export UI. | Keeps new UI states readable. |
| src/pages/settings/BrowserProviderPanel.tsx | Adds provider status/login/logout/session controls and error/loading states. | Makes browser-provider lifecycle user-visible. |
| src/pages/settings/BrowserProviderPanel.test.tsx | Covers provider status and session controls. | Regression protection for settings behavior. |

### 4.5 Examples, benchmark tooling, and evidence

| File/path | Change | Role |
|---|---|---|
| examples/certificates.tex | New representative certificate input. | Export/parser fixture. |
| examples/coverletter.tex | New representative cover-letter input. | Export/parser fixture. |
| scripts/benchmark-changes.mjs | New end-to-end benchmark runner with baseline archive, candidate tree, smoke/performance profiles, clone handling, five read cases, two throughput cases, robust statistics, semantic equivalence, RSS, persisted fixture, query plans, and optional release metrics. | Reproducible change comparison. |
| scripts/benchmark-changes-metrics.mjs | New helper for file-size metrics, FTS diagnostics, CLI startup probe, and release-build measurements. | Keeps benchmark orchestration focused. |
| scripts/benchmark-changes.node-test.mjs | New assert-based tests for CLI parsing, profiles, statistics, quality options, and report parsing. | Runnable benchmark self-check. |
| scripts/benchmark-sqlite.sh | New SQLite fixture/diagnostic helper. | Repeatable SQLite tuning and WAL/FTS inspection. |
| reports/todo-performance/benchmark-performance.json | Final 10-warmup/30-sample performance report. | Machine-readable evidence. |
| reports/todo-performance/benchmark-results.json | Final 2-warmup/5-sample smoke report. | Fast regression evidence. |
| reports/todo-performance/sanitized-fixture.sqlite3 | Persisted sanitized 5,000-row fixture. | Stable database input. |
| reports/todo-performance/VERIFICATION.txt | Command log, outputs, exit codes, quality-gate note, and rollback evidence. | Human-readable audit trail. |
| reports/todo-performance/ROLLBACK.sh | Restores the focused baseline snapshot and removes generated performance artifacts. | Runnable rollback. |
| reports/todo-performance/original.sha256 | SHA-256 manifest for the captured baseline files. | Baseline integrity check. |
| reports/todo-performance/original/ | Baseline copies for focused performance files. | Offline rollback source. |
| reports/todo-performance/performance.patch | Patch representation of the focused performance changes. | Review/diff artifact. |
| reports/todo-performance/release-metrics.json | Separate release binary/build comparison. | Release trade-off evidence. |
| ISSUE.md, ISSUE2.md, ISSUE3.md, TODO.md | Existing issue/task records retained in the worktree. | Historical context and source checklist. |
| session_memory.json | Session-generated metadata. | Process artifact; not runtime product behavior. |
| FullIssue.md | This document. | Full review and completion record. |

---

## 5. Runtime behavior changes

### 5.1 Job list and search

Before:

- list paths could select large rows;
- deep pages paid OFFSET cost;
- FTS search performed repeated per-row lookups;
- scoring repeated preference, variant, and job reads;
- writes were issued through repeated transaction boundaries.

After:

- list queries select bounded summary projections;
- deep pagination uses a deterministic keyset cursor;
- FTS returns job rows through a JOIN;
- search scoring preloads shared inputs once and scores in memory;
- writes/status updates use batches and one transaction boundary where applicable;
- query ordering includes stable tie-breakers;
- the new indexes match profile/status/time/id and search-query/time/id access patterns.

Semantic contract preserved:

- same result IDs;
- same ordering;
- same required summary fields;
- same first/last pagination boundaries;
- detail data remains available through the detail path.

### 5.2 CV history

Before, history responses carried complete rewrite documents and repeated large text fields.

After:

- history lists return CvRewriteSummary;
- detail retrieval returns full rewrite content only when requested;
- metadata is retained for list rendering and filtering;
- structured fields support certificates, languages, cover letters, education, experience, and contact data.

Measured fixture payload:

~~~
baseline: 5,958,001 bytes
current:    104,001 bytes
reduction:      98.3%
~~~

This reduces database reads, Rust decoding/allocation, JSON serialization, IPC transfer, JavaScript parsing, frontend state size, and rendering work.

### 5.3 SQLite lifecycle

The DB layer now:

- enables WAL and busy timeout behavior;
- applies foreign-key enforcement;
- exposes cache-size and mmap-size environment settings;
- runs PRAGMA optimize after migrations and during maintenance;
- records passive WAL checkpoint state and database/WAL sizes;
- keeps runtime knobs measurable instead of treating one local configuration as universal.

Final persisted-fixture settings:

| Setting | Value |
|---|---:|
| page size | 4096 |
| journal mode | WAL |
| synchronous | NORMAL (1) |
| cache size | -16384 KiB |
| mmap size | 0 |
| temp store | memory (2) |
| WAL autocheckpoint | 1000 |

### 5.4 Browser/provider flow

The browser bridge now supports:

- provider status;
- login/session detection;
- logout and relevant cookie cleanup;
- session navigation and timeout handling;
- model listing and chat routing;
- frontend status/loading/error states.

This scope is functional/supporting work, separate from the database performance claims.

### 5.5 CV export and parsing

The CV path now supports structured handling for:

- contact;
- education;
- experience;
- certificates;
- languages;
- cover letters;
- LaTeX export/rendering;
- rewrite metadata and detail payloads.

Examples provide representative export inputs. Tests cover the new UI export action.

---

## 6. Database migration details

Migration 0011_performance_paths.sql adds:

- idx_jobs_profile_discovered_id
- idx_jobs_profile_status_discovered_id
- partial idx_jobs_search_discovered
- idx_cv_analysis_document_created
- idx_job_preferences_profile_updated
- idx_profile_variants_profile_created
- idx_application_drafts_job

FTS changes:

- external-content FTS5 remains backed by job_posts;
- tokenizer is unicode61 remove_diacritics 2;
- prefix segments are 2 3 4;
- insert, delete, and update triggers are recreated;
- existing job_posts content is repopulated into the derived FTS index.

No WITHOUT ROWID conversion was introduced. No source-table identity format was changed.

---

## 7. Benchmark design

### 7.1 Commands

Smoke:

~~~bash
npm run benchmark:changes -- \
  --profile smoke \
  --rows 5000 \
  --rewrites 500 \
  --warmup 2 \
  --iterations 5 \
  --baseline-ref cfda4b06a51343db960e318a23f16a309bd01a1c \
  --fixture reports/todo-performance/sanitized-fixture.sqlite3 \
  --output reports/todo-performance/benchmark-results.json \
  --keep-clone
~~~

Performance:

~~~bash
npm run benchmark:changes -- \
  --profile performance \
  --rows 5000 \
  --rewrites 500 \
  --warmup 10 \
  --iterations 30 \
  --baseline-ref cfda4b06a51343db960e318a23f16a309bd01a1c \
  --fixture reports/todo-performance/sanitized-fixture.sqlite3 \
  --output reports/todo-performance/benchmark-performance.json \
  --keep-clone
~~~

### 7.2 Method

Each case:

1. materializes an isolated baseline clone from the pinned baseline SHA;
2. runs baseline and candidate in alternating order;
3. performs warmups before measured samples;
4. captures min, p50, p90, p95, p99, max, mean, and standard deviation;
5. captures result count and serialized payload bytes;
6. hashes ordered IDs and required semantic fields;
7. checks first/last pagination boundaries;
8. records RSS for throughput cases.

The runner also records:

- baseline/candidate identity;
- dirty-worktree state;
- Node, SQLite, SQLx, CPU, memory, kernel;
- SQLite pragmas;
- FTS size and query plan;
- persisted fixture hash;
- benchmark startup probe;
- frontend dist size;
- optional release binary/build metrics.

The five read cases are:

1. FTS JOIN versus N+1 search;
2. bounded job summary;
3. deep keyset pagination versus OFFSET;
4. search preload versus per-row reads;
5. CV rewrite summary versus full history.

The two throughput cases are:

1. job import;
2. batched match writes.

### 7.3 Correctness checks

The benchmark does not accept speed-only results. It checks:

- ordered result ID hash;
- required field hash;
- row count;
- first result;
- last result;
- keyset boundary;
- equivalent batch output.

All final cases passed semantic-equivalence checks.

---

## 8. Final performance measurements

Source: reports/todo-performance/benchmark-performance.json, generated 2026-08-27T17:58:24.505Z.

### 8.1 Read paths

| Case | Baseline p50 | Current p50 | Speedup | Baseline p95 | Current p95 | Current p99 | Payload change |
|---|---:|---:|---:|---:|---:|---:|---:|
| FTS JOIN vs N+1 | 1908.333 ms | 792.992 ms | 2.406x | 2073.155 ms | 881.668 ms | 904.713 ms | -31.6% |
| Bounded job summary | 0.959 ms | 0.222 ms | 4.320x | 1.218 ms | 0.389 ms | 0.459 ms | -31.8% |
| Deep keyset vs OFFSET | 4.650 ms | 0.466 ms | 9.979x | 5.256 ms | 0.685 ms | 0.697 ms | -31.7% |
| Search preload | 6.293 ms | 3.191 ms | 1.972x | 7.402 ms | 4.147 ms | 4.452 ms | unchanged |
| CV summary vs full history | 10.329 ms | 1.204 ms | 8.579x | 13.654 ms | 1.509 ms | 1.687 ms | -98.3% |

Current mean ± standard deviation:

| Case | Current mean | Current standard deviation |
|---|---:|---:|
| FTS JOIN | 804.449 ms | 35.454 ms |
| Bounded job summary | 0.251 ms | 0.074 ms |
| Deep keyset | 0.488 ms | 0.066 ms |
| Search preload | 3.317 ms | 0.347 ms |
| CV summary | 1.197 ms | 0.174 ms |

### 8.2 Throughput

| Case | Baseline | Current | Change |
|---|---:|---:|---:|
| Job import | 236,462.521 imported rows/s | 393,545.848 imported rows/s | +66.4% |
| Batched match writes | 215,610.177 matched rows/s | 230,202.578 matched rows/s | +6.8% |

The match-write result is positive in the final run, but it remains a secondary result. The primary design benefits are transaction atomicity, lower lock churn, and reduced pool pressure.

RSS deltas recorded by the final throughput run:

- job import: +1,306,624 bytes;
- batched match writes: +7,864,320 bytes.

RSS is process-level and workload-sensitive; these values are evidence, not a memory budget.

### 8.3 Persisted FTS diagnostic

Current persisted fixture diagnostic:

- p50: 815.795 ms;
- p95: 870.055 ms;
- p99/max: 917.932 ms;
- FTS bytes: 3,649,536;
- baseline FTS bytes: 1,019,904;
- FTS size multiplier: approximately 3.58x.

Plan includes:

~~~text
USE TEMP B-TREE FOR ORDER BY
~~~

The FTS path is materially better than the N+1 baseline but remains the dominant measured read cost. The next profiling target is candidate count/relevance ordering, especially bm25(), LIMIT, prefix cardinality, and description-field weighting.

### 8.4 Startup and frontend artifact probe

The benchmark CLI startup probe recorded:

- p50: 31.800 ms;
- p95: 35.716 ms;
- p99/max: 35.877 ms.

This is CLI benchmark startup, not a GUI cold-start measurement.

Frontend dist size:

- current: 5,162,726 bytes;
- baseline frontend dist: not captured in this run.

---

## 9. Release trade-off

Separate release comparison in reports/todo-performance/release-metrics.json:

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| Binary size | 16,876,872 bytes | 21,441,800 bytes | +4,564,928 / +27.05% |
| Release build duration | 104 s | 160 s | +56 s / approximately +53.8% |

Binary SHA-256:

- baseline: ec2f21a5fff403895d9382cb446bb930bd1ef848b601a13107aa12a48e7dc0f0;
- current: 48df4bb0d0bd67dcb1a3f0b3e042883ec2a1b1eed2fe429902734728b1506976.

Release metrics were captured before the final benchmark-runner path-exclusion-only edit. That edit does not enter the Rust release binary. The release artifact remains valid for the application code comparison; a future release report can refresh source-tree metadata if exact worktree identity is required.

Decision: record the size/build cost explicitly. For a desktop application, the measured runtime/data-path gains justify carrying the current release profile pending a separate opt-level = "s" versus opt-level = 3 A/B comparison.

---

## 10. Verification record

### Passed

| Command/check | Result |
|---|---|
| npm run typecheck | pass |
| npm run lint | pass |
| npm run format:check | pass |
| npm run test | 33 Vitest files, 257 tests pass; 8 Node tests pass |
| npm run build | pass |
| cargo test | 199 tests pass |
| cargo fmt --check | pass |
| cargo clippy --all-targets --all-features -- -D warnings | pass |
| git diff --check | pass |
| bash -n scripts/benchmark-sqlite.sh reports/todo-performance/ROLLBACK.sh | pass |
| sha256sum -c reports/todo-performance/original.sha256 | 18/18 baseline files pass |
| smoke benchmark | 7 cases, 2 warmups, 5 samples, equivalence pass |
| performance benchmark | 7 cases, 10 warmups, 30 samples, equivalence pass |
| rollback execution | copy restore and generated-artifact cleanup pass |

### Known repository quality debt

node scripts/quality-review.mjs --strict exits 1 because:

- 9 files exceed the repository file-size policy;
- Lizard is unavailable in the environment;
- Jscpd remains approximately 4.526%, under the configured 5% threshold.

The touched hard-limit file is src-tauri/src/domain/jobs.rs, now approximately 1,018 lines. Several other oversized files predate this pass. This is documented debt, not hidden by suppression or weakened assertions.

The complete verification wrapper therefore records an expected quality-review failure after all preceding checks pass. This pass does not claim that repository quality debt is resolved.

---

## 11. Rollback

Baseline integrity:

~~~bash
sha256sum -c reports/todo-performance/original.sha256
~~~

Rollback:

~~~bash
bash reports/todo-performance/ROLLBACK.sh
~~~

The script:

1. verifies the focused baseline manifest;
2. copies baseline files back into the worktree;
3. removes migration and benchmark additions;
4. removes generated report/fixture files;
5. prints the restored baseline commit.

The rollback was executed and verified. The restored marker was:

~~~text
ROLLBACK_COPY_RESTORED=/tmp/hiremeops-todo-rollback-final2
BASELINE_COMMIT=cfda4b06a51343db960e318a23f16a309bd01a1c
~~~

Rollback scope is intentionally focused on the performance change set. It preserves unrelated worktree files.

---

## 12. Definition of done

### Completed in this pass

- [x] Fixed baseline SHA recorded.
- [x] Candidate filtered-tree identity recorded.
- [x] Clean baseline clone generated with git archive <baseline SHA>.
- [x] Smoke benchmark added.
- [x] Repeated performance benchmark added.
- [x] p50/p90/p95/p99/max/mean/stddev recorded.
- [x] Throughput recorded.
- [x] Payload volume recorded.
- [x] RSS recorded for throughput cases.
- [x] Persisted sanitized fixture recorded with SHA-256.
- [x] SQLite pragma and environment metadata recorded.
- [x] FTS size and query plan recorded.
- [x] Semantic-equivalence checks passed.
- [x] Release binary size/build comparison recorded.
- [x] Native TypeScript, Rust, formatting, lint, test, and build checks passed.
- [x] Quality-review exception documented with exact failure cause.
- [x] Patch, verification log, baseline manifest, and rollback script produced.
- [x] Full issue documentation written.

### Deliberately deferred follow-up

These are next investigations, not blockers for closing this pass:

1. reduce persisted FTS tail latency;
2. isolate bm25() and USE TEMP B-TREE FOR ORDER BY cost;
3. A/B prefix configurations (none, 2, 2 3, 2 3 4) against size and query latency;
4. measure actual GUI cold startup separately from CLI benchmark startup;
5. compare release optimization levels with identical source;
6. split or simplify oversized pre-existing/touched Rust files;
7. install/use Lizard in the quality-review environment.

---

## 13. Final review decision

The implementation pass is complete and documented.

Evidence supports the following conclusion:

> Across five result-equivalent benchmark paths, the current implementation reduced median latency by 1.972x–9.979x, reduced CV-history transfer volume by 98.3%, improved job-import throughput by 66.4% in the final run, and preserved result identities, required fields, ordering, and pagination boundaries. The remaining dominant hotspot is FTS relevance ordering, now isolated for focused follow-up rather than broad SQLite changes.

Recommended review label:

**End-to-end data-path optimization complete; FTS profiling and quality-debt cleanup tracked separately.**
