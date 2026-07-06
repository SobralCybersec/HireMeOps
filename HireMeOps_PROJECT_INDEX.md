# HireMeOps — Project Artifact Index

This folder contains the first locked project specification set for HireMeOps.

## Files

```txt
HireMeOps_IMPLEMENTATION_SPEC.md
HireMeOps_DATABASE_SCHEMA.md
HireMeOps_FRONTEND_SPEC.md
HireMeOps_AGENTS.md
```

## Current Locked Decisions

```txt
App name: HireMeOps
UI: minimal, dark/light, anime.js/GSAP/Three.js/Chart.js effects
OS: Windows, Linux, macOS from day one
Storage: local SQLite + filesystem
Portable mode: togglable, moves data automatically
Profiles: multiple
CVs: multiple active CVs per profile
Browser sessions: one isolated browser profile per HireMeOps profile
Automation engine: Playwright Chromium persistent context sidecar
First platform: LinkedIn Easy Apply
Auto-fill: yes
Auto-submit: yes, threshold 60%
Needs-review threshold: form-answer confidence below 50%
Retry failures: yes, max 10 attempts
Duplicate jobs: stored separately
Duplicate application prevention: per-profile URL lock
Salary: minimum value configured per profile
Work authorization: Brazil + EU facts in v1
Cover letters: only when required
Google dorks: browser automation, no cache
AI: OpenAI-compatible, Anthropic-compatible, Ollama/local, custom proxy, offline/manual mode
AI cache: yes
Audit logs: 30 days
Automation evidence: 1 day
Backups: database only
Exports: JSON and CSV
Captcha/bot checks: pause for manual user solve, no bypass
Messages to people: never
```

## Build Order

```txt
1. Tauri shell, routing, theme, event bus, SQLite
2. Profiles, facts, CV Library, parser/preview
3. CV Analysis, variants, preferences
4. AI providers and cache
5. Job search, matching, duplicate warnings, URL locks
6. Playwright Chromium sidecar, sessions, LinkedIn Easy Apply
7. Automation queue, retries, evidence, emergency stop
8. Settings, exports, backup/restore, portable move
```

## Research References

```txt
Tauri architecture:
https://v2.tauri.app/concept/architecture/

Tauri WebView versions:
https://v2.tauri.app/reference/webview-versions/

Tauri sidecars:
https://v2.tauri.app/develop/sidecar/

Playwright persistent context:
https://playwright.dev/docs/api/class-browsertype

LinkedIn automated activity policy:
https://www.linkedin.com/help/linkedin/answer/a1340567

LinkedIn prohibited software policy:
https://www.linkedin.com/help/linkedin/answer/a1341387

SQLx:
https://github.com/launchbadge/sqlx

SQLx migrations:
https://docs.rs/sqlx/latest/sqlx/macro.migrate.html

OWASP Password Storage Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

OWASP Cryptographic Storage Cheat Sheet:
https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

Ollama OpenAI compatibility:
https://docs.ollama.com/api/openai-compatibility

Anthropic Messages API:
https://platform.claude.com/docs/en/api/messages
```
