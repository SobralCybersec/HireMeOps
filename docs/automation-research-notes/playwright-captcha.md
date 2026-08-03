# Research: `playwright-captcha` (techinz)

Repo on disk: `/tmp/claude-1000/-home-satu-Docs-HireMeOps/825c1b30-9c3a-4880-9756-164ba5ca89cf/scratchpad/research/playwright-captcha`

**Bottom line up front:** This is a **Python** library. HireMeOps' automation worker is **Node/patchright**. There is no way to `import` it into the Node worker. Its one keyless capability (Cloudflare click-solve) is ~130 lines of Playwright logic you'd reimplement in JS, not adopt. Its paid path (2captcha/10captcha) adds nothing you can't get from those services' own Node SDKs. See the verdict at the end.

---

## 1. What it is / language / license / maintenance

- **What:** "A Python library that makes captcha solving simple and automated with Playwright and Playwright-based frameworks." (`README.md:6`) Detect -> solve -> apply -> submit pipeline (`README.md:14-17`).
- **Language:** Python, `requires-python = ">=3.8"` (`pyproject.toml:10`). Fully `async` (uses `playwright.async_api` everywhere, e.g. `base_solver.py:6`).
- **Package:** `playwright-captcha` version `0.1.4`, published on PyPI (`pyproject.toml:6-7`, `README.md:4,110`). Author `techinz` / `contact@techinz.dev` (`pyproject.toml:12-13`).
- **License — CONFLICT:** `pyproject.toml:11` declares `license = "MIT"`, but the actual `LICENSE` file is the **Apache License 2.0** (10.5K, header reads "Apache License"). Flag this before any redistribution; the two are not interchangeable for attribution/patent terms.
- **Maintenance signals:** On-disk clone is a single squashed commit dated **2026-06-12** ("Update sponsor"); `git rev-list --count HEAD` = 1, so real history isn't present locally. No CI workflows (`.github/` contains only `FUNDING.yml`). README `TODO` (`README.md:207-217`) shows hCaptcha, CapSolver, AI solver, and even unit/integration tests all still unchecked — early-stage, one-maintainer project. It is a funded/sponsored side project ("you can hire me", `README.md:8`).

## 2. Captcha types handled + HOW

Enum of supported types (`playwright_captcha/types/captcha.py:7-10`):
`CLOUDFLARE_INTERSTITIAL`, `CLOUDFLARE_TURNSTILE`, `RECAPTCHA_V2`, `RECAPTCHA_V3`.

Two solver families (`README.md:76-103`):

**A. Click solver (KEYLESS) — Cloudflare only.**
- Cloudflare Interstitial + Turnstile only (`README.md:80-81`). No reCAPTCHA, no hCaptcha.
- Mechanism: it does NOT solve the challenge cryptographically — it relies on the browser's own stealth to pass, then finds and clicks the checkbox. Flow in `solvers/click/cloudflare/solve_by_click.py:16-112`: detect challenge (`:49`) -> find the `https://challenges.cloudflare.com/cdn-cgi/challenge-platform/` iframe inside (possibly closed) shadow roots (`:56-60`) -> wait for the checkbox to be clickable (`:65-69`) -> click it with retries (`click_checkbox`, `:115-132`) -> verify success via `networkidle` / a `div#success` element (`:82-101`).
- Explicitly documented to only work well on stealth browsers: "works good only with playwright's stealthy patches e.g. camoufox/patchright" (`README.md:79`); the example warns plain Playwright "isn't stealthy enough" (`examples/cloudflare/click_turnstile.py:16-17`). **This is the same "evasion + wait + click" strategy HireMeOps already uses for its keyless auto-pass.**

**B. API solvers (PAID third-party services).**
- `TwoCaptchaSolver` — 2captcha.com — handles Cloudflare Interstitial, Turnstile, reCAPTCHA v2, v3 (`README.md:86-93`).
- `TenCaptchaSolver` — 10captcha.com — reCAPTCHA v2, v3 only (`README.md:97-101`).
- Mechanism (`solvers/api/twocaptcha/twocaptcha_solver.py:37-92`): auto-detect site key / URL / user-agent from the page (`:57-63`), remap keys to the service's param names (`:66-73`), ship to the external service for a human/ML solve (`:85`), get a token back (`:87`), then inject the token into the page via a registered "applier" JS script (`apply_captcha`, `:89` -> `base_solver.py:369-384`).

**No AI-vision solver and no audio-solve path exist.** AI solver is a `TODO` only (`README.md:214`). hCaptcha is unsupported (`README.md:210`).

## 3. Public API / entry points + minimal snippet

Public exports (`playwright_captcha/__init__.py:18-25`):
`CaptchaType`, `FrameworkType`, `BaseSolver`, `ClickSolver`, `ApiSolverBase`, `TwoCaptchaSolver`. (`TenCaptchaSolver` exists at `solvers/api/tencaptcha/tencaptcha_solver.py` but is imported from its submodule, not the top-level `__all__`.)

Core call surface, all on `BaseSolver`:
- Construct: `ClickSolver(framework, page, max_attempts=3, attempt_delay=5)` (`solvers/click/click_solver.py:19`) or `TwoCaptchaSolver(framework, page, async_two_captcha_client, ...)` (`twocaptcha_solver.py:21-23`).
- **Must be used as an async context manager** (`async with ... as solver:`) OR call `await solver.prepare()` manually — `solve_captcha` raises `RuntimeError` if `prepare()` never ran (`base_solver.py:317-321`). `__aenter__` calls `prepare()`, `__aexit__` calls `cleanup()` (`base_solver.py:45-52`).
- **Order matters:** create the solver / call `prepare()` BEFORE `page.goto()`, because `prepare()` registers init scripts that must run on document creation (`base_solver.py:91-112`; README snippet comment `README.md:136`).
- Solve: `await solver.solve_captcha(captcha_container=page, captcha_type=CaptchaType.CLOUDFLARE_TURNSTILE)` (`base_solver.py:301`). Returns `True/False` for click solvers, a token `str` for API solvers (`base_solver.py:278`).
- Optional kwargs: `expected_content_selector` (skip solve if target content already visible — `base_solver.py:338-343`), manual `sitekey=` override if auto-detect fails (`README.md:310-312`).

Minimal keyless snippet copied from repo (`README.md:124-149`):
```python
import asyncio
from playwright.async_api import async_playwright
from playwright_captcha import CaptchaType, ClickSolver, FrameworkType

async def solve_captcha():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        framework = FrameworkType.PLAYWRIGHT
        # Create solver BEFORE navigating
        async with ClickSolver(framework=framework, page=page) as solver:
            await page.goto('https://example.com/with-captcha')
            await solver.solve_captcha(
                captcha_container=page,
                captcha_type=CaptchaType.CLOUDFLARE_TURNSTILE
            )
asyncio.run(solve_captcha())
```

## 4. Dependencies + paid keys

- Hard runtime dep (`pyproject.toml:15-17`): `2captcha-python-async` — a **fork** the author maintains because "2captcha-python doesn't accept my PR" (`requirements.txt:5-6`, pinned `==1.5.1`). Pulled in unconditionally even if you only want the keyless click solver (imported at top level: `__init__.py:10` -> `twocaptcha_solver.py:5`).
- Also in `requirements.txt`: `aiofiles==24.1.0` (JS-file loading), `python-dotenv==1.1.0`, plus pytest dev deps.
- `playwright` itself is assumed already installed and is only soft-required — `__init__.py:5-8` raises if `import playwright` fails; `requirements.txt:1-3` leaves it commented. Camoufox is optional (`requirements.txt:3`).
- **Paid keys:** The **click solver needs NO key** (keyless). API solvers need paid accounts: `TWO_CAPTCHA_API_KEY`, `TEN_CAPTCHA_API_KEY` (`.env.example:1-2`, `README.md:286-289`). You pass an already-constructed `AsyncTwoCaptcha(os.getenv('TWO_CAPTCHA_API_KEY'))` client into the solver (`README.md:163,176-178`) — the lib itself never hardcodes a service.

## 5. Plain Playwright/patchright pages, or own browser? Can we hand it an existing patchright page/CDP session?

- **It does NOT launch a browser.** You create the browser/context/page; you hand the solver an existing `page` plus a `FrameworkType` (`base_solver.py:25`, `click_solver.py:19`). The examples all launch their own Playwright just for the demo, but the solver only ever touches the `page` you give it.
- **Patchright is a first-class target.** `FrameworkType.PATCHRIGHT` exists (`types/frameworks.py:6`) and has a dedicated prep path (`base_solver.py:119-120`, `_prepare_patchright` at `:155-192`). README shows the patchright wiring (`README.md:227-238`).
- **BUT it mutates the page you hand it during `prepare()`** — not a clean read-only consumer:
  - Wraps `page.evaluate` so JS runs in the main world by default, restoring it on cleanup (`base_solver.py:158-168`, `:207-210`).
  - For patchright specifically, it opens its own CDP session off your page (`self.page.context.new_cdp_session(self.page)`, `base_solver.py:173`) and injects `unlockShadowRoot.js` (and, for API solvers, `interceptCloudflareInterstitialData.js`) via `Page.addScriptToEvaluateOnNewDocument` (`:176-188`), because patchright's normal `add_init_script` breaks subsequent `goto` with `ERR_NAME_NOT_RESOLVED` (`:170-171`, `:103-104`).
  - So yes, it can take an existing patchright page/CDP session — but only in Python, and it assumes it can register document-start scripts before your navigation. If HireMeOps has already navigated, the interstitial-intercept path won't fire.

## 6. Docker

None. No `Dockerfile`, no compose file, no container docs anywhere in the tree (`find` for `Dockerfile*`/`*docker*` returns nothing but the `.github/FUNDING.yml`).

## 7. Verdict — wiring into the patchright Node worker

**Language wall is the whole story.** HireMeOps' worker is Node driving patchright-JS; this library is async Python on patchright-Python. You cannot import it into the Node worker. Three real options, cheapest first:

1. **Reimplement the keyless Cloudflare click-solve natively in `automation/` (recommended if you want keyless).** The valuable, license-free part is `solve_cloudflare_by_click` (`solvers/click/cloudflare/solve_by_click.py`, ~130 lines) plus its shadow-root iframe search (`solvers/click/common/shadow_root.py`) and `unlockShadowRoot.js` (`utils/js_scripts/patches/unlockShadowRoot.js`). That logic — find the CF iframe inside closed shadow roots, wait for the checkbox, click it, verify `div#success`/networkidle — ports directly to patchright-JS, which already exposes `page.evaluate`, `frameLocator`, and CDP. This is essentially a more disciplined version of the "evasion + wait + click" auto-pass already in the codebase; adopting it means **upgrading the existing keyless solver's checkbox/shadow-DOM handling**, not adding a dependency. No new process, no Python.

2. **Skip the library for paid solving.** If you decide to wire a real (paid) solver, 2captcha and 10captcha both have first-party Node SDKs. Call them directly from the worker: detect sitekey+url in patchright-JS, POST to the service, inject the returned token. This library's API solver is just that wrapper plus an auto-detect step — no Node benefit, and it drags in a maintainer's personal 2captcha fork.

3. **Python sidecar (only if you specifically want THIS code, not worth it).** Run a small Python service exposing the solver over stdio/HTTP and have it attach to the worker's Chromium via CDP (`connect_over_cdp`) on the shared per-profile jar. Heavy: second runtime, second Playwright/patchright install, CDP session coordination against the jar the Node worker already drives, and the `prepare()`-before-`goto` ordering constraint fights the worker's existing navigation flow. Not justified for ~130 lines of clickable logic.

**Is it keyless-capable?** Yes — but only for Cloudflare Interstitial + Turnstile, and only as "stealthy browser clicks the checkbox," which is the same class of trick already in use. It gives you NO keyless answer for reCAPTCHA v2/v3 or hCaptcha (those are 2captcha/10captcha-paid or unsupported).

**Smallest integration:** don't take the dependency. Lift the Cloudflare click-solve algorithm + `unlockShadowRoot.js` into the Node worker as a hardened replacement for the current keyless auto-pass, and if paid solving is ever needed, call the 2captcha Node SDK directly. Mind the MIT-vs-Apache license discrepancy if you copy any source verbatim (Apache-2.0 requires attribution/NOTICE).
