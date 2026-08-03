# Reproducible runner for the HireMeOps patchright worker (worker.js) — for CI / headless hosts.
# The Tauri GUI stays native on the desktop; this containerizes ONLY the automation worker.
#
# Hard rule: the worker runs HEADED under Xvfb, never --headless. The 2026 benchmark showed patchright
# headless collapses to ~40% anti-bot bypass vs 100% headed; a virtual display keeps it headed with
# no physical screen. The worker talks newline-JSON over stdin/stdout, so run with `-i`.
FROM node:22-bookworm-slim

# System Chromium (the worker launches it via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH), Xvfb for the
# virtual display, and a broad font pack for fingerprint realism (mirrors SeleniumBase's CI image).
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb x11-utils \
      fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-freefont-ttf \
      ca-certificates dumb-init \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PATCHRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DISPLAY=:99 \
    NODE_ENV=production

WORKDIR /app/automation

# Install worker deps only (patchright); the browser download is skipped — we use system Chromium.
# Build context is the automation/ dir (see docker-compose.yml), so paths are relative to it.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . ./
RUN cp docker-entrypoint.sh /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "worker.js"]
