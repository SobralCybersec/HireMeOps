# SeleniumBase — UC Mode / CDP Mode research (for HireMeOps)

Repo on disk: `research/SeleniumBase` — version **4.51.8** (`seleniumbase/__version__.py`).
License: **MIT**, Copyright (c) 2014-2026 Michael Mintz (`LICENSE:1-3`).
Last commit: **2026-07-26** — actively maintained (near-daily releases historically).
Python-only. Deps of note (`requirements.txt`): `mycdp>=1.4.0` (line 15), `websockets` (10-11),
`python-xlib` Linux-only (73), `PyAutoGUI` Linux-only (74).

Two stealth engines: **UC Mode** (older, WebDriver-based) and **CDP Mode** (newer, pure-CDP,
successor). Both share the same captcha-clicking heuristics.

---

## 1. What UC Mode & CDP Mode are + how they evade detection

### UC Mode (Undetected-Chromedriver Mode)
A hardened fork of `undetected-chromedriver`. Three primary tricks (`help_docs/uc_mode.md:309-349`):

1. **Patch the chromedriver binary to rename CDC vars.** Selenium's chromedriver injects
   `window.cdc_adoQpoasnfa76pfcZLmcfl_*` globals that sites trivially detect.
   `seleniumbase/undetected/patcher.py:194 gen_random_cdc()`, `:201 is_binary_patched()`,
   `:205` shows the literal `b"window.cdc_adoQpoasnfa76pfcZLmcfl_"`, `:228/:235` regex-replace
   the `window.cdc_[a-zA-Z0-9]{22}_` pattern with random bytes inside the driver binary.

2. **Launch Chrome first, attach chromedriver after.** Launching *via* chromedriver leaves
   bot-flavored flags; UC connects the driver to an already-running human-looking Chrome
   (`uc_mode.md:325`).

3. **Disconnect/reconnect the chromedriver service during stealthy actions** — the signature
   move. While disconnected the browser cannot be detected as automated (no CDP/WebDriver
   attached), so clicks/navigations scheduled during the gap look human.
   Implemented in `seleniumbase/undetected/__init__.py`:
   - `disconnect()` `:521` → `stop_client()` + `service.send_remote_shutdown_command()` +
     `service._terminate_process()`; sets `_is_connected = False`.
   - `reconnect(timeout)` `:469` → stops service, `time.sleep(timeout)`, `service.start()` `:492`,
     `start_session()` `:494`. Supports `timeout="breakpoint"` `:485-488` (drops to a Python
     `breakpoint()` so a human can act while undetectable).
   - `connect()` `:538`.
   These wrap raw Selenium `service.stop()/start()` + `start_session(capabilities)`
   (`uc_mode.md:327-335`).

Concrete UC-Mode methods (`uc_mode.md:179-212`):
`driver.uc_open(url)`, `uc_open_with_tab(url)`, `uc_open_with_reconnect(url, reconnect_time)`,
`uc_open_with_disconnect(url, timeout)`, `reconnect(timeout)`, `disconnect()`, `connect()`,
`uc_click(selector, ..., reconnect_time)`, `uc_gui_press_key/keys`, `uc_gui_write`,
`uc_gui_click_x_y`, `uc_gui_click_captcha`, `uc_gui_handle_captcha`.

- **Stealthy navigation:** `uc_open_with_reconnect` (`browser_launcher.py:587`) opens the URL with
  JS `window.open("URL","_blank")` (`:610`) — a *new tab chromedriver never touched* — then
  disconnects/reconnects. `driver.get()` is monkeypatched to fall back to this if a pre-flight
  `requests.get()` sees anti-bot; `driver.default_get()` = fast normal load (`uc_mode.md:148, 216-220`).
- **Stealthy click:** `uc_click` schedules the click with JS `setTimeout`, disconnects
  chromedriver, waits, reconnects — click fires while unattached (`uc_mode.md:345-349`).
- Must NOT combine with headless (UC is detectable headless). On Linux use `xvfb=True`
  virtual display (`uc_mode.md:144, 248`).

### CDP Mode (successor)
Drives the browser purely over **Chrome DevTools Protocol via `mycdp`** (a fork of
ultrafunkamsterdam's `nodriver`/`cdp` lib — `cdp_util.py:26 import mycdp as cdp`). No WebDriver in
the loop, which is stealthier because there's no chromedriver process to fingerprint at all
(`examples/cdp_mode/ReadMe.md:23-34`).

- Activated from UC Mode via `sb.activate_cdp_mode()` / `sb.goto(url)`, which **disconnects
  WebDriver** and hands control to CDP (`ReadMe.md:38-44, 119`).
- Can interleave WebDriver + CDP; `sb.reconnect()/disconnect()/is_connected()` toggle
  (`ReadMe.md:103-117`).
- **Pure CDP Mode** (`from seleniumbase import sb_cdp; sb_cdp.Chrome(url)`) — browser launched and
  driven entirely by CDP, WebDriver never present (`ReadMe.md:583-604`). Async variant via
  `cdp_driver.start_async()` (`ReadMe.md:646-655`).
- CDP driver internals live in `seleniumbase/undetected/cdp_driver/`:
  `browser.py, tab.py (75K), connection.py, element.py, cdp_util.py, config.py`. Launch entry
  `cdp_util.start()` `:288`, `start_async()` `:765`. This is essentially vendored+patched nodriver.
- Claims it can even make Playwright stealthy (`ReadMe.md:5`, `examples/cdp_mode/playwright/`).

---

## 2. Captcha handling — KEYLESS, no solver integration

**No third-party solver anywhere.** Grep for `2captcha|anticaptcha|capsolver|deathbycaptcha` across
`seleniumbase/` returns **zero hits**. There are no API keys, no token-submission calls. It solves
by *clicking the checkbox like a human*, relying on stealth to make the click pass. This matches
HireMeOps' own keyless approach (memory: captcha-stealth).

Two independent keyless techniques, both auto-detect CF Turnstile vs Google reCAPTCHA:

### (A) `uc_gui_click_captcha()` — real OS mouse click (PyAutoGUI)
Core: `browser_launcher.py:1349 _uc_gui_click_captcha()`; public wrappers `:1739`
`uc_gui_click_captcha`, `:1749 uc_gui_click_rc` (reCAPTCHA), `:1759 uc_gui_click_cf` (Turnstile).
Flow:
1. Detect captcha type: `_on_a_g_recaptcha_page` `:1339` / `_on_a_cf_turnstile_page` `:1322`
   (string-matches page source for `cf-turnstile-`, `challenges.cloudf`, `onCaptchaSuccess`, etc.).
2. Resolve the checkbox element via a **huge selector fallback chain** `:1434-1533` (dozens of CF
   Turnstile wrapper selectors: `.cf-turnstile-wrapper`, `#challenge-form div > div`,
   `[data-testid*="challenge-"] div`, `ngx-turnstile div:not([class])`, ...). Left-aligns
   center/right-aligned widgets via injected JS so coords are predictable (`:1543-1619`).
3. Compute **screen** coordinates: `get_gui_element_position()` `:1218` (viewport→screen math) plus
   hardcoded checkbox offsets — CF: `(i_x+28, i_y+32)` Linux / `+22` Windows (`:1654-1658`);
   reCAPTCHA: `(i_x+29, i_y+35)` (`:1638-1639`).
4. **Disconnect chromedriver** (`driver.disconnect()` `:1675`, or `uc_open_with_disconnect` if a CF
   Ray-ID footer is present `:1670`).
5. **PyAutoGUI real mouse:** `_uc_gui_click_x_y()` `:1234` → `pyautogui.moveTo(x,y,timeframe,
   pyautogui.easeOutQuad)` (`:1248` human-eased curve) + `pyautogui.click(x,y)` `:1253`. This is an
   **OS-level input event outside the browser's JS visibility**, so it registers as a trusted user
   gesture and the driver isn't attached when it lands. `reconnect()` afterward.
   `retry`/`blind` args reload+retry at last-known coords (`uc_mode.md:254-256`).

### (B) `uc_gui_handle_captcha()` — keyboard Tab+Space (PyAutoGUI)
`browser_launcher.py:1769 _uc_gui_handle_captcha_`, wrappers `:1977/1981/1985`.
Instead of a mouse click, it `pyautogui.hotkey("shift","tab")` to reset focus (`:1907`), then
presses Tab up to 34 times checking `js_utils.get_active_element_css` until the checkbox is focused
(`:1912-1925`), disconnects, and `pyautogui.press(" ")` (`:1957/1960`). Docs say click-mode is
stealthier on Linux servers (`uc_mode.md:94, 123`).

### (C) CDP-Mode `solve_captcha()` — the portable one
`sb_cdp.py:2602 solve_captcha()` → `click_captcha()` `:2605` → `__click_captcha(use_cdp=True)` `:2613`.
`gui_click_captcha()` `:2609` is the PyAutoGUI fallback (`use_cdp=False`).
Handles more captcha types than UC mode: CF Turnstile, Google reCAPTCHA
(`__gui_click_recaptcha`), **Incapsula/hCaptcha** (`_on_an_incapsula_hcaptcha_page` →
`__cdp_click_incapsula_hcaptcha`), **DataDome slider** (`__gui_slide_datadome_captcha`), and
**Friendly Captcha** (`:2619-2632`). Same selector-fallback data as UC mode (`:2636-2684`). With
`use_cdp=True` the click is dispatched **through CDP** (no OS input, no real mouse) — this is the
version that ports cleanly to a Node/CDP stack.

`pyautogui` is an optional dep, installed at runtime if a GUI method is called
(`install_pyautogui_if_missing`; `ReadMe.md:88`). On Linux it must reconfigure its X11 display each
call: `get_configured_pyautogui()` `:1164` rebuilds `Xlib.display.Display(os.environ['DISPLAY'])`.
All GUI actions are serialized under a `FileLock(PYAUTOGUILOCK)` for multiprocess safety (`:1387`).

---

## 3. Docker

`Dockerfile` (root, 156 lines):
- Base `ubuntu:24.04` `:2`.
- **Fingerprint/font hardening** `:24-42` — installs a big font set (liberation, noto-color-emoji,
  freefont, dejavu, ubuntu, roboto, open-sans, lato...) so headless/container fingerprints look like
  a real desktop.
- Chrome installed from Google's `.deb` `:86-89`; chromedriver via `seleniumbase get chromedriver
  --path` `:140`; also `seleniumbase get cft` (chrome-for-testing) + `get chromium` `:134-135`.
- Python 3.13 `:97`, then `pip install .` + `pip install pyautogui` + `pip install playwright`
  `:131-133`.
- **Headless-in-container = Xvfb virtual display, not `--headless`:** `ENV DISPLAY=":99"` `:145` and
  `Xvfb :99 -screen 1 1920x1080x16 -nolisten tcp &` `:146`. Also `x11vnc` for viewing `:69`. This is
  the documented pattern because UC/CDP stealth + PyAutoGUI both break under true headless.
- Entrypoint `integrations/docker/docker-entrypoint.sh` `:151-154`.
- GitHub-Actions scraping (also uses Xvfb) is a first-class use case (`ReadMe` CDP video links).

---

## 4. PDF / print / HTML / screenshot capture

CDP-Mode (`sb_cdp.py`) and the async tab API (`cdp_driver/tab.py`):
- `save_page_source(name, folder)` `sb_cdp.py:3679` — writes `get_page_source()` `:1616` to `.html`,
  injecting `<base href>` + charset so it renders offline (`:3693-3707`). `save_as_html` alias `:3709`.
- `save_screenshot(name, folder, selector)` `:3713` → async `page.save_screenshot()`
  (`tab.py:1191`, CDP `Page.captureScreenshot`); per-element screenshots via `select(selector)`.
- `print_to_pdf(name, folder)` `:3724` → `page.print_to_pdf()` `tab.py:1248`, which sends the **raw
  CDP `Page.printToPDF`** command (`tab.py:1273 await self.send(cdp.page.print_to_pdf())`) and
  base64-decodes to disk (`:1276-1279`). `save_as_pdf` alias `:3730`.
- `*_to_logs` variants auto-number into `latest_logs/`: `save_as_pdf_to_logs` `:3733`,
  `save_screenshot_to_logs` `:3755`, `save_page_source_to_logs` `:3785`.
- Full method list `examples/cdp_mode/ReadMe.md:563-573` and async `:709-715`.

Takeaway: nothing proprietary — PDF is literally `Page.printToPDF` over CDP, which HireMeOps can
already issue directly.

---

## 5. CDP-Mode internals & portability to Node

- CDP Mode = **vendored fork of nodriver** (`seleniumbase/undetected/cdp_driver/*`) talking raw CDP
  over a websocket via `mycdp` (`cdp_util.py:26`). It is *pure CDP*, exactly like nodriver — Node
  equivalents are `chrome-remote-interface`, CDP-session in Playwright/patchright, or `puppeteer`'s
  `CDPSession`. HireMeOps already speaks CDP through patchright, so the transport layer is a
  non-issue.
- **What ports cleanly to Node:**
  - The captcha **selector fallback tables** (`browser_launcher.py:1434-1533`,
    `sb_cdp.py:2636-2684`) — pure data, language-agnostic. Years of accumulated CF Turnstile /
    reCAPTCHA / hCaptcha / DataDome wrapper selectors.
  - The **coordinate offset constants** for the checkbox (CF `+28/+32`, RC `+29/+35`) and the
    left-align JS normalization.
  - The **CDP-native click** path (`solve_captcha` `use_cdp=True`) → replicate with
    `Input.dispatchMouseEvent` at computed coords.
  - `Page.printToPDF`, `Page.captureScreenshot` calls — trivial.
- **What does NOT port** (Python-bound): the PyAutoGUI OS-level mouse/keyboard input, the
  Xlib display juggling, and the chromedriver-service disconnect (HireMeOps has no chromedriver —
  patchright is CDP-native, so "disconnect WebDriver" has no analog; the equivalent is simply not
  attaching a detectable automation channel, which patchright already handles).

---

## 6. Maintenance / activity / license
- **MIT** (`LICENSE`), single strong maintainer (Michael Mintz).
- **Very active:** v4.51.8, last commit 2026-07-26, frequent releases. Large example corpus
  (`examples/cdp_mode/` has per-anti-bot demos: Cloudflare, DataDome, Kasada, PerimeterX/Akamai,
  Shape, Incapsula/Imperva). Low bus-factor risk but healthy.
- Cleanly licensed to borrow code/techniques from.

---

## 7. VERDICT for HireMeOps

**Do NOT stand up a Python sidecar.** The only thing a sidecar buys you is the PyAutoGUI *OS-level*
captcha click, and that trick actively fights HireMeOps' design:
- HireMeOps' 2026 anti-bot stance (memory: antibot-strategy-2026, focus-safe-automation) is
  *"coherence wins, don't spoof; CDP input never moves the real mouse; windows stay visible, never
  steal focus."* SeleniumBase's `uc_gui_click_captcha` **moves the real OS mouse**, needs window
  focus + a real/virtual display + known screen coords, and steals the pointer from LO who's
  watching. Direct conflict.
- A sidecar drags in a whole Python runtime, pyautogui, Xlib/Xvfb, a separate chromedriver, and
  IPC — heavy for one feature that undercuts your own philosophy.

**Steal these techniques instead (all portable to patchright/CDP, no Python):**
1. **The captcha selector fallback tables** (`browser_launcher.py:1434-1533`,
   `sb_cdp.py:2636-2684`). Copy them near-verbatim into HireMeOps' captcha module — this is the
   single highest-value, lowest-effort borrow. It's curated anti-bot DOM knowledge you'd otherwise
   reverse-engineer per site.
2. **The CDP-native `solve_captcha(use_cdp=True)` approach** — detect type via page-source strings
   (`_on_a_cf_turnstile_page` `:1322`), resolve the checkbox div (not the iframe), compute center +
   offset, and click via `Input.dispatchMouseEvent`. No OS input, no sidecar, fits your model.
3. **The checkbox coordinate offsets** (CF `+28/+32`, RC `+29/+35`) and the left-align JS
   normalization for center/right widgets — direct constants.
4. **The disconnect-during-detection insight, adapted:** you can't disconnect a chromedriver you
   don't have, but the principle (issue the sensitive action when no *detectable* automation signal
   is live) maps to patchright's stealth. Nothing new to build here — confirms your current design.
5. **Docker/CI pattern:** Xvfb `:99` at `1920x1080x16` + the full font pack (`Dockerfile:24-42,
   145-146`) if you ever containerize the worker — real-desktop fonts materially help container
   fingerprints. Don't use true `--headless` for stealth runs.

**When a sidecar WOULD be justified (only then):** a specific job board that provably detects
CDP-synthesized mouse events (`Input.dispatchMouseEvent` carries no trusted-gesture flag on some
Kasada/DataDome setups). If you hit that wall, SeleniumBase's PyAutoGUI OS-click is the proven
escape hatch — but reach for `nut.js`/`robotjs` in your existing Node worker before a Python
process, and gate it behind an explicit "real mouse allowed" flag so it never fights the
LO-is-watching UX. Until a board actually beats CDP clicks, skip it.
