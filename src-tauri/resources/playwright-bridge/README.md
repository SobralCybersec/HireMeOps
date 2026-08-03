# Playwright bridge (Node engine)

Native port of RustProxyHub's `playwright-bridge` engine. The Rust side
(`src-tauri/src`) spawns `index.mjs` as a child process and talks to it over
newline-delimited JSON-RPC on stdin/stdout.

## One-time setup

Playwright is **not** vendored. Install it into this directory once (and again
whenever `playwright` is bumped), before `tauri build`:

```sh
cd src-tauri/resources/playwright-bridge
npm install            # installs playwright into ./node_modules
npx playwright install # downloads the browser binaries
```

`index.mjs` resolves playwright from `./node_modules/playwright` (and a few
parent `node_modules` as fallback), so installing here is enough. Bundling is
configured in `src-tauri/tauri.conf.json` (`bundle.resources`), which ships
this whole directory — including `node_modules` — with the app.

## Wire protocol

- Request:  `{ "id", "method", "provider", "params" }` (one JSON object per line)
- Response: `{ "id", "result", "error" }`

Providers: `chatgpt`, `gemini`, `mistral`, `zai`, `meta`.

Methods per provider: `init`, `capture_headers`, `manual_login`, `list_models`,
`chat`, `shutdown` (chatgpt + gemini also expose `basic_headers`).

Param keys: `init` → `{ runtime_dir, headless, browser }`;
`capture_headers` → `{ force_new }`; `chat` → `{ model, prompt, web_search }`
(gemini `chat` reads `{ prompt, web_search }`).

## Profiles

On `init` the engine `chdir`s to `runtime_dir` and creates a persistent browser
profile per site as a subfolder: `chatgpt_profile/`, `gemini_profile/`,
`mistral_profile/`, `zai_profile/`, `meta_profile/`.
