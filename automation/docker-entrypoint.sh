#!/usr/bin/env bash
# Bring up a virtual display, then hand off to the worker. Headed Chromium needs a display; Xvfb
# gives it one without a physical screen. NEVER run the worker headless (evasion collapses).
set -euo pipefail

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 1 40); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.2
done
export DISPLAY=:99

# dumb-init reaps zombie Chromium processes and forwards signals to the worker (PID-1 hygiene).
exec dumb-init -- "$@"
