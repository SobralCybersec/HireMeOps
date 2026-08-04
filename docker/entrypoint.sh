#!/usr/bin/env bash
# Start a virtual display, then hand the process over to the worker.
#
# CRITICAL: stdout is the JSON-RPC + screencast channel the Rust side reads. NOTHING
# but the worker's protocol may touch it. Xvfb's chatter is redirected to /dev/null;
# Chromium's own noise and any worker debug go to stderr (inherited by the app).
set -euo pipefail

# Headed-under-Xvfb (not headless) — headless Chromium is an instant tell on the hard
# sites. 1920x1080x24 because 800x600 / tiny screens are themselves a fingerprint.
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99

# Wait for the display to actually accept connections (poll, don't guess with sleep).
for _ in $(seq 1 50); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.1
done

# `exec` so node BECOMES pid 1's child under tini (--init): it receives SIGTERM
# directly on `docker stop` / when the Rust child handle drops, and its stdin/stdout
# are the container's stdin/stdout with nothing buffering in between.
exec node /app/automation/worker.js
