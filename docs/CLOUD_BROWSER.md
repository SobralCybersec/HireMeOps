# Cloud browser execution

Cloud execution is an additional path. Local SQLite, the local profile jar and
the current JSON-lines worker remain unchanged.

## Flow

1. Select a profile in Command Center and click **Open all logins**.
2. Complete login, MFA and any challenge manually in the headed Chromium tabs.
3. Click **Check sessions**. Results come from the existing platform probes.
4. Click **Sync to cloud**. Rust asks the already-open BrowserContext for
   `storageState({ indexedDB: true })`, encrypts it, and writes only the
   ciphertext to PostgreSQL.
5. Create a `search_runs` row and trigger the configured Northflank Manual Job.
6. The job loads the run by `HIREMEOPS_RUN_ID`, restores the state into a
   non-persistent BrowserContext, runs the target operation through the
   allowlisted direct dispatcher, stores results in `shared_jobs`, and saves
   refreshed state.
7. Chromium and the BrowserContext are closed in `finally` cleanup. No cloud
   profile directory is created.

No password, MFA code or browser profile directory is copied to cloud.

## State and encryption formats

- Storage state format: version `1`.
- Contents: Patchright cookies, origins/localStorage and IndexedDB. The
  current implementation does not add a generic sessionStorage layer.
- Encryption format: version `1`, AES-256-GCM, raw PostgreSQL `BYTEA` bytes:
  `[12-byte random nonce][ciphertext][16-byte authentication tag]`.
- `HIREMEOPS_SESSION_ENCRYPTION_KEY` decodes to exactly 32 bytes. Accepted
  encodings: `hex:<64 hex chars>`, `base64:<base64>`, 64-character hex, or
  standard base64.
- Rust (`ring`) and cloud runner (Node `crypto`) use the same format.

The key is read only from the process environment. It is never in React,
localStorage, Docker build args, Git, PostgreSQL or logs.

## Validation layers

`bun run test:cloud-contract` runs deterministic cloud-runner contract tests
with synthetic browser responses. `bun run test:cloud` remains a compatibility
alias. Neither replaces a repeated Northflank canary with the real session,
network and resource limits.

## Environment

Required by desktop sync / PostgreSQL:

```text
HIREMEOPS_DATABASE_URL
HIREMEOPS_SESSION_ENCRYPTION_KEY
```

Required by the Tauri Northflank trigger:

```text
NORTHFLANK_API_TOKEN
NORTHFLANK_PROJECT_ID
NORTHFLANK_JOB_ID
```

Optional:

```text
NORTHFLANK_API_BASE_URL=https://api.northflank.com/v1
HIREMEOPS_DB_MAX_CONNECTIONS=5
HIREMEOPS_DB_MIN_CONNECTIONS=0
HIREMEOPS_MEMORY_REPORT_PATH=/tmp/hiremeops-memory.json
HIREMEOPS_MEMORY_SOFT_LIMIT_RATIO=0.90
HIREMEOPS_CLOUD_OPERATION_TIMEOUT_MS=480000
HIREMEOPS_CLOUD_BLOCK_HEAVY_RESOURCES=0
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-headless-shell
```

The Manual Job receives only:

```text
HIREMEOPS_RUN_ID=<search_runs.id>
```

Never put storage state or cookies in environment variables or command-line
arguments. Use a TLS PostgreSQL URL (for example with `sslmode=require`) when
the database is remote. Northflank Secret Groups should provide the database URL,
encryption key and API token. The React process receives none of them.

For local development, create ignored `.env` at repository root with the
variables above, then load it into the shell. The project does not auto-load
dotenv files:

```bash
set -a; . ./.env; set +a
bun run app
```

The same file can be passed to a local cloud container with
`docker run --env-file .env ...`. Keep real values out of command history and
never add `.env` to Git.

## PostgreSQL ownership

Migration `0002_browser_sessions.sql` adds `browser_sessions` and the
`shared_jobs.search_run_id` link. `browser_sessions` has one row per profile,
opaque encrypted state, format versions, monotonic revision, explicit status,
per-platform status and timestamps. It does not normalize cookies into SQL.

Cloud lifecycle uses existing `search_runs` statuses:
`started`, `completed`, `failed`, `cancelled`.

Profile concurrency is one. Desktop and cloud workers use the same PostgreSQL
advisory-lock key derived from `profile_id`; the lock connection stays open
only for the advisory lock, not for the whole automation transaction.

State writes use optimistic revision checks. A stale writer gets
`session_revision_conflict` and does not overwrite a newer snapshot.

## Commands

Tauri IPC commands:

- `browser_session_status(profileId)` — metadata only.
- `sync_browser_session(profileId)` — local headed context to encrypted SQL.
- `validate_browser_session(profileId)` — probe local jar and update metadata.
- `revoke_browser_session(profileId)` — mark session `revoked` and clear
  platform metadata; ciphertext remains opaque in the row.
- `trigger_cloud_run({ profileId, intent, queryPlan })` — create existing
  `search_runs` row and call Northflank. Response contains only run IDs.

Example `queryPlan` stored in `search_runs`:

```json
{
  "platform": "linkedin",
  "command": "search_jobs",
  "args": {
    "keywords": "backend engineer",
    "location": "São Paulo",
    "page_index": 0
  }
}
```

The cloud runner allowlists operation commands and never accepts arbitrary
JavaScript. It dispatches directly in one Node process; scraper handlers remain
shared with local execution. The desktop `automation/worker.js` JSON-lines IPC
worker remains canonical for Tauri/local automation.

## Northflank job

Build the one-shot image from repository root:

```bash
docker build -f docker/Dockerfile.cloud-worker -t hiremeops-cloud-worker:latest .
```

Configure a Northflank Manual Job to run this image with:

- `HIREMEOPS_DATABASE_URL` from Secret Group;
- `HIREMEOPS_SESSION_ENCRYPTION_KEY` from Secret Group;
- `HIREMEOPS_RUN_ID` as a per-run runtime environment override;
- no persistent volume;
- one worker and one browser profile per job.

The image entrypoint already sets `HIREMEOPS_CLOUD=1` and
`node --max-old-space-size=96`; do not add a second worker command.

The image contains Node, Patchright, `chromium-headless-shell`, fonts and
`dumb-init`.
It excludes Tauri, frontend, AI/MCP dependencies and Xvfb. Chromium is
headless in cloud and uses `--disable-dev-shm-usage` from the shared launch
configuration. The cloud-only launch profile caps renderer fan-out at one and
uses an 800x600 window to protect the memory budget; local launch dimensions
remain unchanged.

The Tauri trigger uses Northflank's documented
`POST /v1/projects/{projectId}/jobs/{jobId}/runs` endpoint and sends only
`runtimeEnvironment.HIREMEOPS_RUN_ID`.

## Local benchmark commands

Build the same image used by the Manual Job, then run synthetic workloads under
the Northflank-equivalent resource limits:

```bash
bun run build:docker:cloud
bun run benchmark:cloud-viewport -- --image hiremeops-cloud-worker:latest
bun run benchmark:cloud-performance -- --image hiremeops-cloud-worker:latest --viewport 800x600
```

The viewport matrix keeps `1024x768`, `900x675` and `800x600` fixed and covers
the current cloud allowlist: LinkedIn, LinkedIn posts, Google, Indeed, Gupy,
Catho, InfoJobs, Upwork, 99freelas, Programathor and GeekHunter. Each row
contains duration, exit code, cgroup peak/current maximum, Node/Chromium PSS,
process count, result count, field validation, pagination, timeout/OOM and
responsive-layout observation.

The repeated performance benchmark runs five sequential navigations by default
and records startup, browser-open, post-navigation, scraping, state-export and
shutdown checkpoints. Override iteration count or viewport for an isolated A/B
run:

```bash
bun run benchmark:cloud-performance -- --iterations 5 --viewport 900x675
```

Read human tables in `reports/quality/viewport-benchmark.md` and
`reports/quality/cloud-performance.md`; use the matching JSON files for CI or
comparison scripts. Synthetic fixtures validate lifecycle and selectors only;
they do not replace manual authenticated portal validation.

## Failure behavior

Missing session, invalid key, corrupted ciphertext, unsupported format,
unknown probe state, login-required, challenge, lock contention and revision
conflict fail explicitly. A failed target probe updates only session metadata;
the encrypted snapshot is not replaced. No automatic MFA or challenge action
exists.

## Memory measurement

The local worker emits opt-in `[perf]` samples. The cloud runner writes a JSON
report with `startup`, `browser-open`, `operation-start`, `post-navigation`,
`scraping-peak`, `state-exported`, `pre-close` and `shutdown` stages. Each
sample records cgroup current/peak/max, `memory.stat`, `memory.events`, Node
RSS/PSS, Chromium PSS by process type and Chromium process count. This measures
the container, not only Node RSS.

Acceptance target: `cgroupPeakMb <= 430` during real search workload, with
512 MB hard limit and 0.2 vCPU. The ~312 MB stretch goal remains future work.
The repository contains instrumentation but a Northflank peak is not
fabricated locally; run the Manual Job with a real synthetic or manually
synchronized session and archive the generated memory report.

## Manual validation

After local tests, use the existing profile jar:

```text
Open all logins -> manual login/MFA/challenge -> Check sessions -> Sync to cloud
-> trigger Manual Job -> inspect search_runs and shared_jobs
```

The first implementation has real probes for LinkedIn, Catho, InfoJobs,
Indeed and Gupy. No additional sessionStorage treatment is enabled until a
portal proves it needs one.
