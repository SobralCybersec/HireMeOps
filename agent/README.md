# Agent runtime

`agent/` is a Bun-only development boundary. It is not imported by React and it
does not receive secrets from the webview.

## Responsibilities

- `runtime.ts`: AI SDK `ToolLoopAgent` with a hard max-step limit and cancellation.
- `tools.ts`: typed deterministic stored-job tools with validation and telemetry.
- `exa.ts`: Exa hosted MCP over Streamable HTTP; only search/fetch tools are enabled.
- `untrusted.ts`: external content remains explicitly data, never instructions.
- `research.ts`: bounded query planning from intent and source hints.

Provide a `LanguageModel` and backend handlers from a Tauri-controlled boundary.
Keep `EXA_API_KEY` in the process environment or OS keyring; pass it only as an
`x-api-key` header. Never send it to React or persist it in URLs/logs.

Commands:

```sh
bun run agent:typecheck
bun run agent:smoke
```

Live MCP smoke is opt-in and requires a configured endpoint/key. It calls
`client.listTools()` and closes the returned connection. Set `EXA_MCP_QUERY` to
also exercise `web_search_advanced_exa`; returned content remains untrusted.
