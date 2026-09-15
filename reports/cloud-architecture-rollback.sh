#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
base_ref=${1:-HEAD}

tracked=(
  README.md
  automation/core/browser/browser-launch.js
  automation/core/worker/perf.js
  automation/core/worker/worker-auth.js
  automation/package-lock.json
  automation/package.json
  automation/worker.js
  docker/Dockerfile.worker
  package.json
  scripts/quality/check-file-size.mjs
  scripts/quality/quality-review.mjs
  src-tauri/Cargo.lock
  src-tauri/Cargo.toml
  src-tauri/src/browser/playwright.rs
  src-tauri/src/browser/playwright_driver_base.rs
  src-tauri/src/browser/playwright_worker.rs
  src-tauri/src/commands/mod.rs
  src-tauri/src/commands/profile_variants.rs
  src-tauri/src/lib.rs
  src-tauri/src/storage/mod.rs
  src-tauri/src/storage/postgres.rs
  src/pages/command-center/CommandCenter.css
  src/pages/command-center/CommandCenterVariant.tsx
  src/types/domain.ts
)
git restore --source "$base_ref" --staged --worktree -- "${tracked[@]}"

untracked=(
  automation/cloud-memory.mjs
  automation/cloud-memory.node-test.mjs
  automation/cloud-runner-contract.mjs
  automation/cloud-runner.mjs
  automation/cloud-runner.node-test.mjs
  automation/core/worker/worker-auth.test.js
  automation/core/worker/worker-storage.js
  automation/core/worker/worker-storage.test.js
  docker/Dockerfile.cloud-worker
  docs/CLOUD_BROWSER.md
  reports/cloud-memory-host-synthetic.json
  src-tauri/migrations-postgres/0002_browser_sessions.sql
  src-tauri/src/commands/browser_sessions.rs
  src-tauri/src/storage/postgres_browser_sessions.rs
  src-tauri/src/storage/session_crypto.rs
  src/pages/command-center/CloudSessionPanel.css
  src/pages/command-center/CloudSessionPanel.tsx
)
git rm --cached --ignore-unmatch -- "${untracked[@]}" >/dev/null
rm -f -- "${untracked[@]}"
printf 'cloud architecture worktree rollback complete against %s\n' "$base_ref"
