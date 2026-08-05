# Automation worker & scrapers

Node + [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) browser worker and the per-board job scrapers driven by the Rust app. All flows share one per-profile Chromium cookie jar (`profiles/<id>/browser`), so a single login covers every site.

## Headless smoke test

`headless-test.mjs` runs every job-search automation once, headless, against a real jar, and drops the same proof bundle the live app does (`.html` + `.png` + `.pdf` + `.json` + `.mhtml`) under `automation/captures/`.

```bash
# all sites, query "developer"
node automation/headless-test.mjs

# only these sites, custom query
node automation/headless-test.mjs linkedin,gupy react

# against a logged-in jar (required for the login-gated boards)
HMO_PROFILE_DIR=~/.local/share/com.hiremeops.app/profiles/default/browser \
  node automation/headless-test.mjs

# watch it run (headed instead of headless)
HMO_HEADED=1 node automation/headless-test.mjs
```

Exit code = number of sites that **errored** (crash/timeout). A login-gated site returning `0` without a jar is noted, not an error.

## Status — last headless run

Headless, against the `default` jar, query `"developer"`, **2026-08-05**. "Jobs" is the count parsed in that single run (`maxPages=1`), not a benchmark.

| Site | Phase | Headless | Jobs | Notes |
|---|---|:--:|:--:|---|
| **programathor** | module | ✅ working | 15 | View-only board scraper |
| **geekhunter** | module | ✅ working | 10 | View-only board scraper |
| **99freelas** (`freelas99`) | module | ✅ working | 1 | View-only; low count is the query, not a fault |
| **gupy** | module | ✅ working | 12 | Jar login honored |
| **infojobs** | module | ✅ working | 20 | Jar login honored |
| **catho** | module | ✅ working | 20 | Fixed — was a WAF **403** on the `HeadlessChrome` UA (see below) |
| **linkedin** (jobs) | rpc/worker | ✅ working | 25 | Real worker RPC path |
| **linkedin** (hiring posts) | rpc/worker | ✅ working | 3 | Real worker RPC path |
| **google dork** (board discovery) | rpc/worker | ✅ working | 10 | Worked headless this run |
| **upwork** | module | ⚠️ 0 results | 0 | No crash; Cloudflare-gated — needs the headed **+ Xvfb / Docker** path |
| **indeed** | rpc/worker | ❌ blocked | 0 | "Verify you're human" challenge — needs the headed path |

**Summary: 9/11 return jobs headless.** Upwork runs without crashing but returns nothing headless (Cloudflare), and Indeed hard-blocks with a human-verify challenge — both are headed-only, run them through the headed **+ Xvfb** path (the [Docker worker runtime](../README.md#optional-run-the-worker-in-docker) provides exactly that). Proof bundles for every run land in `automation/captures/`.

### Cloudflare-gated sites (Upwork, Indeed) — research + verdict

Investigated whether Upwork/Indeed can be scraped **headless** (2026 state of the art). Tools/repos surveyed: **patchright** (what we use — patches `navigator.webdriver` + the `Runtime.enable` CDP leak), **rebrowser-patches** (marginally stronger granular CDP fix), **nodriver** (undetected-chromedriver successor, CDP-level), **camoufox** (hardened Firefox, ~42 s/challenge, Python-only), **SeleniumBase UC**, **FlareSolverr**, **browser_oxide** (Rust, native TLS/JA4), **curl_cffi** (TLS-only). Consensus: Cloudflare scores a *composite* of TLS/JA3-JA4 + JS fingerprint + behavior + **IP reputation** — you must pass every layer at once.

Empirically fingerprinted our headless browser against both sites and a control:

| Signal | Our headless | Verdict |
|---|---|---|
| `navigator.webdriver` | `false` | ✅ patched |
| `window.chrome` | present | ✅ |
| WebGL renderer | SwiftShader → (with GPU flags) real `NVIDIA RTX 3060` | tell fixable, but see below |
| window size | 800×600 → **1920×1080** (now default) | ✅ fixed |
| UA | de-Headlessed | ✅ fixed |
| **nowsecure.nl** (standard CF Turnstile) | **200 — passes** | ✅ our stealth clears standard Cloudflare |
| **Upwork / Indeed** | **403 interstitial** even with a *flawless* fingerprint (real GPU, real window) | ❌ IP/edge-bound |

**Verdict:** our headless stealth already passes a standard Cloudflare challenge (nowsecure 200). Upwork/Indeed still hard-403 with a perfect fingerprint and print the client IP on the block page → the block is **IP-reputation / edge scoring, not a browser tell**. Repeated automated hits from one residential IP get it penalty-boxed. More browser stealth won't fix it. The real levers: (1) the **headed + Xvfb** "hidden" mode (real display + GPU + human behavior — the [Docker worker](../README.md#optional-run-the-worker-in-docker) path), (2) **residential-proxy rotation** for fresh IP reputation, (3) an IP cooldown. Paid Turnstile solvers exist (2captcha/CapSolver) but conflict with the keyless/no-API design. Shipped from this research: the de-Headlessed UA (below) + a real 1920×1080 window; GPU-renderer forcing is left to the headed path since it's hardware-dependent and didn't move the IP-gated sites.

### Catho 403 fix — de-Headlessed UA

Headless Chromium advertises `HeadlessChrome/<v>` in its `User-Agent`; Catho's WAF returns a bare **403 Forbidden** to it before any JS runs. The fix (`browser-launch.js`, shared by the worker and this harness) overrides the UA at the **browser level** (`--user-agent`, matching the installed Chromium's major so it stays coherent with Client Hints — *not* Playwright's context `userAgent`, which desyncs from Client Hints) only for headless launches. That single change took Catho from `403 → 200` (20 offers) with no regression on any other site.
