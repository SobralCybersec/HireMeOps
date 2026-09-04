# End-to-end data-path performance validation

## Summary

This change set removes the major database and IPC performance bottlenecks identified in
`TODO.md` while preserving result semantics. Adjacent CV, provider, browser, and export changes
are listed separately so review scope stays explicit.

### Performance-critical changes

- Replace FTS ID-then-fetch with one ranked FTS5 plus `job_posts` join.
- Add bounded job summaries, default page size `50`, hard cap `200`, and keyset pagination.
- Preload search preferences, variants, and discovered jobs before scoring.
- Batch match writes and status updates in one transaction.
- Return CV rewrite metadata for list views; load full rewrite data only for detail views.
- Add query-shape indexes, FTS prefixes, SQLite runtime tuning, WAL observations, and slow-pool
  acquisition timing.

### Supporting refactor

- Add `PRAGMA optimize` at migration, maintenance, and connection-close points.
- Add frontend cursor state, request de-duplication, lightweight rewrite stores, and Command
  Center extraction.
- Add deterministic benchmark, hash-verified baseline snapshot, rollback, and verification logs.

### Adjacent functional scope

- Browser-provider login/session behavior and vendored-resource preparation.
- Certificate, language-aware rewrite, cover-letter, structured export, and LaTeX support.
- Provider UI, CV Library, CV Analysis, Profile Variants, settings, and export controls.

## Baseline and candidate identity

The baseline is pinned, not inferred from the current `HEAD`:

```text
baselineRef:    cfda4b06a51343db960e318a23f16a309bd01a1c
baselineCommit: cfda4b06a51343db960e318a23f16a309bd01a1c
candidateCommit: null (worktree is dirty)
candidateTree:  2778cb691f1be20a9978800af63ab33f5cdfbcac
dirtyWorktree:  true
```

The benchmark creates the old tree with `git archive "$BASELINE_SHA"`; the latest performance
run used a clean temporary clone under `/tmp/hiremeops-old-clone-*`. Focused snapshot files remain
under `reports/todo-performance/original/` with `original.sha256` verification.

Reproduce the performance profile:

```sh
npm run benchmark:changes -- \
  --profile performance --rows 5000 --rewrites 500 \
  --warmup 10 --iterations 30 \
  --baseline-ref cfda4b06a51343db960e318a23f16a309bd01a1c \
  --create-clone --keep-clone \
  --fixture reports/todo-performance/sanitized-fixture.sqlite3 \
  --output reports/todo-performance/benchmark-performance.json
```

`--profile performance` is separate from the smoke default (`2` warmups, `5` samples). Each
timing set records samples, min, p50, p90, p95, p99, max, mean, and population standard deviation.

## Benchmark coverage

Read-path scenarios:

1. FTS ID-then-fetch versus ranked FTS join.
2. Full job rows versus bounded summaries.
3. Deep `OFFSET` pagination versus indexed keyset pagination.
4. Per-row search reads versus preference/variant/job preloading.
5. Full CV rewrite history versus summary metadata.

Write/throughput scenarios:

6. Per-row job import versus one-transaction import.
7. Per-row match/status writes versus one-transaction batch writes.

Every pair checks row count, ordered IDs, required summary fields, and first/last pagination
boundaries. Payload bytes and result hashes are retained. Throughput is reported as rows/sec at a
`1,000`-row batch in the performance run.

## Latest performance profile

Artifact: `reports/todo-performance/benchmark-performance.json`.

| Scenario | Old p50 | Current p50 | Old p95 | Current p95 | Current p99/max | Speedup | Payload reduction |
|---|---:|---:|---:|---:|---:|---:|---:|
| FTS join versus N+1 | 2,000.951 ms | 829.039 ms | 2,198.658 ms | 929.905 ms | 938.387 ms | 2.414x | 31.6% |
| Bounded job summary | 1.585 ms | 0.330 ms | 2.335 ms | 0.482 ms | 0.587 ms | 4.803x | 31.8% |
| Deep keyset versus offset | 7.172 ms | 0.704 ms | 10.223 ms | 1.111 ms | 1.187 ms | 10.188x | 31.7% |
| Search preload versus per-row reads | 7.664 ms | 4.010 ms | 8.951 ms | 5.224 ms | 6.005 ms | 1.911x | 0.0% |
| CV summary versus full history | 11.554 ms | 1.601 ms | 13.613 ms | 2.324 ms | 2.639 ms | 7.217x | 98.3% |

Current timing mean ± standard deviation: FTS `837.870 ± 38.693 ms`; bounded list
`0.334 ± 0.094 ms`; deep keyset `0.770 ± 0.188 ms`; search preload `4.072 ± 0.656 ms`; CV
summary `1.621 ± 0.346 ms`. Full baseline/current min, p90, p99, max, mean, and standard
deviation remain in the JSON artifact.

Throughput results:

| Scenario | Baseline rows/sec | Current rows/sec | Change |
|---|---:|---:|---:|
| Job import | 206,568.891 | 349,528.137 | +69.2% |
| Batched match writes | 188,608.072 | 192,086.055 | +1.8% |

All read and throughput pairs passed semantic-equivalence checks. These are deterministic local
SQLite measurements, not production SLOs.

## Persisted fixture and environment

The run creates a sanitized deterministic persisted fixture at
`reports/todo-performance/sanitized-fixture.sqlite3`.

```text
rows:                 5,000
SHA-256:              0888397fafe8da185d3afb003cec5302040dbad8db7b6eb68238af2c02201bb0
SQLite:               3.51.2 (Node runtime)
SQLx:                 0.9
Node:                 v25.8.0
CPU:                  AMD Ryzen 5 5600GT, 12 logical CPUs
kernel:               7.1.9-arch1-2
page_size:            4096
journal_mode:         WAL
synchronous:          NORMAL
cache_size:           -16384 KiB
mmap_size:            0
temp_store:           2 (memory)
wal_autocheckpoint:   1000
```

Persisted fixture size after checkpoint is `9,670,656` bytes. WAL measured `9,801,512` bytes
before checkpoint and `0` bytes after checkpoint. Current FTS pages use `3,649,536` bytes;
the in-memory baseline/current diagnostic measured `1,019,904` versus `3,649,536` bytes. Prefix
index storage is a known write/storage tradeoff.

The current persisted FTS profile is `30` samples: p50 `912.821 ms`, p95 `1,165.977 ms`, p99
`1,218.232 ms`. Its plan still contains `USE TEMP B-TREE FOR ORDER BY`. FTS is improved but remains
the next profiling target: test `bm25()` ordering, prefix cardinality, result limits, description
weighting, and persisted-cache behavior.

RSS is recorded at harness level per case; maximum observed peak was `211,709,952` bytes. Startup
is also recorded: benchmark CLI startup, `30` samples, p50 `35.842 ms`, p95 `44.184 ms`. This is
not an APP GUI startup measurement. Frontend `dist` size is `5,162,726` bytes; the archive has no
built `dist` directory. Separate release evidence is in
`reports/todo-performance/release-metrics.json`: baseline binary `16,876,872` bytes versus
candidate `21,441,800` bytes, a `4,564,928`-byte (`27.05%`) increase. Release builds took about
`104s` baseline and `160s` candidate. The archive clone received the same generated resource
bundle because that ignored directory is not part of the Git archive.

## Regression budgets

- Read p50/p95/p99: improve versus baseline; investigate any path regression.
- Import and batched-write throughput: target no regression greater than `5%`.
- RSS: record per-case peak and investigate sustained growth greater than `10%`.
- Database, WAL, and FTS size: always record; prefix-index growth is an explicit tradeoff.
- Startup and release binary size: record before selecting final runtime tuning values.
- Final SQLite pool, statement cache, cache, mmap, temp-store, and WAL settings: select from
  repeated measurements, not one local run.

## Verification

Passing evidence:

```text
sha256sum -c reports/todo-performance/original.sha256          all 18 focused files OK
node --test scripts/benchmark-changes.node-test.mjs             3 passed
npm run test                                                    33 Vitest files, 257 tests; 8 Node tests
npm run typecheck                                               exit 0
npm run lint                                                     exit 0
npm run format:check                                            exit 0
npm run build                                                    exit 0
cargo test --manifest-path src-tauri/Cargo.toml --lib          199 passed
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check      exit 0
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings exit 0
git diff --check                                                 exit 0
performance profile                                              7 scenarios, 30 samples, equivalence passed
release-metrics.json                                             baseline/current binary size hashes recorded
```

`node scripts/quality-review.mjs` remains a known repository gate issue: nine files exceed the
existing 1,000-line limit and Lizard is missing in the runner. Jscpd is `4.526%`, below the `5%`
threshold. `npm run verify` reaches that quality-review failure after the native checks. The
oversized files are `automation/shy-mouse.js`, `automation/worker.js`, `src-tauri/src/ai/prompt.rs`,
`src-tauri/src/browser/playwright.rs`, `src-tauri/src/commands/jobs/scrapers.rs`,
`src-tauri/src/commands/profile_variants.rs`, `src-tauri/src/domain/automation.rs`,
`src-tauri/src/domain/cv.rs`, and `src-tauri/src/domain/jobs.rs`; eight were already over limit
at baseline, while `domain/jobs.rs` grew from `899` to `1,018` lines during this work.

## Rollback

Use the hash-verified performance snapshot:

```sh
bash reports/todo-performance/ROLLBACK.sh /tmp/hiremeops-todo-rollback-target
```

The script restores the focused baseline paths and removes additive benchmark artifacts. Keep the
clone, fixture, benchmark JSON, and snapshot until review decisions finish; remove them together
afterward if no longer needed.

## Definition of done

- [x] Baseline commit is explicit and candidate worktree tree SHA is recorded.
- [x] Old tree is cloned from the pinned baseline commit.
- [x] Smoke and 30-sample performance profiles exist.
- [x] Robust latency statistics, throughput, payload, RSS, and semantic checks are recorded.
- [x] Sanitized persisted SQLite fixture, SQLite metadata, WAL/FTS size, and FTS plan are recorded.
- [x] Performance-critical, supporting, and adjacent scope are separated.
- [x] Run release artifact size comparison; real APP startup remains separate from CLI startup.
- [ ] Decide final SQLite tuning values from repeated representative runs.
- [ ] Resolve or document repository quality-gate exceptions before merge.
