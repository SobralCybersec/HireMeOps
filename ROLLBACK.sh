#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-src-tauri/src/ai/prompt.rs}"
BACKUP="${2:-/tmp/hiremeops-cv-transaction/prompt.rs.original}"
cp "$BACKUP" "$TARGET"
sha256sum "$TARGET"
