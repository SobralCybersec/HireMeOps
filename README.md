# HireMeOps

A **local-first job-search automation cockpit** — a desktop app that imports your CV,
builds tailored profile variants, deterministically scores and matches job posts, drafts
applications, and (in later phases) drives browser automation — all on your own machine
with an offline-first SQLite store.

> Stack: **Tauri 2** (Rust backend) + **React 19 / TypeScript / Vite 7** frontend, with an
> embedded **SQLite** database (via `sqlx`) and an event-bus / trait-based service layer.

---

## Status

Local-first desktop app; builds clean (`cargo check`, `tsc --noEmit`, `vite build`, `cargo build`).

| Phase | Area | State |
|------:|------|-------|
| 1 | Foundation — scaffold, 30-table SQLite schema, migrations, storage, event bus, settings, portable mode, automation stubs + emergency stop | ✅ Complete |
| 2 | Profiles & CV — profile CRUD + variants, CV import / parse / analyze service | ✅ Complete |
| 3 | Jobs & matching — deterministic, rule-based scoring engine, job posts, `job_matches`, application-draft stubs | ✅ Complete |
| — | Frontend redesign — design system (`DESIGN_SYSTEM.md`), theme tokens, component + page library, effects/motion layer with reduced-effects wiring, accessibility pass | ✅ Complete |
| 4 | AI providers — provider abstraction + response cache behind `CvService::analyze` and `ApplicationService::draft`; augments match explanations only | ✅ Complete |
| 5 | Browser automation — Playwright/Chromium sidecar: real browser sessions, LinkedIn Easy Apply, evidence capture | ✅ Complete |
| 6 | Automation cockpit — `AutomationSupervisor`: queue, retries, evidence, emergency stop wired end-to-end | ✅ Complete |
| 7 | Export / backup — profiles JSON, jobs/applications/audit CSV, `VACUUM INTO` snapshot + validated restore | ✅ Complete |

The **matching engine is deterministic and rule-based** (see `src-tauri/src/matching/`) —
scoring is reproducible and does not depend on any AI provider. AI providers (Phase 4) only
*augment* explanations; they never change the core score.

---

## Architecture

```
src-tauri/                 Rust backend (Tauri 2)
  src/
    commands/              Tauri command handlers (jobs, automation, profiles, cv, settings, …)
    domain/                Service layer: ai, applications, automation, cv, jobs (trait-based)
    matching/              Deterministic scorer + explanation builder
    storage / event bus    Persistence + in-process event bus
  migrations/0001_init.sql 30-table SQLite schema (+ later migrations)
  Cargo.toml               tauri 2, sqlx 0.9 (sqlite), tokio, serde, uuid, time, tracing, directories

src/                       React 19 + TS frontend
  components/              Design-system components (Button, Card, Badge, Chart, Toolbar, …)
  pages/                   Dashboard, Profiles, CV Library/Analysis, Job Search,
                           Applications Queue, Automation Cockpit, Settings, Logs
  stores/                  Zustand stores (settings, theme, automation, …)
  styles/theme.css         Design tokens (see DESIGN_SYSTEM.md)
```

Key design docs live at the repo root: `HireMeOps_IMPLEMENTATION_SPEC.md`,
`HireMeOps_FRONTEND_SPEC.md`, `DESIGN_SYSTEM.md`, and `CONTEXT.md`.

---

## Development

Prerequisites: Rust toolchain, Node + `pnpm`, and the Tauri 2 system dependencies.

```bash
pnpm install            # install frontend deps

pnpm tauri dev          # run the full desktop app (Vite + Rust)
pnpm dev                # frontend only (Vite dev server on http://localhost:1420)
pnpm build              # tsc && vite build (frontend production build)
pnpm tauri build        # bundle the desktop app

pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint .

cd src-tauri && cargo check     # type-check the Rust backend
cd src-tauri && cargo build     # build the Rust backend
```

The SQLite database and settings are stored per-user; **portable mode** keeps them
alongside the executable instead.

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
