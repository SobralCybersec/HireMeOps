#!/usr/bin/env bash
#
# Build a PORTABLE Linux (x86_64) distribution of HireMeOps — the mirror of
# build-windows.sh. The Tauri .deb/.rpm/.AppImage do NOT ship the Node
# automation worker (automation/ isn't a bundled resource), so the packaged
# installers give you a UI with no browser automation. This produces the same
# sibling-folder layout the Windows zip uses, which is what locate_worker_script
# (Rust) and the patchright bridge expect at runtime:
#
#   HireMeOps-linux64/
#     HireMeOps                 <- the binary (frontend embedded)
#     automation/*.js           <- worker + human.js + site modules (no tests)
#     resources/                <- LaTeX cvtex + vendored patchright bridge
#     package.json, lock        <- so `npm ci` restores patchright for the worker
#
#   scripts/build-linux.sh          # build the binary
#   scripts/build-linux.sh --tar    # build + pack dist/HireMeOps-linux64.tar.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
REL="src-tauri/target/release"

command -v cargo >/dev/null || {
  echo "error: cargo not found"
  exit 1
}

echo "==> Building frontend (embedded into the binary)"
npm run build

echo "==> Vendoring patchright into resources (bridge runtime dep)"
npm run prepare:playwright

echo "==> Compiling native release binary"
# NO_STRIP mirrors the AppImage fix (Arch's strip is too new); harmless elsewhere.
(cd src-tauri && NO_STRIP=true cargo build --bin hiremeops --release --features real-browser)

echo "==> Built: $REL/hiremeops"
[ "${1:-}" != "--tar" ] && {
  echo "Done. Pass --tar to package a portable folder."
  exit 0
}

echo "==> Staging portable folder"
STAGE="dist/HireMeOps-linux64"
rm -rf "$STAGE"
mkdir -p "$STAGE"

cp "$REL/hiremeops" "$STAGE/HireMeOps"
chmod +x "$STAGE/HireMeOps"

# Automation worker (js only — no tests, captures, or node_modules). The worker
# resolves `patchright` by walking up to $STAGE/node_modules (created by npm ci).
mkdir -p "$STAGE/automation"
find automation -maxdepth 1 -name '*.js' ! -name '*.test.js' -exec cp {} "$STAGE/automation/" \;

# Bundled runtime resources (LaTeX CV render + vendored patchright bridge). The
# bridge finds itself at <exe_dir>/resources/playwright-bridge (resolve_helper_dir).
cp -r src-tauri/resources "$STAGE/resources"

# Node dep manifest so the user restores patchright with one command.
cp package.json package-lock.json "$STAGE/" 2>/dev/null || true

cat >"$STAGE/README-LINUX.txt" <<'EOF'
HireMeOps — portable Linux build (x86_64)

PREREQUISITES (install once, via your package manager):
  1. WebKitGTK 4.1  (Debian/Ubuntu: libwebkit2gtk-4.1-0 ; Arch: webkit2gtk-4.1 ;
     Fedora: webkit2gtk4.1) — the UI webview.
  2. Node.js 20+            https://nodejs.org  (or your distro's nodejs)
  3. Google Chrome / Chromium (or let step below download one)

SETUP (once, in this folder, in a terminal):
  npm ci --omit=dev            # installs patchright for the automation worker
  npx patchright install chromium

RUN:
  ./HireMeOps

Notes:
- The UI is embedded in the binary.
- The automation worker (browser automation) runs via Node; it needs the
  node_modules from "npm ci" above and a Chromium install. Without them the app
  still runs but browser automations won't start.
EOF

echo "==> Packing tarball"
(cd dist && rm -f HireMeOps-linux64.tar.gz && tar -czf HireMeOps-linux64.tar.gz HireMeOps-linux64)
echo "==> Done: $ROOT/dist/HireMeOps-linux64.tar.gz"
du -sh "$ROOT/dist/HireMeOps-linux64.tar.gz"
