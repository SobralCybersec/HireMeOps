# patchright-nodejs — research notes

**Repo studied:** `/tmp/.../research/patchright-nodejs` (the *build/patching tooling* repo, not the shipped package).
**What this repo actually is:** a set of `ts-morph` codemods (`client_patches/*.ts` + `patchright_rebranding.ts`) that rewrite Playwright's client-side TypeScript source at build time, then rebrand `playwright-core` → `patchright-core`. The **driver/server-side** patches (command-flag tweaks, the actual Runtime.enable avoidance in the CDP layer) live in the separate main [patchright driver repo] and are only *described* in this README, not present here.
**Last commit:** `3674b0e` 2026-07-16 (a sponsor-copy update — not a code change; real releases are auto-published, see §5).

---

## 1. What it patches vs stock Playwright (concrete stealth changes)

### Runtime.enable leak — the headline patch
- README.md:181-182 — "the biggest Patch". Avoids `Runtime.enable` by executing JS in **isolated ExecutionContexts** instead of the main world.
- Client-side mechanism: every `evaluate` / `evaluateHandle` / `$$eval` gains an `isolatedContext` param **defaulting to `true`**:
  - framePatch.ts:31-56 (`evaluate`), :58-84 (`evaluateHandle`), :86-112 (`$$eval`)
  - pagePatch.ts:49-72 (`evaluate`), :74-97 (`evaluateHandle`)
  - workerPatch.ts:~20-64, locatorPatch.ts:~30-70, jsHandlePatch.ts:~15-45 (all reroute through `_channel.evaluateExpression(...)` with the isolated flag)
  - Type decls: patchright_rebranding.ts:13-46 adds the `isolatedContext?: boolean` param to `Page/Worker/Frame/Locator/JSHandle` in `types.d.ts`.
- **Behavioral consequence:** by default your `page.evaluate(fn)` runs in an *isolated world*, so it CANNOT see JS globals the page itself defined (`window.__foo`). Pass `isolatedContext: false` when you need the main world.

### Console.enable leak
- README.md:184-185 — patched by **disabling the Console API entirely**. `console.*` capture will not work in patchright. (Their words: use JS loggers, though those are detectable too.)

### addInitScript / addScriptToEvaluateOnNewDocument leak (not spelled out in README, visible in code)
- Stock Playwright injects init scripts via a CDP call that leaves a fingerprint. Patchright replaces this with a **network-route interception** approach:
  - browserContextPatch.ts:15-47 and pagePatch.ts:15-47 add `installInjectRoute()`, called at the top of `addInitScript`, `exposeBinding`, `exposeFunction`. It `route('**/*')`s every request and, for top-level `document` requests over http, does `route.fallback({ patchrightInitScript: true })`.
  - networkPatch.ts:32-48 (`_applyFallbackOverrides`) + :50-64 (`_innerContinue`) thread the `patchrightInitScript` flag down to the driver, which injects the script server-side instead of via the leaky CDP method.
  - Also wired into clockPatch.ts:14-15 (`clock.install`) and tracingPatch.ts:14-15 (`tracing.start`).

### sourceURL fingerprint
- clientHelperPatch.ts:10-12 — neuters `addSourceUrlToScript` to `return source`. Stock Playwright appends `//# sourceURL=__playwright_evaluation_script__` to evaluated scripts; that string is a known detection point. Patch strips it.

### Command-flag leaks (driver-side; README-documented only)
- README.md:187-194:
  - `--disable-blink-features=AutomationControlled` **added** (kills `navigator.webdriver`)
  - `--enable-automation` **removed** (also `navigator.webdriver`)
  - `--disable-popup-blocking` **removed**
  - `--disable-component-update` **removed** (its presence flags a stealth driver)
  - `--disable-default-apps` **removed**
  - `--disable-extensions` **removed**

### Misc
- Closed Shadow Root traversal + XPath into closed shadow roots (README.md:199-202) — normal locators just work.
- Dialog auto-dismiss wrapped in an internal API call so it doesn't pollute traces (browserContextPatch.ts:49-64).

---

## 2. API compatibility with Playwright

- **Drop-in replacement.** Change the import, use exactly like Playwright: README.md:29, :142, :147-158 (`const { chromium } = require('patchright')`).
- **Chromium only** — Firefox/WebKit unsupported: README.md:144-145.
- **Behavioral differences we must respect:**
  1. `evaluate`/`evaluateHandle`/`$$eval` default to `isolatedContext=true` → main-world page globals are invisible unless you pass `isolatedContext:false` (README.md:230-262; framePatch/pagePatch above).
  2. Console API is dead — no `page.on('console')` / `console.*` capture (README.md:184-185).
  3. Do **NOT** set a custom `userAgent` or custom browser headers — breaks coherence (README.md:168). This matches our existing memory note "never override Playwright userAgent (Client Hints mismatch)."
- **Extended API surface** = only the added `isolatedContext` boolean on the five evaluate-family methods (README.md:230-262). Nothing removed from the public API.

---

## 3. Recommended launch config for max stealth (verbatim from README)

README.md:160-170:
```js
chromium.launchPersistentContext("...", {
    channel: "chrome",
    headless: false,
    viewport: null,
    // do NOT add custom browser headers or userAgent
});
```
Section title (README.md:160): "Best Practice - use Chrome without Fingerprint Injection".
Plus README.md:172-174: prefer **real Google Chrome** over bundled Chromium — install via `npx patchright install chrome`, select with `channel: "chrome"`.

Four load-bearing choices: **persistent context** (not `launch()`), **`channel:"chrome"`** (real Chrome binary), **`headless:false`**, **`viewport:null`** (no forced `--window-size`/devicePixelRatio mismatch), and **zero UA/header overrides**.

---

## 4. CDP handling / does CDP re-introduce detection

- Patchright's entire strategy is to **avoid the CDP methods that leak** — it never calls `Runtime.enable`, never calls `Console.enable`, and routes init-script injection off the leaky CDP path (see §1). It does not add any new "expose a CDP session" API beyond Playwright's existing `context.newCDPSession()`.
- **Yes, using raw CDP re-introduces detection.** If you open a CDP session and call `Runtime.enable` (or anything that triggers it) yourself, you hand the leak straight back — that's the exact thing patchright spends its effort avoiding.
- **Input is the known residual CDP gap.** Playwright's mouse/keyboard go through CDP `Input.dispatch*`, which is detectable. README.md:210 states the Brotector pass is only achieved **"(with CDP-Patches)"** — an external lib (`Kaliiiiiiiiii-Vinyzu/CDP-Patches`) that drives OS-level input instead of CDP input. Patchright alone does not fix input-layer detection.

---

## 5. Maintenance / version signals / license

- **License:** Apache 2.0 (LICENSE file; README.md:8, :289-292). © Vinyzu.
- **Maintainers:** Vinyzu (active), Kaliiiiiiiiii (co) — README.md:304-306. Actively sponsored (multiple proxy sponsors, README.md:37-123).
- **Release cadence:** "Deployments of new Patchright versions are automatic" — auto-tracks Playwright upstream — "but bugs due to Playwright codebase changes may occur. Fixes ... might take a few days" (README.md:279). So version = whatever Playwright version it was auto-built against; the codemods are structural (they locate methods by name via ts-morph), which is why upstream refactors can transiently break them.
- Toolchain is modern: biome 2, TS 6, ts-morph 27, node types 25 (package.json:6-15).

---

## 6. PDF / page.pdf() / print support

- **No mention anywhere** — zero hits for "pdf"/"print" in README, patches, or index (grep confirmed; the only "print" matches are the word "Fingerprint").
- **Caveat that bites us:** `page.pdf()` in Chromium only works in **headless** mode (unchanged Playwright/Chromium behavior). The recommended stealth config is `headless:false` (README.md:167) → `page.pdf()` throws "PDF generation is only supported in headless mode". You cannot both run the stealth-recommended config and call `page.pdf()` on the same context.
- Console API being disabled (§1) also means no console-based PDF/print hooks.
- **For HireMeOps this is fine:** our CV pipeline renders via LaTeX (`src-tauri/src/cv/latex.rs`, `cv/export.rs`), not `page.pdf()`. Keep it that way — don't reach for `page.pdf()` inside the stealth browser; render PDFs out-of-band.

---

## 7. Verdict — are we using it optimally, and what to harden

**Already aligned with the docs (from our memory notes):**
- Never override `userAgent` — matches README.md:168. ✅
- Windows stay visible / `headless:false` (focus-safe note) — matches README.md:167. ✅
- Per-profile shared cookie jar via persistent context — matches `launchPersistentContext` (README.md:164). ✅
- patchright is sole browser lib — this repo confirms it's a true drop-in (README.md:29, :142). ✅

**Specific hardening changes, each cited:**
1. **Confirm `channel:"chrome"` with a real Chrome binary, not bundled Chromium.** README.md:172-174 explicitly recommends installing real Chrome (`npx patchright install chrome`) and selecting it. Bundled Chromium is a weaker fingerprint. Verify our launch args set `channel:"chrome"` and that Chrome is actually installed on target machines.
2. **Ensure `viewport:null` (no_viewport) is set on the persistent context.** README.md:168. A forced viewport injects `--window-size` and a devicePixelRatio that can mismatch the real display. Let the window drive it.
3. **Do not add ANY custom headers.** README.md:168 lumps headers in with userAgent. Audit our worker for any `extraHTTPHeaders`/header injection and strip it.
4. **Audit every `page.evaluate` for main-world assumptions.** Default is isolated (README.md:230-262). Any evaluate that reads page-set globals must explicitly pass `isolatedContext:false`, or it silently sees an empty world. This is the most likely subtle bug source in our existing automations.
5. **Close the input gap — this is THE remaining detection surface.** README.md:210 flags that the full Brotector pass needs **CDP-Patches** because Playwright input is CDP-based and detectable. This directly validates our `antibot-strategy-2026` note ("only real gap = CDP-input behavior"). Two options: adopt `Kaliiiiiiiiii-Vinyzu/CDP-Patches` (OS-level input), or build our planned `automation/human.js` humanized pacing. The README's own claim implies CDP-Patches is what actually gets them past Brotector — worth evaluating over a homegrown humanizer.
6. **Never open a raw CDP session and enable Runtime/Console.** That hands back the exact leaks patchright removes (§4). If any of our code calls `newCDPSession()` + `Runtime.enable`, that's a stealth regression.
7. **Don't rely on `page.on('console')` or `console.*` capture** — dead in patchright (README.md:184-185). If any automation reads console for diagnostics, move to explicit return values / DOM reads.
8. **Keep PDF rendering out of the stealth browser** — `page.pdf()` needs headless, which conflicts with README.md:167. Our LaTeX pipeline already does this correctly.

**Bottom line:** our config is on the documented happy path. The single highest-value hardening is the **input layer (CDP-Patches or humanized input)** — the README itself concedes patchright alone does not pass Brotector without it. Everything else is verification (channel=chrome, viewport:null, no headers, isolatedContext audit).
