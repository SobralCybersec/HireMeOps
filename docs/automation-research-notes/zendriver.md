# Zendriver — research notes (for HireMeOps)

Repo read: `/tmp/.../scratchpad/research/zendriver` @ `f0bd943` (v0.15.5, Development Status: Alpha).

---

## 1. What it is / language / lineage / license / maintenance

- **Language:** Python, async-first (`asyncio`). `requires-python = ">=3.10"` — `pyproject.toml:19`.
- **What:** "blazing fast, async-first, undetectable webscraping/web automation framework implemented using the Chrome Devtools Protocol" — `README.md:14`. Drives a **real** Chrome/Brave over CDP, no Selenium/WebDriver.
- **Lineage:** Direct **fork of `ultrafunkamsterdam/nodriver`** (`README.md:9`), which itself is the successor to `undetected-chromedriver` (same author, ultrafunkamsterdam). Fork rationale: nodriver's upstream restricts contributions; zendriver merges unmerged bugfixes + adds ruff/mypy — `README.md:60-70`. You can still see the nodriver/uc heritage in the code: temp profile prefix `uc_` (`config.py:284`), `create_from_undetected_chromedriver()` helper (`util.py:99`).
- **License:** **AGPL-3.0** — `LICENSE:1`, `pyproject.toml:7,12`. This is the big one: AGPL is copyleft with a network-use clause. Bundling a zendriver sidecar into HireMeOps (a distributed desktop app) would arguably subject the combined work to AGPL obligations. Legal friction for a shipped product.
- **Deps are thin** (`pyproject.toml:20-27`): `websockets`, `mss` (screenshot/monitor geometry), `deprecated`, `emoji`/`grapheme` (text matching), `asyncio-atexit`. No Playwright, no Selenium. CDP command bindings are **code-generated** into `zendriver/cdp/*.py` (see `scripts/generate_cdp.py`) — one module per CDP domain, full protocol coverage.
- **Maintenance signals:** author Stephan Lensky (`pyproject.toml:6`), org `cdpdriver/`, active version bumps, JetBrains OSS sponsorship, codecov + CHANGELOG (Keep-a-Changelog format). Reasonably alive but still labeled **Alpha**.

## 2. Stealth approach — why no-WebDriver / pure CDP evades detection

The core thesis: **it never injects the WebDriver/ChromeDriver automation layer**, so the classic tells are simply absent:
- No `navigator.webdriver = true`, no ChromeDriver `cdc_*` DOM properties, no `--enable-automation` / `AutomationControlled` blink feature — because there is no chromedriver process at all. It launches a stock Chrome with plain flags (`config.py:119-137`, `config.py:198-229`) and talks raw CDP over a websocket.
- **Zendriver does almost NO active JS patching.** Searching `core/` for stealth shims turns up basically nothing. The only script injection is in **expert mode** (`connection.py:692-708`) and it's not even anti-detection — it forces `attachShadow` to `mode:"open"` for debugging. Default runs inject zero page scripts.
- The one runtime fixup: **headless UA cleanup** (`connection.py:671-690`) — reads `navigator.userAgent` and, if headless, strips the literal `"Headless"` substring via `Network.setUserAgentOverride`. That's the extent of "spoofing".
- Default launch flags lean on coherence, not lies: `--disable-features=...AutomationControlled` is NOT present, but it disables blink automation infobars (`--disable-infobars`), WebRTC IP leak (`--webrtc-ip-handling-policy=disable_non_proxied_udp`, `config.py:221-225`, default `disable_webrtc=True`), and avoids `site-per-process` so iframes stay reachable.
- **Takeaway that matches your `antibot-strategy-2026` memo:** zendriver's whole edge is *coherence* — a real browser profile with no automation surface — NOT fingerprint spoofing. It does the same thing your patchright setup does; the "undetectable" claim is about the absence of the WebDriver stack, not about magic evasion. Cloudflare handling (`core/cloudflare.py`) is just DOM-walking to find the challenge shadow-root/iframe and clicking it, not a bypass.

## 3. CDP usage — connect vs attach (THE reuse question)

**How it connects (two modes, decided in `browser.py:314-404`):**
1. **Launch mode (default):** picks a free port (`browser.py:331-332` → `util.free_port()`), spawns Chrome with `--remote-debugging-host/--remote-debugging-port` (`config.py:217-220`), then polls the DevTools **HTTP** endpoint `http://host:port/json/version` (`browser.py:438-447`, `HTTPApi` at `browser.py:850-881`) to read `webSocketDebuggerUrl`, then opens the browser-level websocket (`browser.py:404`).
2. **Attach mode (the interesting one):** if you pass **both `host` and `port`**, `connect_existing = True` and **it does NOT spawn a browser** (`browser.py:327-333`, `browser.py:371-373`). It skips the executable check and just hits the same `/json/version` HTTP endpoint of the *already-running* Chrome, then rides its websocket. Public entry: `zd.start(host=..., port=...)` — documented at `util.py:65-69`: *"if both host and port are provided, zendriver will not start a local chrome browser!"*

**Can it attach to a browser patchright already launched? Conditionally YES, with one hard requirement:**
- The attach path needs the target Chrome to expose the **DevTools HTTP endpoint** on a TCP port (`/json/version`). That only exists if Chrome was launched with **`--remote-debugging-port=<n>`**.
- Patchright/Playwright by default launch Chromium with **`--remote-debugging-pipe`** (a stdio pipe, no TCP port, no `/json` HTTP server). If your worker launches Chromium that way, zendriver **cannot** attach — there's no HTTP endpoint to query.
- **Fix if you want reuse:** launch your patchright Chromium with an explicit `--remote-debugging-port=9222` (and it must bind a real port). Then `zd.start(host="127.0.0.1", port=9222)` attaches and both stacks share the same browser + the same per-profile cookie jar (cookies live in Chrome's `--user-data-dir`, which zendriver reads via `Storage.getCookies`, `browser.py:703`). Websocket connect is a plain `websockets.connect(ws_url)` — `connection.py:425`.
- Caveat: two CDP clients on one browser can race on domain enable/disable and target discovery (`browser.py:406-435` aggressively takes over target autodiscovery). Coordinating a shared browser between patchright and zendriver is fragile. Attaching zendriver to a *dedicated* Chrome you spawn with a debug port is clean; attaching to patchright's own managed browser is asking for contention.

## 4. PDF / print / HTML / screenshots — exact API

All on `Tab` (`core/tab.py`), all thin wrappers over generated CDP calls:
- **`print_to_pdf(filename, **kwargs)`** — `tab.py:1430-1449`. Calls `self.send(cdp.page.print_to_pdf(**kwargs))` (i.e. **`Page.printToPDF`** over CDP, defined `cdp/page.py:2753`), gets base64 `data`, `base64.b64decode`, writes bytes. `**kwargs` pass straight through to the CDP params (landscape, printBackground, paperWidth, scale, etc.).
- **`save_screenshot(filename="auto", format="jpeg", full_page=False)`** — `tab.py:1387-1428`, and **`screenshot_b64(...)`** — `tab.py:1351-1385`. Uses **`Page.captureScreenshot`** with `capture_beyond_viewport=full_page` (`tab.py:1375-1379`). Returns/writes PNG or JPEG.
- **`save_snapshot(filename="snapshot.mhtml")`** — `tab.py:1334-1349`. Uses **`Page.captureSnapshot`** → single-file **MHTML** archive of the page. This is your "HTML capture" primitive (full DOM + resources inline).
- **`get_content()`** — `tab.py:986` returns live serialized HTML of the doc.
- **Downloads:** `set_download_path()` (`tab.py:1451`), `download_file()` (`tab.py:1273`), and an `expect_download()` context manager (see `examples/expect_download.py`).

## 5. Docker support

Yes, first-class — but oriented at **non-headless GPU Chrome via a Wayland/VNC base image**, not a slim headless container:
- Provided **`docker-compose.yml`** + **`tests/Dockerfile`** (repo root). Base image `ghcr.io/stephanlensky/swayvnc-chrome:latest` (Sway WM + wayvnc), `uv` for deps (`tests/Dockerfile:1-44`).
- Compose exposes **VNC on 5911** (`docker-compose.yml:6-7`), needs `privileged: true` and a `/dev/dri/renderD128` render group GID for GPU accel (`docker-compose.yml:14,23`). Env for resolution + VNC auth.
- README points to a separate template repo **`cdpdriver/zendriver-docker`** for running "real, GPU-accelerated browser (not headless) in Docker (Linux-only)" — `README.md:16,23`.
- Note: the in-repo Docker setup is really their **test harness** (entrypoint `./scripts/test.sh`, `ZENDRIVER_PAUSE_AFTER_TEST` VNC-debug hook, `tests/Dockerfile:44`), not a production image. Plain `headless=True` (`config.py:211` → `--headless=new`) also works in any container without their Wayland stack; the VNC image is for when you specifically want visible/GPU Chrome — which aligns with your `focus-safe-automation` "LO watches" requirement.

## 6. Embedding a live view / screencast

- **No high-level screencast wrapper in `core/`** — grep of `core/` for `screencast` returns nothing. But the **CDP bindings exist**: `cdp.page.start_screencast(format_, quality, max_width, max_height, every_nth_frame)` at `cdp/page.py:3293`, `cdp.page.stop_screencast()` at `cdp/page.py:3382`, `cdp.page.screencast_frame_ack()` at `cdp/page.py:2912`, and the `Page.screencastFrame` event class `cdp.page.ScreencastFrame` at `cdp/page.py:4132`.
- So you'd embed a live view by hand: `await tab.send(cdp.page.start_screencast(format_="jpeg", quality=...))`, register a handler on `cdp.page.ScreencastFrame` (base64 JPEG per frame), ack each with `screencast_frame_ack(session_id)`, and stream frames to your UI (canvas/img). Same `Page.startScreencast` mechanism Playwright/CDP-inspector use.
- The websocket endpoint itself is reachable (`browser.websocket_url`, `browser.py:144-149`; per-tab ws URLs built at `browser.py:230-238`) so a UI could alternatively speak CDP directly.
- Reality check: zendriver gives you the CDP plumbing for screencast but zero UI glue — you're building the frame pump either way, whether in Python or Node.

## 7. Verdict — Python sidecar vs. borrow the techniques in Node

**Recommendation: do NOT add a Python zendriver sidecar. Borrow the technique, stay in Node.**

Reasons, specific to HireMeOps:
1. **Stack cost.** HireMeOps is Rust (Tauri) + Node (patchright worker). Zendriver is Python/asyncio. A sidecar means shipping a Python runtime + AGPL dependency inside a Tauri desktop app, plus an IPC bridge Node↔Python. That's a whole new process class and packaging headache (your `windows-build`/AppImage notes show packaging is already painful).
2. **AGPL-3.0** (`LICENSE:1`) is a genuine licensing hazard for a distributed product. Patchright (your current lib) doesn't carry that.
3. **No capability gap to close.** Everything zendriver "does" you already have via patchright/CDP in Node:
   - `Page.printToPDF`, `Page.captureScreenshot`, `Page.captureSnapshot` (MHTML), `Page.startScreencast` are **raw CDP methods** — callable from patchright via `page.context.newCDPSession(page)` / `session.send('Page.printToPDF', {...})`. Zendriver is literally a thin base64-decode wrapper around these (`tab.py:1445`, `tab.py:1375`).
   - Its stealth "secret" is *not using WebDriver* + coherence — which is exactly what patchright already delivers. There's no evasion code to port (§2); the headless-UA fix (`connection.py:687`) is one `Network.setUserAgentOverride` call you can replicate in three lines.
4. **What's genuinely worth stealing (ideas, not code):**
   - The **attach-by-`/json/version`-then-websocket** pattern (`browser.py:438-447`) if you ever want a second tool to ride your existing Chrome — but you'd implement it in Node against your own `--remote-debugging-port`.
   - The **MHTML `captureSnapshot`** approach for archiving job-post pages as single self-contained files (better than raw HTML for your DOM-capture diagnostics in `automation/captures/`).
   - The **Wayland/VNC GPU-Chrome Docker recipe** (`tests/Dockerfile`, zendriver-docker repo) as a reference if you ever containerize the visible-browser flow — that's infra, reusable regardless of language.
   - Confirmation of your **`antibot-strategy-2026`** stance: zendriver, the reference "undetectable" lib, ships almost no spoofing. Coherence wins. Don't chase fingerprint hacks.

**One-line answer:** Zendriver is a nodriver/undetected-chromedriver-lineage AGPL Python CDP library whose PDF/screenshot/screencast are one-line CDP wrappers and whose stealth is "no WebDriver stack" — so add nothing; call the same CDP methods from your existing Node/patchright worker, and only cherry-pick the MHTML-snapshot idea, the attach-via-remote-debugging-port pattern, and the GPU-Chrome Docker recipe.
