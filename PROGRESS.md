# Progress

Current goal: Fix CodeQL security alerts for sanitization, URL host checks, regex anchors, and CI permissions.

Files touched:
- .github/workflows/ci.yml
- automation/gupy.js
- automation/infojobs.js
- automation/upwork-jobs.js
- automation/worker.js
- src-tauri/resources/playwright-bridge/index.mjs
- PROGRESS.md

Decisions made:
- Added top-level GitHub Actions `permissions: contents: read`.
- Replaced URL substring trust checks with URL hostname parsing helpers.
- Anchored remaining URL/domain regex predicates.
- Replaced sequential Upwork entity unescaping and tag regex stripping with state-based tag removal plus one-pass entity decoding.

Verified checks:
- [x] `rtk npm run lint` passed
- [x] `rtk npm run build` passed
- [x] `rtk npm run test` passed (32 files, 252 tests)
- [x] `rtk sh -c 'for f in automation/upwork-jobs.js automation/gupy.js automation/infojobs.js automation/worker.js src-tauri/resources/playwright-bridge/index.mjs; do node --check "$f" || exit 1; done'` passed
- [x] Scoped grep found no remaining targeted substring/domain-regex patterns in touched source files

Remaining work:
- [ ] Re-run CodeQL in GitHub to confirm alerts close
