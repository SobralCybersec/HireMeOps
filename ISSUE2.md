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
candidateTree:  c4e2a8a8afa6d7fd84e038efbabafd26a1e71e78
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
| FTS join versus N+1 | 1,957.811 ms | 843.030 ms | 2,175.685 ms | 930.650 ms | 964.193 ms | 2.322x | 31.6% |
| Bounded job summary | 1.593 ms | 0.273 ms | 2.007 ms | 0.573 ms | 0.699 ms | 5.835x | 31.8% |
| Deep keyset versus offset | 6.196 ms | 0.577 ms | 6.942 ms | 0.726 ms | 0.952 ms | 10.738x | 31.7% |
| Search preload versus per-row reads | 8.126 ms | 4.228 ms | 9.315 ms | 5.421 ms | 6.274 ms | 1.922x | 0.0% |
| CV summary versus full history | 13.531 ms | 1.448 ms | 17.253 ms | 2.080 ms | 2.085 ms | 9.345x | 98.3% |

Current timing mean ± standard deviation: FTS `846.273 ± 54.510 ms`; bounded list
`0.315 ± 0.110 ms`; deep keyset `0.593 ± 0.096 ms`; search preload `4.320 ± 0.588 ms`; CV
summary `1.512 ± 0.252 ms`. Full baseline/current min, p90, p99, max, mean, and standard
deviation remain in the JSON artifact.

Throughput results:

| Scenario | Baseline rows/sec | Current rows/sec | Change |
|---|---:|---:|---:|
| Job import | 203,998.368 | 337,837.838 | +65.6% |
| Batched match writes | 199,163.513 | 202,634.245 | +1.7% |

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

The current persisted FTS profile is `30` samples: p50 `893.872 ms`, p95 `1,169.085 ms`, p99
`1,194.335 ms`. Its plan still contains `USE TEMP B-TREE FOR ORDER BY`. FTS is improved but remains
the next profiling target: test `bm25()` ordering, prefix cardinality, result limits, description
weighting, and persisted-cache behavior.

RSS is recorded at harness level per case; maximum observed peak was `211,709,952` bytes. Startup
is also recorded: benchmark CLI startup, `30` samples, p50 `33.130 ms`, p95 `36.134 ms`. This is
not an APP GUI startup measurement. Frontend `dist` size is `5,162,726` bytes; the archive has no
built `dist` directory. Release binary comparison is instrumented but was not run in this profile.

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
npm run test                                                    33 Vitest files, 257 tests; 7 Node tests
npm run typecheck                                               exit 0
npm run lint                                                     exit 0
npm run format:check                                            exit 0
npm run build                                                    exit 0
cargo test --manifest-path src-tauri/Cargo.toml --lib          199 passed
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check      exit 0
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings exit 0
git diff --check                                                 exit 0
performance profile                                              7 scenarios, 30 samples, equivalence passed
```

`node scripts/quality-review.mjs` remains a known repository gate issue: nine files exceed the
existing 1,000-line limit and Lizard is missing in the runner. Jscpd is `4.532%`, below the `5%`
threshold. `npm run verify` reaches that quality-review failure after the native checks.

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
- [ ] Run release artifact size and real APP startup comparison.
- [ ] Decide final SQLite tuning values from repeated representative runs.
- [ ] Resolve or document repository quality-gate exceptions before merge.
