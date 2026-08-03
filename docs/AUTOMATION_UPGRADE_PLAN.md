# HireMeOps automation upgrade — research + migration plan (WIP)

Status legend: ✅ done · 🔬 agent running · ⏳ pending · 📌 decided

## Goals (from LO)
1. Wire real captcha solvers into automation.
2. Add Docker to automation.
3. Evaluate CDP-first drivers; pick best for migration (patchright vs zendriver vs SeleniumBase-UC).
4. Match how each repo handles PDF / HTML / page print; port best approach.
5. Embed a live web-browser UI inside the app.
6. Web-search 2026 results to harden choices (later phase, subagents).

## Our current architecture (✅ mapped via codegraph + reads)
- Rust `PlaywrightDriver` (`src-tauri/src/browser/playwright.rs`): spawns ONE Node worker
  (`node <script>`), newline-JSON RPC over stdin/stdout, lazy spawn + `prewarm()`,
  auto-respawn when reader task dies. Parked-submit human handoff state lives here.
- Node worker = patchright (sole browser lib). AI/ChatGPT bridge is a separate mjs
  (`src-tauri/resources/playwright-bridge/index.mjs`). Per-profile persistent cookie jar;
  Chromium SingletonLock forces release-before-reuse.
- Automation apply loop: `automation_start` → `run_engine` → `run_automation_queue(emit_cb)`
  → parks at submit → `automation_confirm_submit` cascades DB writes (evidence/session/task/
  application_runs/job_posts).
- Feature-gated behind `real-browser`; stub build tells user to rebuild.
- Captcha today: keyless local auto-pass (evasion+wait), env HIREMEOPS_AUTO_CAPTCHA,
  default = pause for human. (Need to locate exact code in automation/*.js — next tick.)

## Embedded browser UI — TWO approaches, different jobs (✅ analyzed)

### A. Our screencast.rs (CDP screencast) — RIGHT for "watch the bot" / Evidence Viewer
- `src-tauri/src/browser/screencast.rs` ALREADY implements it via `chromiumoxide`:
  launch Chrome → `Page.startScreencast{jpeg,q80}` → `EventScreencastFrame` → base64 JPEG
  → `tauri::ipc::Channel<PreviewFrame>` → frontend. Acks each frame. open_real/close_real +
  REGISTRY handle map.
- **GAP (why Evidence Viewer is on standby):** it launches a THROWAWAY browser pointed at a
  URL, not attached to the live automation session. Fix = screencast the automation worker's
  own page (share CDP endpoint / attach chromiumoxide to the patchright browser's
  --remote-debugging-port, OR run screencast from inside the Node worker over its existing CDP).
- Read-only by default; input can be forwarded via CDP Input.dispatch* if we want interactive.

### B. terax-ai native child webview — RIGHT for a user browser pane (manual login / uBlock)
- `src-tauri/src/modules/browser.rs` + `src/modules/preview/NativeWebviewSurface.tsx`.
- Technique: `window.add_child(WebviewBuilder::new(label, WebviewUrl::External(url)),
  LogicalPosition, LogicalSize)` — a REAL native OS webview (WebView2/WKWebView/WebKitGTK)
  positioned over a placeholder `<div>`. React syncs bounds via ResizeObserver + rAF →
  `preview_webview_set_bounds`; show/hide/navigate/reload/back/forward are Tauri commands;
  URL changes emitted back via `on_page_load`. uBlock injected on Windows via `extensions_path`
  + `data_directory` (per-profile). Label validation + http/https-only URL guard.
- **Limitation:** it's the OS webview, NOT our patchright/CDP stealth browser. Cannot show or
  drive the automation session. Good for a real in-app browser tab; useless as bot-watcher.

### Decision (📌 pre-agents, revisit)
- Evidence Viewer / "watch the automation" → finish screencast.rs by attaching it to the live
  session. Highest value, ~80% built.
- Optional user browser pane (manual captcha/login by hand) → port terax-ai native webview.
  Lower priority; the parked-submit handoff already runs headed.

## Repo deep-dives (agents writing to notes/)
- ✅ notes/browsers-benchmark.md   — DONE
- ✅ notes/playwright-captcha.md    — DONE
- ✅ notes/patchright-nodejs.md     — DONE
- ✅ notes/zendriver.md            — DONE
- ✅ notes/seleniumbase.md         — DONE
- ✅ notes/undetected-testing.md   — DONE

### 📌 DECIDED — SeleniumBase: no sidecar, steal the tables + CDP-click
Source: seleniumbase notes. UC Mode = hardened undetected-chromedriver (patches `cdc_` out,
disconnect/reconnect during sensitive actions); CDP Mode = pure CDP via vendored nodriver.
- Captcha fully keyless. `uc_gui_click_captcha` = PyAutoGUI **real OS mouse** (needs focus) —
  ⚠️ DIRECTLY conflicts with our design (memory focus-safe-automation: "CDP input never moves
  the real mouse / LO watches"). DO NOT adopt PyAutoGUI. But CDP-mode `solve_captcha(use_cdp=True)`
  clicks via CDP and covers **hCaptcha/DataDome/Friendly** too (`sb_cdp.py:2602`).
- Docker = ubuntu:24.04 + Chrome + Xvfb `:99` @1920x1080 + heavy font pack (fingerprint realism).
- PDF = `Page.printToPDF` (tab.py:1273) — proven working under **headed+Xvfb CDP**. ✅ RESOLVES our
  printToPDF calibration knob: raw-CDP printToPDF works headful, no headless context needed.
- **Steal (all portable to patchright/Node):** captcha **selector fallback tables**
  (`browser_launcher.py:1434-1533`, `sb_cdp.py:2636-2684`), checkbox coordinate offsets, and the
  CDP-native click. OS-input escape hatch, IF ever needed, = **nut.js/robotjs (Node), never Python**.

## ✅ CORRECTED current state (read the real files — more built than memory implied)
- `automation/human.js` (mature): Bézier mouse w/ overshoot, Fitts timing, Gaussian dwell/flight
  typing w/ typos+backspace, log-normal think-time, LinkedIn-SDUI click escape (focus+Enter for
  trusted activation), self-check via `node human.js`. This IS our humanized CDP input layer — it
  already exists; memory antibot-strategy-2026 "build human.js" is DONE.
- `automation/captcha.js` (exists, gated by HIREMEOPS_AUTO_CAPTCHA): CF interstitial wait,
  Turnstile humanize+WAIT (no click), reCAPTCHA-v2 frameLocator `#recaptcha-anchor` click, human
  fallback. **GAP: does NOT import human.js** — uses crude `page.mouse.move` + bare `anchor.click()`.
  No Turnstile checkbox click, no hCaptcha/DataDome, no selector fallback tables.
- `automation/capture.js` (solid): writes html/json/png/**mhtml** bundles, prunes to 40, aria
  snapshot, network ring, visible-error scrape. **MHTML via `Page.captureSnapshot` ALREADY DONE**
  (capture.js:184) → the "borrow MHTML from zendriver" item is already shipped. **GAP: no PDF.**
- `automation/worker.js` (102KB) = the script the Rust driver spawns (`locate_worker_script`,
  playwright.rs:1266). All the wiring lands here.

## 🎯 IMPLEMENTATION ROADMAP (ordered by value/effort)

### Phase 1 — Captcha hardening (highest value, small diff) [automation/captcha.js]
1. Route ALL captcha interaction through `human.js` (`humanClick` on reCAPTCHA anchor; replace the
   crude `humanize()` mouse loop with `humanMove`/`thinkTime`).
2. ADD Turnstile checkbox click: locate the CF Turnstile iframe/shadow-DOM checkbox and humanClick
   it (port playwright-captcha's shadow-DOM unlock + SeleniumBase Turnstile selectors) instead of
   pure wait. Keep the wait-then-verify loop as confirmation.
3. ADD selector fallback tables ported from SeleniumBase (`browser_launcher.py:1434-1533`,
   `sb_cdp.py:2636-2684`) for CF/Turnstile/reCAPTCHA/hCaptcha widget detection.
4. ADD an hCaptcha/DataDome CDP-click path (best-effort; mark LinkedIn Turnstile best-effort).
5. Keep keyless-only + human-pause fallback; NO paid solver dep (2captcha Node SDK only if LO asks).
   Test: extend the existing self-check pattern; assert selector tables resolve on saved captures.

### Phase 2 — Evidence PDF + wake the Evidence Viewer
6. `automation/capture.js`: add `capturePdf()` sibling to `captureMhtml()` using
   `newCDPSession().send("Page.printToPDF", {...})` (proven headful via SeleniumBase). Write
   `{base}.pdf` into the bundle; prune regex already covers extensions — extend to `|pdf`.
7. Wake the Evidence Viewer: `screencast.rs` currently screencasts a THROWAWAY browser. Re-point it
   at the live automation session. Cleanest low-risk path: run `Page.startScreencast` from INSIDE
   `worker.js` over its existing patchright CDP session and forward base64 frames up the existing
   stdout RPC → Rust → emit on the Tauri channel the frontend already consumes. Avoids a 2nd CDP
   client racing on target discovery and avoids Runtime.enable (no stealth leak). Keep screencast.rs
   as the fallback/standalone preview.

### Phase 3 — Docker for the automation worker [new: automation/Dockerfile + compose]
8. Image: node:22 + real Google Chrome (`channel:"chrome"`) + chromium deps + font pack.
9. **Headed under Xvfb** (`Xvfb :99` + DISPLAY), NEVER headless (evasion 40%). 
10. Mount per-profile cookie-jar volume (automation_profile_dir), pass HIREMEOPS_* env.
11. Scope: containerize the WORKER (worker.js) for reproducible runs/CI; the Tauri GUI stays native.
    Rust `locate_worker_script`/spawn can target a container node in a docker profile (later).

### Phase 4 — Stealth verification pass (checklist, no new code)
12. Audit worker launch: confirm `launchPersistentContext` + `channel:"chrome"` on a real Chrome
    binary + `viewport:null` + zero UA/header overrides (patchright happy path).
13. Audit every `page.evaluate` needing main-world globals passes `isolatedContext:false`.
14. Never open a raw CDP session that calls `Runtime.enable` on the live stealth page.

### Phase 5 — Optional user browser pane (only if LO wants hands-on) [port terax-ai]
15. Port terax-ai `NativeWebviewSurface` + `browser.rs` `window.add_child` webview for a real in-app
    browser tab (manual login/captcha by hand). Lower priority — parked-submit handoff already headed.

## Phase 0 — 2026 websearch validation (subagents)
Confirm the research still holds against live 2026 anti-bot changes before we cut code.
- ✅ websearch-patchright-2026.md — DONE
- ✅ websearch-jobboards-2026.md — DONE
- ✅ websearch-captcha-2026.md — DONE

### 📌 2026 VALIDATION (job boards) — rate-discipline is THE ban vector
Source: websearch-jobboards-2026.md (2026 sources; some pacing = estimated ranges, flagged).
- **LinkedIn:** own behavioral+fingerprint+account-history detection, NO Turnstile. 2026 crackdown
  explicitly targets browser-based automation = OUR class. Safe ≈ **150 total actions / 24h,
  20–40 Easy Apply / day, 4-week warm-up on new accounts, 14+ day recovery** after a hard restriction.
- **Indeed:** Cloudflare MANAGED CHALLENGE (fingerprint rejection, not a rate gate), no Turnstile.
  No confirmed safe pacing; ~**30–50 applies/day** estimated flag range. Confirms don't-override-UA.
- **Upwork:** PerimeterX/HUMAN client-side + continuous session validation + Cloudflare. No numeric
  limits — mechanism is "behave human the WHOLE session"; keep sessions SHORT.
- **Catho / Gupy / InfoJobs:** no board-specific 2026 data (flagged honestly — no invented numbers).
  Generic Cloudflare/reCAPTCHA/hCaptcha; rely on human cadence + our DOM-capture challenge detection.

### 📌 Per-board pacing table (drive the queue drain from this)
| Board    | Detection (2026)                    | Safe pacing (2026, some estimated)        |
|----------|-------------------------------------|-------------------------------------------|
| LinkedIn | behavioral+fingerprint+history      | ≤150 actions/24h · 20–40 EasyApply/day · warm-up 4wk |
| Indeed   | Cloudflare managed challenge (FP)   | ~30–50 apply/day · fingerprint > rate     |
| Upwork   | PerimeterX/HUMAN + CF, session-long | no number → short sessions, human all-session |
| Catho    | generic CF/captcha (no 2026 data)   | human cadence + DOM-capture detection      |
| Gupy     | generic (no 2026 data)              | human cadence + DOM-capture detection      |
| InfoJobs | generic (no 2026 data)              | human cadence + DOM-capture detection      |

### 📌 NEW Phase 1.5 — Rate-discipline governor (HIGH value — the real ban vector)
Multiple agents converge: bans come from PACING, not the captcha click. Add a per-board rate
governor to the automation queue drain (`run_automation_queue` / `worker.js`):
- Per-board daily + rolling-window action caps from the table above (config, tunable knob).
- Enforce inter-action think-time (already have `human.js thinkTime`) + short Upwork sessions.
- On a detected challenge/DOM-capture failure, back off that board for the day.
- Surface remaining daily budget in the UI. This is a calibration knob — numbers are 2026 estimates,
  expose them in settings so LO can tune as boards change.

---

## ✅ PLAN COMPLETE — all 6 repos + terax-ai + 3×2026-validation folded in
Headline decisions (all grounded in cited source):
1. STAY on patchright, headed, humanized CDP input. No migration; nodriver/zendriver = per-site
   escape hatch only. Pin **Chrome ≥142** (coordinate-leak fix).
2. Captcha: keyless-first (beats paid on Turnstile/DataDome in 2026); harden `captcha.js` to use
   `human.js` + Turnstile click + SeleniumBase selector tables. Paid fallback = CapSolver Node SDK,
   image-grid only, gated behind N keyless failures. No Python, no local vision.
3. Docker: containerize `worker.js`, node+real-Chrome, **Xvfb-headed never headless**, jar volume.
4. PDF/HTML: MHTML already shipped (capture.js:184); ADD CDP `Page.printToPDF` (headful-proven).
5. Embed UI: re-point existing `screencast.rs` at the live session from `worker.js` CDP to wake the
   Evidence Viewer; terax-ai native-webview pane optional (Phase 5).
6. Rate-discipline governor (Phase 1.5) is the highest-leverage anti-ban work — pacing, not solving.

Build order: P1 captcha-hardening → P1.5 rate governor → P2 PDF + Evidence Viewer → P3 Docker →
P4 stealth-verify checklist (Chrome≥142) → P5 optional webview pane.

### 📌 2026 VALIDATION (captcha) — keyless-first confirmed, fallback pick refined
Source: websearch-captcha-2026.md (2026 sources; solver % from one vendor guide = directional).
- Keyless STILL wins in 2026 on our targets: Turnstile, reCAPTCHA v3 scoring, and v2/hCaptcha
  CHECKBOXES clear via trusted patchright + humanized click, headed/Xvfb + decent IPs. Notably,
  paid solver TOKENS get fingerprint-REJECTED on Turnstile (~30%) and DataDome (~10%) → **keyless
  literally beats paid there.** Validates Phase-1 keyless-first.
- Paid fallback earns its keep ONLY on reCAPTCHA v2 IMAGE GRIDS + hCaptcha challenge pages.
- 📌 **REVISED fallback pick:** prefer **CapSolver Node SDK** (~$0.80/1k) over 2Captcha ($1–2.99/1k);
  keep 2Captcha Node lib as long-tail backup. Gate behind "keyless failed N times," image-grid only.
- 📌 **SKIP local AI-vision (YOLO/torch)** — YAGNI + Python/torch weight; only revisit if image grids
  actually show up in practice.

### 📌 2026 VALIDATION (patchright/Cloudflare) — plan HOLDS, +1 new action
Source: websearch-patchright-2026.md (Apr–Jul 2026 sources).
- Patchright still cleanest drop-in Playwright stealth; still strips the Runtime.enable leak. No
  patchright-SPECIFIC Cloudflare signature reported. Real system Chrome (`channel=chrome`) matters
  more than the patches themselves.
- ⚠️ NEW: a May/Jul 2026 651-verdict benchmark shows **nodriver now edges patchright (28/0 vs
  25/3)**. Not enough to migrate — keep nodriver/zendriver as a **per-site escape hatch**, not a
  wholesale swap. (Consistent with Phase-5 optional + escape-hatch stance.)
- Keyless Turnstile checkbox-click **still works in 2026** — but only from a browser already passing
  fingerprinting. The click was never the gate → confirms Phase-1 is about fingerprint coherence +
  humanized click, not a magic solver.
- CDP mouse input IS detectable (Brotector isTrusted/coord leaks), BUT **CDP-Patches is archived
  (Sep 2025) and the coordinate leak is fixed upstream in Chrome v142+**. So a recent Chrome closes
  most of the gap WITHOUT OS-level input → our CDP-input design (no real-mouse, LO watches) stays valid.
- 📌 **NEW ACTION (add to Phase 4 stealth verify):** pin/require **Chrome >= 142 (ideally 148)** for
  the automation channel so the coordinate leak stays closed. Add a version check at worker launch;
  warn if the resolved `channel:"chrome"` binary is older. This is now the single cheapest hardening.

### 📌 DECIDED — Migration verdict: STAY on patchright, do NOT migrate
Source: browsers-benchmark (techinz), 2026-05-26/27 run, versions pinned.
- patchright HEADED = #1, 100% (10/10) bypass vs Cloudflare/DataDome/Imperva/Akamai/
  PerimeterX/Kasada/Amazon/Google/Reddit. cloakbrowser & camoufox_headless = 90%.
  nodriver 80, seleniumbase-cdp 80, **zendriver 70**.
- ⚠️ patchright HEADLESS collapses to **40%** — biggest gap in the table. NEVER run the
  automation headless against protected boards. (We already run headed — keep it.)
- Caveat: N=1 per engine, different proxy per engine → treat as tiers not exact order.
- **Action:** stop eyeing zendriver/SeleniumBase as replacements. Spend evasion budget on
  clean IPs + human-pacing (matches memory: antibot-strategy-2026 "don't spoof, coherence
  wins"). Benchmark harness re-runnable via `python main.py` if we want our own numbers.

### 📌 DECIDED — Captcha: keyless-native, no Python dep
Source: playwright-captcha (techinz) = Python, can't import into our Node worker.
- Its "keyless" solve = clicking the Cloudflare Turnstile checkbox inside shadow-DOM iframes
  (`solve_by_click.py:16-112` + `unlockShadowRoot.js`) — the SAME evasion+wait+click class we
  already do. Not a cryptographic solve. Only CF + reCAPTCHA v2/v3; no hCaptcha/vision/audio.
- **Action:** reimplement its ~130-line CF shadow-DOM click-solver natively in `automation/`
  as a hardened keyless captcha module (upgrade our current auto-pass). If paid solving is
  ever wanted, call the **2captcha Node SDK** directly — do NOT add the Python lib.

### 📌 DECIDED — Patchright stealth: we're on the happy path, harden INPUT only
Source: patchright-nodejs (README + codemod source).
- Stealth mechanism = avoid the leaky CDP calls: `isolatedContext=true` on all evaluate,
  Console API disabled, init-scripts via route interception (not the leaky CDP inject),
  `sourceURL` fingerprint stripped. Chromium-only.
- Documented max-stealth launch = `launchPersistentContext` + `channel:"chrome"` (REAL Chrome,
  not bundled Chromium) + `headless:false` + `viewport:null` + ZERO ua/header overrides.
  **Our worker already matches this** — verify each point (esp. `channel:"chrome"` on a real
  Chrome binary, `viewport:null`, no injected headers).
- ⚠️ Two footguns to audit: (a) opening a raw CDP session + calling `Runtime.enable` ourselves
  re-introduces the leak patchright works to avoid — so the screencast/attach work MUST use a
  non-leaky path (chromiumoxide launches its own; if we attach to the worker's browser, avoid
  Runtime.enable). (b) every `page.evaluate` that needs main-world globals must pass
  `isolatedContext:false` or it silently runs in the isolated world.
- **Residual gap = input.** Playwright mouse/keyboard are CDP-based and detectable (Brotector).
  Fix = CDP-Patches lib OR our own `automation/human.js` (memory: antibot-strategy-2026). 📌
  highest-value hardening.

### 📌 DECIDED — PDF/print: do NOT use patchright page.pdf()
- patchright has no PDF support and `page.pdf()` requires headless, which conflicts with the
  headed stealth config (and headless collapses evasion to 40% per benchmark).
- CVs already render via LaTeX — keep that path untouched.
- For "application evidence as PDF / page print": use CDP `Page.printToPDF` from a SEPARATE
  short-lived headless/offscreen context (or chromiumoxide, already a dep via screencast.rs),
  NOT the live stealth session. Confirm approach against zendriver/seleniumbase notes.

### 📌 DECIDED — zendriver: no Python sidecar, borrow 3 ideas in Node
Source: zendriver notes. AGPL-3.0 (LICENSE:1) = distribution hazard; pure-CDP nodriver fork.
- Attach only works if Chrome exposes `--remote-debugging-port`; patchright defaults to
  `--remote-debugging-pipe` (no TCP). Two CDP clients on one browser race on target discovery.
- All PDF/HTML/screenshot are thin CDP wrappers: `Page.printToPDF` (tab.py:1445),
  `Page.captureScreenshot` (:1375), `Page.captureSnapshot`/MHTML (:1342).
- **Borrow in Node, don't import:** (1) MHTML `Page.captureSnapshot` for `automation/captures/`
  archiving (single-file page snapshot — great for evidence & self-inspection per DOM-capture
  memory); (2) attach-via-remote-debugging-port pattern (for screencast attach if we go that way);
  (3) their GPU-Chrome Docker recipe as a reference (it's a Wayland+VNC harness, not slim).

### 📌 DECIDED — Real-input captcha is the load-bearing piece (validated)
Source: undetected-testing (mdmintz CI rig, current 2026-07-24, keyless from DC IPs).
- Proven keyless-passing targets incl. **Upwork + Indeed** (our targets ✅) via `activate_cdp_mode()`
  + `uc_gui_click_captcha()` = REAL OS mouse (PyAutoGUI), not JS `.click()`. Zero UA spoofing.
- No Docker, no headless — **Xvfb virtual display** (real-mouse needs a display).
- ⚠️ **No LinkedIn tested anywhere** → treat LinkedIn Turnstile as best-effort. PerimeterX
  (Walmart) flaky/commented out.
- Confirms: build `automation/human.js` real-input (CDP `Input.dispatchMouseEvent` humanized),
  keep UA untouched, never headless, and **rate-discipline is the real ban vector** (repo silent
  on it — it's on us; matches memory antibot-strategy-2026).

## Docker plan (📌 shape decided; details pending seleniumbase note)
- Purpose: reproducible Linux runner for the Node patchright worker (not the Tauri GUI).
- Base: node:22-slim + real Google Chrome (`channel:"chrome"` requires it) + chromium deps.
- **Headed under Xvfb** (`xvfb-run` / start Xvfb + DISPLAY) — NEVER headless (evasion 40% + real
  mouse needs a display). This is the single most important Docker constraint.
- Mount per-profile cookie jar volume (shared-browser-jar memory). Pass HIREMEOPS_* env.
- Compose service wrapping the worker; Rust driver spawns `node` — in Docker mode spawn into the
  container or run the whole app headless-GUI + worker. Decide GUI-in-docker vs worker-only.
- Reference: zendriver's Wayland+VNC GPU-Chrome harness; simplify to Xvfb.

## PDF / HTML / page-print plan (📌 decided)
- CVs: keep LaTeX render (untouched).
- Evidence/page snapshots: CDP over a `newCDPSession()` from the worker —
  `Page.captureSnapshot` (MHTML, single file) for HTML archiving, `Page.captureScreenshot` for
  images (already have screencast frames too). ⚠️ VERIFY `Page.printToPDF` works HEADFUL via raw
  CDP; if it still demands headless, render evidence PDFs in a SEPARATE offscreen headless context
  (chromiumoxide is already a dep) so the live stealth session stays headed. printToPDF needs only
  the Page domain, NOT Runtime.enable, so it won't reintroduce the patchright leak. (calibration knob)

## Phase 2 (⏳ after plan sign-off) — 2026 websearch hardening
- Subagent web-search pass (2026 results) to confirm: patchright still #1, CF Turnstile keyless
  click still works, Indeed/Upwork/LinkedIn anti-bot changes, rate-limit thresholds per board.

---

## 🔨 BUILD STATUS (2026-08-03)
- ✅ **Phase 1 — captcha hardening + ShyMouse** (SHIPPED, unit-verified, 101/101 automation tests pass)
  - NEW `automation/shy-mouse.js` — coordinate-level humanized mouse (Fitts timing, Bézier +
    overshoot, fatigue, jerk-smoothing, 60–144Hz polling sim); ESM + added `clickAtPoint(x,y)`.
    Motion via patchright `page.mouse.*` → CDP Input (real pointer never moves).
  - REWROTE `automation/captcha.js`: now CLICKS the Turnstile/reCAPTCHA/hCaptcha checkbox by
    coordinate (outer-widget box + SeleniumBase offset; inner iframe is cross-origin) via ShyMouse
    instead of only waiting. Ported SeleniumBase selector fallback tables + offsets (CF +28/+30,
    RC +29/+33, hC +30/+38). Added hCaptcha branch. Keyless-first; human fallback on real challenge.
  - NEW `automation/shy-mouse.test.js`.
- ✅ **Phase 1b — full keyless captcha coverage** (SHIPPED, live-verified): expanded `captcha.js` to
  match SeleniumBase's `solve_captcha` keyless set — CF Turnstile (bigger selector chain + left-align
  normalization), reCAPTCHA v2 (+ invisible-badge skip), hCaptcha/Incapsula, Friendly, and DataDome
  SLIDER drag (`ShyMouse.dragTo`, reads the cross-origin iframe via patchright frameLocator). Zero
  cost, no new deps, no Python. Live Turnstile pass re-confirmed ~5.7s. NO free image-grid/rotate
  solver exists (not even in SeleniumBase) → those hand off to human.
- ✅ **Phase 1c — ShyMouse wired into the apply flows** (SHIPPED, live-verified): `human.js`
  `humanClick`/`humanType` now travel via ShyMouse (Fitts/overshoot/fatigue/polling), while KEEPING
  the LinkedIn SDUI overlay-escape (focus+Enter) and typing — a raw coordinate click would hit a
  covering overlay. One shared per-page instance (`getShyMouse(page)` cached on `page.__shyMouse`) so
  captcha + form-fill draw from the same session fatigue state. Live: button click registered once,
  field typed correctly, cursor moved. Zero worker.js call-site changes (same humanClick/humanType sig).
  ⚠️ observed pre-existing gap (not introduced): humanClick's final `el.click()` escape has no catch,
  so a click that triggers full navigation can throw — harmless for apply flows (modal buttons don't
  navigate) but worth a one-line guard later.
- ✅ **Phase 2 (PDF/print)** (SHIPPED): `automation/capture.js` `capturePdf()` via CDP
  `Page.printToPDF` (Page domain only, no Runtime.enable leak; headful-proven). PDF in bundle + prune.
- ✅ **CDP audit**: input = patchright `page.mouse/keyboard` → CDP Input; MHTML/PDF/screens =
  `newCDPSession` Page domain; no raw `Runtime.enable`; launch = persistentContext + channel:chrome +
  viewport:null. ⚠️ `cmdOpen` default `headless=true` — apply flows must pass `headless:false`.
- ✅ **Phase 1d — humanClick nav guard + faster typing** (SHIPPED, live-verified): humanClick's final
  `el.click()` escape now `.catch()`es "Target closed" from a navigating click (can't abort a run).
  `humanType` got an env-tunable speed multiplier `HIREMEOPS_TYPE_SPEED` (default 1.7× ≈ 47→80 WPM),
  dividing every dwell/flight/pause so human variance is kept, just compressed; per-call `{speed}` too.
- ✅ **Phase 1.5 — rate governor** (SHIPPED, compiles clean): `src-tauri/src/domain/rate.rs` —
  rolling 24h+1h per-board caps counted from completed applies (RFC-3339 string compare). Defaults:
  LinkedIn 30/8, Indeed 40/12, Upwork 20/6, others 40/12; all overridable via
  `HIREMEOPS_RATE_<BOARD>_DAY`/`_HOUR`. Wired into `run_automation_queue`: over-budget board → emit
  `RetryScheduled` + leave task queued + keep draining other boards (`summary.skipped`). Unit tests
  for defaults + env override. THE top anti-ban lever (bans = pacing, not the captcha click).
- ✅ **Typing → 240 WPM default + instant mode** (SHIPPED, live): `HIREMEOPS_TYPE_WPM` default 240;
  `HIREMEOPS_TYPE_INSTANT=1` (or per-call `{instant}`) → fill-speed after a human travel+focus.
  Structured date/skill helpers (gupy/catho/infojobs pressSequentially) left as-is — already ≥100 WPM
  and their verify loops would break under typo simulation.
- ✅ **Phase 2b — Evidence Viewer LIVE** (SHIPPED, compiles + typechecks; needs live run to confirm
  frames paint): worker.js `start/stop_screencast` (CDP `Page.startScreencast` on the active page →
  unsolicited `screencast_frame` events, Page domain only, no Runtime.enable). playwright.rs
  `WorkerConn` routes those events (additive — replies untouched) to `PlaywrightDriver.start/stop_live_preview`
  → `PreviewFrame` Tauri channel. `current_session` tracked on open(). Commands
  `preview_open_live`/`preview_close_live`. Frontend `BrowserPreview.tsx` (canvas) rendered in
  `ApplicationsQueue` while a run is active. This embeds the REAL automation in-app.
- ✅ **Phase 3 — Docker/Xvfb** (SHIPPED files): `automation/Dockerfile` (node:22 + system chromium via
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` + Xvfb + font pack), `docker-entrypoint.sh` (Xvfb :99, headed,
  dumb-init), `docker-compose.yml` (stdin worker, profile volume, shm 1gb), `.dockerignore`. Rust
  spawn-into-container is the noted follow-up.
- ✅ **Embedded native webview** (ported from terax-ai, SHIPPED, compiles + typechecks): enabled tauri
  `unstable`; `commands/browser_view.rs` (9 `preview_webview_*` commands using `window.add_child`);
  frontend `NativeWebviewSurface.tsx`. Interactive OS-webview pane INSIDE the window (no separate
  program). ⚠️ engine boundary: OS webview ≠ patchright (separate cookies/engine) — it's for in-app
  browsing panes; watch the automation itself via the CDP Evidence Viewer. Component is drop-in
  (`<NativeWebviewSurface label={nativePreviewWebviewLabel(n)} url=… visible/>`); mount point TBD.
- ⏳ **Staged:** Phase 4 Chrome≥142 launch guard · live Turnstile confirm · rate-governor UI budget +
  live drain observe · Rust spawn-worker-in-Docker · mount NativeWebviewSurface into a real pane.
