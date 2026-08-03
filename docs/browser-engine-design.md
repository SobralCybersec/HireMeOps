# Browser Automation Engine Design — HireMeOps Phase 5

> **Recommended stack (tl;dr)**
> `spider_chrome` (active fork of `chromiumoxide`) + persistent user-data-dir + headful Chromium
> launched as a sidecar process. Screencast via `Page.startScreencast` → Tauri Channel → `<img>`
> tag. Extensions loaded with `--load-extension`. Human-in-the-loop gate before every submit.

---

## 1. Engine Choice: `chromiumoxide` vs Node/Playwright Sidecar

### Option A — `spider_chrome` (pure-Rust CDP)

The original [`chromiumoxide`](https://crates.io/crates/chromiumoxide) (by mattsse) last published
CDP types in **August 2024** and has slowed down. The actively maintained community fork is
[`spider_chrome`](https://crates.io/crates/spider_chrome) (spider-rs/chromey on GitHub), which:

- Keeps CDP protocol types current (last publish **March 2026**)
- Applies bug fixes, improves emulation, supports high-concurrency
- Exposes the same `use chromiumoxide::...` import namespace — drop-in replacement
- Pure async/tokio, no FFI, no Node runtime
- License: MIT OR Apache-2.0

```toml
# Cargo.toml
[dependencies]
spider_chrome = "0.7"          # check crates.io for latest patch
tokio = { version = "1", features = ["full"] }
```

### Option B — Node/Playwright sidecar

Playwright is production-grade and battle-tested, but:

- Requires bundling a Node runtime + `playwright install chromium` (~300 MB extra)
- IPC between Rust and Node over stdin/stdout or a local HTTP port adds latency and crash surface
- Tauri's sidecar support exists but adds process lifecycle complexity
- Playwright's TypeScript surface is far better documented, which helps only if you write the
  automation logic in JS — which you don't want here

### Recommendation

**Use `spider_chrome`.** HireMeOps is a Rust-first desktop app. Keeping the automation engine
in-process (same tokio runtime, same `AppState`, shared `Arc<AtomicBool>` emergency-stop) is
architecturally cleaner and avoids the Node runtime weight. The spider fork is actively maintained
and its CDP type coverage matches Playwright's protocol support for everything HireMeOps needs.

Playwright wins if: you need cross-browser (Firefox/WebKit), or the team is JS-primary. Neither
applies here.

**Sources:**
- [chromiumoxide — crates.io](https://crates.io/crates/chromiumoxide)
- [spider_chrome — crates.io](https://crates.io/crates/spider_chrome)
- [spider-rs/chromey — GitHub](https://github.com/spider-rs/spider_chrome)

---

## 2. Live Preview / Screencast

### How it works

CDP exposes [`Page.startScreencast`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast)
which fires `Page.screencastFrame` events at a configured rate. Each event carries:

```json
{
  "data": "<base64-encoded JPEG or PNG>",
  "metadata": { "timestamp": 1234.5, "deviceWidth": 1280, ... },
  "sessionId": 1
}
```

The browser pauses the stream until you acknowledge each frame with
`Page.screencastFrameAck(sessionId)` — this is the natural backpressure mechanism.

### Tuning cadence and quality

```rust
// sensible defaults for a "watch mode" preview
Page::start_screencast(StartScreencastParams {
    format: Some(ScreencastFormat::Jpeg),
    quality: Some(60),        // 0-100; 60 keeps frames ~20-40 KB
    max_width: Some(1280),
    max_height: Some(800),
    every_nth_frame: Some(2), // ~15 fps at 30 Hz CDP tick
})
```

- JPEG at quality 60 is the right default: ~20–40 KB/frame, imperceptible vs PNG at 10×.
- `every_nth_frame: 2` gives ~15 fps which reads as "live" without saturating the IPC pipe.
- Bump to `every_nth_frame: 1` + quality 80 only for precise form-fill review. Drop to 4 for idle.
- Headless new-mode may drop frames under GPU contention; headful is the reliable path.

### Piping frames to the Tauri webview

Use **Tauri Channels** (not the general event bus) for frame streaming — Channels are designed
for high-frequency binary payloads and bypass JSON serde overhead for the body.

```
CDP WS listener (tokio task)
  └─ Page.screencastFrame event
       └─ Page.screencastFrameAck (acknowledge immediately after recv)
       └─ app_handle.emit_channel("screencast-frame", base64_string)
            └─ Frontend Channel listener
                 └─ <img id="preview" />
                      img.src = `data:image/jpeg;base64,${frame}`
```

On the Rust side, the CDP listener lives in a spawned `tokio::task`. It holds a clone of
`AppHandle` (store it in `BrowserSupervisor` via `with_app_handle()` in Phase 5 init).

**Performance note:** Base64 inflates by ~33%. At 40 KB/frame × 15 fps that's ~600 KB/s through
the Tauri IPC bridge — acceptable. If it lags on slow hardware, drop to `every_nth_frame: 4`
(~7 fps) and only restore speed when the user opens the preview panel.

**Sources:**
- [CDP Page.startScreencast spec](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast)
- [Tauri — Calling the Frontend from Rust (Channels)](https://v2.tauri.app/develop/calling-frontend/)

---

## 3. Browser Extensions

### Loading unpacked extensions

Pass these flags when spawning Chromium:

```rust
let args = vec![
    "--load-extension=/path/to/unpacked/extension",
    "--disable-extensions-except=/path/to/unpacked/extension",
    // Multiple extensions: comma-separated paths in --load-extension
];
```

`spider_chrome` / `chromiumoxide` expose these via `BrowserConfig::builder().args(args)`.

### Headless constraint (critical)

**Extensions require a persistent user-data directory and will not load in ephemeral/headless
contexts.** The rules as of 2025/2026:

| Mode | Extensions? |
|---|---|
| `--headless=old` (pre-112) | No |
| `--headless=new` (112+) | Sometimes, but unreliable |
| Headful (`--no-sandbox` on Linux, or `xvfb-run` in CI) | Yes, reliably |
| Persistent context (real `user_data_dir`) | Required in all cases |

**Use headful Chromium.** HireMeOps is a desktop app with a visible preview panel — there is no
reason to run headless. The user *wants* to see the browser. Launch with a persistent
`user_data_dir` per profile (already modelled as `SessionSpec.user_data_dir`).

### Manifest V3

Google required MV2 → MV3 migration before **June 2025**. MV3 differences relevant here:

- Background pages → service workers (no persistent DOM in background)
- `chrome.webRequest` blocking → `chrome.declarativeNetRequest`
- `chrome.debugger` permission still works in MV3 and gives CDP access from within an extension

If HireMeOps ships a companion extension (e.g. for session bridging or page annotation), it must
be MV3. Service worker lifecycle: the browser may suspend it; design it stateless and event-driven.

**Sources:**
- [Playwright MV3 extension guide 2026](https://qaskills.sh/blog/playwright-chrome-extension-testing-manifest-v3-2026)
- [Chrome MV3 migration](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Headless Chrome — extensions note](https://developer.chrome.com/blog/headless-chrome)

---

## 4. LinkedIn Login Viability

### Session persistence

The safe, practical approach is **persistent user-data-dir per profile**. The user logs in once
manually (in the HireMeOps-controlled Chromium window), and the session cookies + local storage
survive across runs in that directory. No credential storage in the app; no automated login form.

```
SessionSpec.user_data_dir → e.g. ~/.local/share/hiremeops/profiles/<profile_id>/chrome-data/
```

This is already the shape of `SessionSpec` — wire it directly into `BrowserConfig::user_data_dir`.

### Detection risk (realistic assessment, 2025)

LinkedIn's bot detection is **behavioural and longitudinal**, not purely fingerprint-based:

- **Good signals (in our favour):** persistent user-data-dir means consistent cookies, browser
  fingerprint, installed fonts, localStorage — identical to a human's session. CDP-driven headful
  Chromium is indistinguishable from a regular user at the TLS/HTTP layer.
- **Bad signals (risks):** machine-speed navigation (instant clicks, no dwell time, no mouse
  movement variance), high request volume (>50 profile views/day, >19 connection requests/day),
  traffic from datacenter IP ranges, and no realistic typing rhythm during form fill.
- **LinkedIn's enforcement (2025):** rate limits (~100 connection requests/week), temporary
  restrictions after anomaly bursts, and account warnings. Full bans are rare for low-volume
  personal use but do occur at automation-tool scale.

### Non-negotiable constraints (already in spec)

HireMeOps **never**:
- Solves or bypasses CAPTCHAs or anti-bot walls → if one appears, emit `AutomationStopped` and
  surface it to the user. The task re-queues; the user handles it.
- Auto-submits applications → every submit requires an explicit human confirmation step
  (`assist-and-pause` gate before any `<button type="submit">` interaction).
- Stores plaintext credentials or tokens outside the browser's own profile directory.

### Practical mitigations

- Add randomised dwell time between actions (100–800 ms jitter, Gaussian not uniform).
- Respect LinkedIn's daily soft limits: implement a rate-limit budget in `BrowserSupervisor`
  (configurable in settings, default conservative).
- Detect the CAPTCHA/challenge page in `probe()` by URL pattern or DOM marker; immediately
  pause and emit event rather than proceeding.
- Never run from a VPS or shared IP. The app is local-first by design — this is already correct.

---

## 5. Wayland + NVIDIA Launch Flags

The dev machine (Arch Linux, Wayland compositor, NVIDIA GPU) already needed
`WEBKIT_DISABLE_DMABUF_RENDERER=1` for the Tauri webview. Chromium has its own set of
Wayland/NVIDIA gotchas.

### Recommended launch flags for this setup

```rust
let chrome_args = vec![
    // Wayland: let Chromium auto-detect or force Wayland backend
    "--ozone-platform-hint=auto",
    // If auto selects X11 and causes issues, force:
    // "--ozone-platform=wayland",

    // NVIDIA: disable GPU sandbox (NVIDIA proprietary driver + sandbox = blank window)
    "--disable-gpu-sandbox",

    // NVIDIA on Wayland: avoid Vulkan conflicts with the compositor
    "--use-gl=egl",

    // Disable DMA-buf video decode (same root cause as WEBKIT_DISABLE_DMABUF_RENDERER)
    "--disable-features=VaapiVideoDecoder,UseChromeOSDirectVideoDecoder",

    // Suppress crash reporter noise in dev
    "--disable-crash-reporter",

    // Required for CDP connection
    "--remote-debugging-port=0",   // 0 = OS-assigned, read back from stderr

    // Persistent data (per-profile, set at runtime)
    // "--user-data-dir=/path/to/profile/chrome-data",
];
```

**Key notes:**

- `--ozone-platform-hint=auto` is the correct 2025 flag; the older `--ozone-platform=wayland`
  still works but `hint=auto` lets Chromium negotiate with the compositor.
- NVIDIA proprietary driver (565.x) + Wayland + Chromium can trigger flickering if Chromium
  picks Vulkan. `--use-gl=egl` forces EGL which is stable on NVIDIA/Wayland.
- `VaapiVideoDecoder` disable prevents the same DMA-buf class of hang that affects the Tauri
  WebView — both are caused by NVIDIA's VAAPI implementation on Wayland.
- For CI or xvfb-run contexts (extension testing): add `--no-sandbox` and `--disable-dev-shm-usage`.

**Sources:**
- [Chromium Ozone overview](https://chromium.googlesource.com/chromium/src/+/lkgr/docs/ozone_overview.md)
- [Arch Linux Chromium Wayland thread](https://bbs.archlinux.org/viewtopic.php?id=294895)
- [Chromium Wayland 2025 — Phoronix](https://www.phoronix.com/news/Chromium-Ozone-Wayland-2025)

---

## 6. Integration Sketch

### Mapping onto `BrowserDriver` + `BrowserSupervisor`

The existing trait (from `domain/automation.rs`) is already the right shape. Phase 5 adds one
concrete implementation alongside the existing `MockDriver`:

```
src-tauri/src/domain/automation.rs   ← BrowserDriver trait (unchanged)
src-tauri/src/browser/              ← NEW module (Phase 5)
  mod.rs
  chrome_driver.rs                  ← impl BrowserDriver for ChromeDriver
  screencast.rs                     ← CDP screencast loop → Tauri Channel
  launch.rs                         ← build BrowserConfig + launch args
```

**`ChromeDriver`** holds:
- `browser: Arc<Browser>` (spider_chrome)
- `pages: DashMap<String, Arc<Page>>` (handle → page, handle is a UUID)
- `app_handle: AppHandle` (for screencast emit)
- `stop_flag: Arc<AtomicBool>` (shared with `AppState::emergency_stop`)

**Method mapping:**

| `BrowserDriver` method | CDP / spider_chrome call |
|---|---|
| `open(&SessionSpec)` | `Browser::launch(config)`, open blank page, return UUID handle |
| `navigate(handle, url)` | `page.goto(url).await` |
| `probe(handle)` | `page.url()` + DOM query for known challenge/apply markers |
| `fill_easy_apply(handle, input)` | CDP `Input.dispatchMouseEvent` + `Input.insertText` per field; pause before submit for human gate |
| `screenshot(handle)` | `page.screenshot(params).await` → save to evidence dir |
| `dom_snapshot(handle)` | `page.content().await` |
| `close(handle)` | `page.close().await`, remove from map |

**Screencast wiring:**

`BrowserSupervisor::run_task` spawns a detached `tokio::task` for the screencast loop once the
page is open. The task listens for `Page.screencastFrame`, immediately acks, and emits the base64
payload via `app_handle` Channel. It exits when `stop_flag` is set or the page closes.

**Emergency stop:**

No changes to `commands/automation.rs`. The `Arc<AtomicBool>` already propagates through
`BrowserSupervisor::with_stop_flag`. `ChromeDriver` checks it at every `BrowserDriver` method
boundary — the same checkpoint model `MockDriver` already implies.

**Assist-and-pause gate:**

Before any `fill_easy_apply` submit step: emit `AppEvent::AutomationPaused { reason: "human_review" }`,
set internal state to `AwaitingConfirmation`, and block on a oneshot channel. A new Tauri command
`automation_confirm_submit` sends on that channel. Nothing auto-proceeds.

---

## Appendix: Dependency additions (Phase 5 only)

```toml
[dependencies]
spider_chrome = "0.7"          # CDP engine
tokio-stream  = "0.1"          # stream combinators for screencast event loop
uuid          = { version = "1", features = ["v4"] }  # page handles
dashmap       = "6"            # concurrent handle→page map
```

`dashmap` is likely already present (check Cargo.lock). `uuid` may already be in. Audit before
adding. `tokio-stream` is the only likely net-new dep; the alternative is manual `while let` on
the CDP event receiver, which is fine too.

---

*Document generated: 2026-07-09. Revise before Phase 5 kickoff — verify `spider_chrome` version
on [crates.io](https://crates.io/crates/spider_chrome) and re-check LinkedIn rate-limit numbers
as their enforcement evolves seasonally.*
