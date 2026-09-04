# Performance and change-set validation

## Title

Validate database, CV, job-search, browser, and UI performance changes against a HEAD baseline

## Summary

This change set addresses the performance work in `TODO.md` and adds behavior needed by the
current CV, job-search, provider, and export flows. It needs one reviewable Issue that records:

- what changed;
- how the pre-change implementation is preserved;
- which benchmark paths are compared;
- which functional and quality gates remain;
- how to reproduce and roll back the work.

## Problem

The previous implementation had several high-cost paths:

- FTS returned IDs and fetched each job with a separate query.
- Job lists used large default pages and returned full descriptions.
- Deep pagination used `OFFSET`.
- CV rewrite history returned full rewrite JSON and source text for list views.
- Search scoring reloaded preferences and job rows per item.
- SQLite pool, statement-cache, page-cache, mmap, and temporary-store settings were fixed.
- WAL health and pool-acquire contention had little runtime visibility.
- The frontend could issue duplicate rewrite-history requests.

## Diff review

### Database and query paths

- Added migration `0011_performance_paths.sql` with query-shape indexes for job lists,
  search scoring, CV analysis, preferences, profile variants, and application drafts.
- Rebuilt external-content FTS with `prefix='2 3 4'`.
- Replaced FTS ID-then-fetch behavior with one ranked FTS5 plus `job_posts` join.
- Added bounded job-list summaries, default page size `50`, hard cap `200`, and a detail command
  for full job text.
- Added `(discovered_at, id)` keyset pagination while preserving offset compatibility.
- Preloaded search preferences, variants, and discovered jobs before in-memory scoring.
- Batched match writes and status updates in one transaction.
- Added stale-scan `NOT EXISTS` cleanup probes and the `application_drafts(job_id)` index.
- Split CV rewrite list metadata from full rewrite detail loading.

### SQLite runtime and release profile

- Added configurable pool size, SQLx statement-cache capacity, SQLite `cache_size`, `mmap_size`,
  and `temp_store` settings.
- Added SQLx acquire timing and slow-acquire warnings.
- Added `PRAGMA optimize` after migrations, during maintenance, and on connection close.
- Added passive WAL/checkpoint and WAL-file-size observation.
- Changed the release profile from size-first optimization to runtime optimization and added a
  `perf` profile.
- Kept the UUID/TEXT schema and external-FTS `rowid` design unchanged for this pass.

### Frontend and data contracts

- Added keyset cursor state and Load more behavior to job search.
- Collapsed duplicate in-flight rewrite-list requests.
- Added lightweight rewrite summaries and detail loading.
- Extracted Command Center UI pieces under `src/pages/command-center/`.
- Updated CV Library, CV Analysis, Profile Variants, export controls, and settings provider UI.
- Added regression coverage for provider behavior, job-store behavior, and CV export behavior.

### AI, browser, CV parsing, and export

- Extended browser-provider bridge status, login, timeout, and session handling.
- Added cleanup for web-search citation and markdown-link artifacts in generated CV data.
- Added certificate parsing, language-aware rewrite data, cover-letter parsing, and related
  regression cases.
- Expanded structured CV export and LaTeX handling for contact, education, experience, skills,
  certificates, metadata, and cover letters.
- Updated the browser dependency and vendored-resource preparation path.

## Baseline clone

The pre-change implementation is preserved in:

- `reports/todo-performance/original/` — focused old implementation snapshot;
- `reports/todo-performance/original.sha256` — snapshot hashes;
- `reports/todo-performance/performance.patch` — implementation patch;
- `reports/todo-performance/ROLLBACK.sh` — runnable snapshot restore.

The benchmark also creates a clean old-tree clone with `git archive HEAD`. The clone used for the
latest run was:

`/tmp/hiremeops-old-clone-fCRTRV`

It was created with:

```sh
npm run benchmark:changes -- --create-clone --keep-clone
```

## Benchmark implementation

`scripts/benchmark-changes.mjs` uses only built-in Node and SQLite APIs. It creates deterministic
old/current SQLite fixtures, applies the old or current query shape, checks returned row identity,
and records p50/p95 timings plus serialized payload size.

Covered scenarios:

1. FTS ID-then-fetch versus ranked FTS join.
2. Full job rows versus bounded list summaries.
3. Deep `OFFSET` pagination versus indexed keyset pagination.
4. Per-row search reads versus preference/variant/job preloading.
5. Full CV rewrite history versus summary metadata loading.

Default run parameters:

- `5,000` job rows;
- `500` CV rewrites;
- `2` warmup iterations;
- `5` measured iterations;
- alternating old/current execution order;
- output: `reports/todo-performance/benchmark-results.json`.

Run smaller smoke checks with:

```sh
node scripts/benchmark-changes.mjs --rows 200 --rewrites 30 --warmup 1 --iterations 2
```

Run the complete comparison with a newly created baseline clone:

```sh
npm run benchmark:changes -- --create-clone --keep-clone
```

## Latest benchmark result

Machine: local Linux runner, Node `v25.8.0`, `node:sqlite`.

| Scenario | Old p50 | Current p50 | Speedup | Payload reduction | Rows |
|---|---:|---:|---:|---:|---:|
| FTS join versus N+1 | 1,937.923 ms | 828.290 ms | 2.340x | 31.6% | 200 |
| Bounded job summary | 1.183 ms | 0.156 ms | 7.583x | 31.8% | 50 |
| Deep keyset versus offset | 4.078 ms | 0.439 ms | 9.289x | 31.7% | 50 |
| Search preload versus per-row reads | 5.384 ms | 2.506 ms | 2.148x | 0.0% | 555 |
| CV summary versus full history | 9.150 ms | 1.086 ms | 8.425x | 98.3% | 500 |

The old/current result identities matched in all five scenarios. Timings are directional local
measurements, not production SLOs. Re-run on representative databases before choosing final
pool/cache/mmap values.

## Acceptance criteria

- [x] Old implementation snapshot is hash-verified.
- [x] Benchmark can create a clean `git archive HEAD` clone.
- [x] Benchmark covers all five high-cost query/data paths above.
- [x] Benchmark checks result identity, row count, timing, and payload bytes.
- [x] Benchmark output is saved as JSON for review.
- [x] Vitest excludes old snapshots from active test discovery.
- [x] Frontend unit tests pass.
- [x] Node script tests pass.
- [x] Rust library tests pass.
- [x] Rust formatter and Clippy pass.
- [x] TypeScript, ESLint, and Prettier checks pass.
- [ ] Resolve or explicitly accept repository-wide file-size debt reported by
      `node scripts/quality-review.mjs`.
- [ ] Install or provide the repository's Lizard dependency, then clear its structural gate.
- [ ] Repeat benchmark on a representative persisted SQLite database and record p50/p95/p99,
      RSS, WAL size, and selected pool/cache/mmap configuration.

## Verification evidence

Passing checks from this worktree:

```text
npm run test                         33 Vitest files, 257 tests; 7 Node tests
npm run typecheck                    exit 0
npm run lint                         exit 0
npm run format:check                 exit 0
cargo test --manifest-path ... --lib 199 passed
cargo fmt --manifest-path ... --check exit 0
cargo clippy --manifest-path ...      exit 0
git diff --check                     exit 0
benchmark-changes.mjs                5 scenarios, identity checks passed
```

Quality review currently reports two environment/repository issues:

- the file-size gate reports nine files above the existing 1,000-line hard limit, including
  large pre-existing or materially changed Rust/automation modules;
- Lizard is not installed in the runner, so its gate exits through the missing-tool path.

Jscpd remains below its configured threshold in the latest report: `4.532%` duplication versus
the `5%` limit.

## Risks and follow-up

- Synthetic fixtures isolate query-shape effects; network, filesystem, browser, and AI latency
  are outside this benchmark.
- FTS prefix indexes increase storage and write cost; measure import workloads as well as reads.
- Keyset pagination requires stable `(discovered_at, id)` ordering; offset remains for compatibility.
- Runtime tuning must be selected from repeated measurements, not from one local run.
- Release `opt-level = 3` may increase build time or binary size; compare release artifacts.
- Full schema migration and `WITHOUT ROWID` changes remain separate follow-up work.

## Rollback

Use the snapshot rollback for the preserved performance slice:

```sh
bash reports/todo-performance/ROLLBACK.sh /tmp/hiremeops-todo-rollback-target
```

The benchmark and Issue files are additive. Remove them independently when the review record is
no longer needed. Keep the old snapshot until benchmark and release decisions are complete.

## Definition of done

- [ ] Review the complete diff against this Issue.
- [ ] Review benchmark JSON and representative-database results.
- [ ] Decide final SQLite tuning values from repeated measurements.
- [ ] Resolve or document quality-gate exceptions.
- [ ] Land implementation, benchmark, Issue, and verification artifacts together.
