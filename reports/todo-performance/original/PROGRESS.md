# Progress

Current goal: Configure Codex to use local OpenAI-compatible proxy.

Files touched:
- /home/satu/.codex/config.toml
- /home/satu/.codex/config.toml.bak_20260806_proxy
- PROGRESS.md

Decisions made:
- Set active model to `gpt-5.6-sol`.
- Set active model provider to `local_proxy`.
- Added `[model_providers.local_proxy]` with `base_url = "http://127.0.0.1:10531/v1"`, `wire_api = "responses"`, and `requires_openai_auth = false` because proxy needs no API key.

Verified checks:
- [x] `rtk codex --strict-config doctor --summary` loaded config and provider; only failure was `TERM=dumb` in non-interactive shell

Remaining work:
- [ ] Restart Codex session to pick up config
