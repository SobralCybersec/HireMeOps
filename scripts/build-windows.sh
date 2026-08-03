#!/usr/bin/env bash
#
# Cross-compile HireMeOps for Windows (x86_64) from Linux and, with --zip, pack
# a portable distribution of ONLY the necessary files.
#
#   scripts/build-windows.sh          # build the .exe
#   scripts/build-windows.sh --zip    # build + pack dist/HireMeOps-win64.zip
#
# Why the crate-type swap: mingw's linker overflows on the mobile-only
# cdylib/staticlib exports ("export ordinal too large"). Desktop only needs the
# rlib + bin, so we temporarily drop them and restore on exit.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
TARGET="x86_64-pc-windows-gnu"
CARGO="src-tauri/Cargo.toml"
REL="src-tauri/target/$TARGET/release"

command -v x86_64-w64-mingw32-gcc >/dev/null || {
  echo "error: mingw-w64 not found (need x86_64-w64-mingw32-gcc)"; exit 1; }
rustup target list --installed | grep -qx "$TARGET" || rustup target add "$TARGET"

echo "==> Building frontend (embedded into the exe)"
npm run build

echo "==> Cross-compiling $TARGET (rlib-only for mingw)"
cp "$CARGO" "$CARGO.winbak"
trap 'mv "$CARGO.winbak" "$CARGO"' EXIT
sed -i 's/^crate-type = .*/crate-type = ["rlib"]/' "$CARGO"
( cd src-tauri && cargo build --bin hiremeops --release --target "$TARGET" --features real-browser )

echo "==> Built: $REL/hiremeops.exe"
[ "${1:-}" != "--zip" ] && { echo "Done. Pass --zip to package."; exit 0; }

echo "==> Packing portable zip"
STAGE="dist/HireMeOps-win64"
rm -rf "$STAGE"; mkdir -p "$STAGE"

cp "$REL/hiremeops.exe" "$STAGE/HireMeOps.exe"
cp "$REL/WebView2Loader.dll" "$STAGE/" 2>/dev/null || true

# Automation worker (js only — no tests, captures, or node_modules).
mkdir -p "$STAGE/automation"
find automation -maxdepth 1 -name '*.js' ! -name '*.test.js' -exec cp {} "$STAGE/automation/" \;

# Bundled runtime resources (LaTeX CV render + vendored patchright bridge).
# Vendor patchright into resources/node_modules first so the AI bridge has its
# runtime dep (mirrors build-linux.sh; harmless if already vendored).
npm run prepare:playwright
cp -r src-tauri/resources "$STAGE/resources"

# Node dep manifest so the user restores patchright with one command on Windows.
cp package.json package-lock.json "$STAGE/" 2>/dev/null || true

cat > "$STAGE/README-WINDOWS.txt" <<'EOF'
HireMeOps — portable Windows build (x86_64)

PREREQUISITES (install once):
  1. Windows 10/11 with the Microsoft Edge WebView2 Runtime (preinstalled on
     current Windows; else get it from Microsoft's "Evergreen" installer).
  2. Node.js 20+            https://nodejs.org
  3. Google Chrome         https://google.com/chrome

SETUP (once, in this folder, in a terminal):
  npm ci --omit=dev            # installs patchright for the automation worker
  npx patchright install chrome

RUN:
  Double-click HireMeOps.exe

Notes:
- The UI is embedded in the .exe. WebView2Loader.dll must stay beside it.
- The automation worker (browser automation) runs via Node; it needs the
  node_modules from "npm ci" above and a Chrome install.
EOF

echo "==> Zipping"
( cd dist && rm -f HireMeOps-win64.zip && zip -qr HireMeOps-win64.zip HireMeOps-win64 )
echo "==> Done: $ROOT/dist/HireMeOps-win64.zip"
du -sh "$ROOT/dist/HireMeOps-win64.zip"
