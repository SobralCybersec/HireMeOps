# Progress

## Current goal

Reproduce and fix the application startup and frontend-to-backend interaction failures that make controls appear inert.

## Files touched

- `PROGRESS.md`
- `src-tauri/src/domain/ai.rs`
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/commands/ai.rs`
- `src/pages/settings/AiProviderForm.tsx`
- `src/pages/settings/AiProviderForm.oauth.test.tsx`
- `README.md`
- `src/lib/devMocks.ts`
- `src/components/AppLayout.tsx`
- `src/components/ApplicationDraftModal.tsx`
- `src/stores/applicationDraftCore.ts`
- `src/stores/useApplicationDraftStore.test.ts`
- `src/pages/JobSearch.tsx`
- `src/stores/useEventStore.ts`
- `src/stores/useEventStore.test.ts`
- `src-tauri/src/commands/applications.rs`
- `src-tauri/src/lib.rs`
- `src/lib/eventBridge.ts`
- `src/pages/ApplicationsQueue.tsx`
- `src-tauri/src/domain/applications.rs`
- `src-tauri/src/domain/automation.rs`
- `src-tauri/src/browser/mod.rs`

## Decisions made

- Preserve all pre-existing working-tree changes.
- Use the existing CodeGraph index before scoped RTK inspection.
- Trace one click end-to-end through its React handler, Tauri IPC command, backend registration, and state/result update before editing.
- Fix only reproducible backend AI integration defects; avoid unrelated frontend or architecture changes.
- Fold a non-secret provider/endpoint namespace into the existing cache hash instead of changing the database schema.
- Include a one-way credential/account fingerprint in that namespace so account switches cannot reuse prior responses.
- Fail fast for unsupported Gemini subscription OAuth rather than guessing the private Cloud Code completion protocol.
- Make the ChatGPT OAuth probe exercise the same Codex Responses adapter used in production.
- Treat the authenticated Codex `/models` response as authoritative; use `gpt-5.6-terra` only as the universal offline/legacy fallback.
- Use exact Codex request slugs (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`), not the API-only `gpt-5.6` alias.
- Require `VITE_ENABLE_MOCKS=true` for screenshot data; a normal browser preview now identifies that no Rust backend is present.
- Expose the existing `ApplicationService::submit` implementation through Tauri and queue drafts from the success modal.
- Wire Job Search's existing Skip and Open URL controls; describe `run_search` as processing imported rows rather than claiming network discovery.
- Deduplicate live events by backend event id to prevent duplicate React keys.
- Make application submission transactional and idempotent, stop queue draining on human handoff, and synchronize review outcomes back to application/job status.
- Run manual-assist Chromium headed so the operator can inspect and confirm the filled form.

## Verified checks

- [x] Confirmed `.codegraph/` exists and queried the AI integration call graph.
- [x] Confirmed the working tree contains extensive pre-existing changes.
- [x] Mapped settings → credential resolution → provider factory → cache → HTTP adapter → domain persistence.
- [x] Added focused regressions for Gemini URL construction, provider/credential cache isolation, concurrent cache misses, unsupported Gemini OAuth, and blank responses.
- [x] `rtk cargo test --manifest-path src-tauri/Cargo.toml ai::tests -- --nocapture` — 24 passed.
- [x] `rtk cargo test --manifest-path src-tauri/Cargo.toml commands::ai::tests -- --nocapture` — 6 passed.
- [x] `rtk cargo test --manifest-path src-tauri/Cargo.toml --lib` — 128 passed.
- [x] `rtk cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --all-targets` — 120 passed.
- [x] `rtk cargo check --manifest-path src-tauri/Cargo.toml --all-targets` — passed without warnings.
- [x] `rtk rustfmt --edition 2021 --check src-tauri/src/domain/ai.rs src-tauri/src/ai/mod.rs src-tauri/src/commands/ai.rs` — passed.
- [x] `rtk git diff --check -- ...` for touched files — passed.
- [x] Confirmed from OpenAI's July 9, 2026 release, Help Center, and Codex 0.144.0 catalogue that GPT-5.6 Sol/Terra/Luna are the current Codex slugs and `gpt-5.1` is retired.
- [x] `rtk npm run typecheck` — passed.
- [x] `rtk npm test` — 18 files, 139 tests passed.
- [x] Focused OAuth model-picker test — 14 passed.
- [x] Scoped ESLint, Prettier, Rustfmt, and `git diff --check` — passed.
- [x] Reproduced `pnpm dev` seeding fake `Searching` state and disabling Start; after the fix Chromium shows the backend warning and no mock `Searching` state.
- [x] `rtk npm test` — 18 files, 142 tests passed after interaction fixes.
- [x] `rtk npm run build` — passed.
- [x] `rtk cargo test --manifest-path src-tauri/Cargo.toml --lib` — 129 passed after command registration and idempotency coverage.
- [x] Desktop smoke: `rtk timeout 30s npm run tauri dev` started the app, applied migrations, and logged `automation_start` at the Rust command boundary.
- [x] Scoped ESLint/Prettier/Rustfmt/diff checks for this fix — passed.
- [ ] Full-repository ESLint — blocked by 16 pre-existing errors in untouched router/CV/UI utility files.

## Remaining work

- [x] Reproduce the current startup/runtime failure from a clean command invocation.
- [x] Map inert or placeholder controls separately from broken wired interactions.
- [x] Implement the smallest verified frontend/backend fixes.
- [x] Run focused interaction tests, full frontend checks, and backend checks.
- [x] Obtain an independent read-only verification of the final diff.
- [ ] Implement real LinkedIn/Google job discovery; current `run_search` only processes previously ingested rows.
- [ ] Replace the remaining explicit placeholders: profile CRUD, variants, queue retry/export, Run Once/Dry Run, and data cleanup.
- [ ] Connect Cockpit `watchUrl`/embedded preview to the active automation session; headed manual-assist works, but the embedded Evidence Viewer still stays on standby.
- [ ] Add an explicit confirm/reject IPC flow that finalizes pending-review application runs after the operator acts in Chromium.

- [x] Map backend AI provider configuration, request, response, auth, and command-registration paths.
- [x] Reproduce concrete backend failures with narrow tests/checks.
- [x] Implement minimal fixes and focused regression tests.
- [x] Run focused backend tests plus the narrowest broader validation available.
- [x] Review final diff and document any remaining risks.
- [ ] Remove or disable the still-visible Gemini subscription-login option in the frontend until a real Cloud Code completion adapter exists.
- [ ] Decide whether OAuth refresh/keyring errors should propagate instead of being collapsed to a missing credential.
- [x] Validate the new dynamic Codex catalogue and retired-model fallback with focused frontend/Rust tests.
