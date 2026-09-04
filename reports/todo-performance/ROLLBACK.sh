#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="$ROOT/reports/todo-performance/original"
TARGET="${1:-/tmp/hiremeops-todo-rollback-target}"
BASELINE_COMMIT="cfda4b06a51343db960e318a23f16a309bd01a1c"
if [[ "$TARGET" == "$ROOT" ]]; then
  printf 'refusing live worktree target: %s\n' "$TARGET" >&2
  exit 2
fi
paths=(
  PROGRESS.md
  src-tauri/Cargo.toml
  src-tauri/src/commands/cv.rs
  src-tauri/src/commands/jobs/mod.rs
  src-tauri/src/commands/jobs/queries.rs
  src-tauri/src/domain/cv.rs
  src-tauri/src/domain/jobs.rs
  src-tauri/src/lib.rs
  src-tauri/src/storage/db.rs
  src/pages/CvLibrary.tsx
  src/pages/JobSearch.tsx
  src/pages/ProfileVariants.tsx
  src/pages/cv/index.ts
  src/pages/cv/rewrite.ts
  src/pages/cv/types.ts
  src/stores/useJobStore.test.ts
  src/stores/useJobStore.ts
  src/types/domain.ts
)
for path in "${paths[@]}"; do
  mkdir -p "$TARGET/$(dirname "$path")"
  cp "$SOURCE/$path" "$TARGET/$path"
done
rm -f \
  "$TARGET/src-tauri/migrations/0011_performance_paths.sql" \
  "$TARGET/scripts/benchmark-sqlite.sh" \
  "$TARGET/scripts/benchmark-changes.mjs" \
  "$TARGET/scripts/benchmark-changes.node-test.mjs" \
  "$TARGET/ISSUE.md" \
  "$TARGET/reports/todo-performance/benchmark-results.json" \
  "$TARGET/reports/todo-performance/benchmark-performance.json" \
  "$TARGET/reports/todo-performance/sanitized-fixture.sqlite3" \
  "$TARGET/reports/todo-performance/sanitized-fixture.sqlite3-wal" \
  "$TARGET/reports/todo-performance/sanitized-fixture.sqlite3-shm"
printf 'ROLLBACK_COPY_RESTORED=%s BASELINE_COMMIT=%s\n' "$TARGET" "$BASELINE_COMMIT"
