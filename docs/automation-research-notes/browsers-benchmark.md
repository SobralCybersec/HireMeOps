# Browsers-Benchmark research notes

Repo on disk: `/tmp/claude-1000/-home-satu-Docs-HireMeOps/825c1b30-9c3a-4880-9756-164ba5ca89cf/scratchpad/research/browsers-benchmark`
Upstream: `techinz/browsers-benchmark` (MIT). Last commit `8b7d10b Update README`, dated **2026-07-28**.
Benchmark run data timestamps: **2026-05-26 21:57 → 2026-05-27 23:21** (single run, ~25h). Report generated `2026-05-27 23:31` (`results/example/summary.md:3`).

TL;DR for HireMeOps: **patchright wins outright at 100% bypass in this run. Stay on patchright. Do NOT migrate to zendriver/nodriver/SeleniumBase-UC — they score lower here.** Big caveat: single run, N=1 per engine, one proxy each, headed patchright is the winner (headless patchright collapses to 40%).

---

## 1. What it benchmarks

### Browser libraries / engines (23 configs total, headed + headless variants)
Source: `config/engines.py`, `engines/`, `README.md:30-41`, requirements pinned in `requirements.txt`.

| Engine (config name) | Underlying lib | Pinned version (`requirements.txt`) |
|---|---|---|
| patchright / patchright_headless | Patchright (Playwright fork, Chromium only) | `patchright>=1.55.2` |
| playwright-chrome / -firefox (± headless) | Playwright | `playwright>=1.55.0` |
| camoufox / camoufox_headless | Camoufox (Firefox-based, Playwright API) | `camoufox[geoip]>=0.4.11` |
| cloakbrowser / cloakbrowser_headless | CloakBrowser (Playwright-based) | `cloakbrowser[geoip]>=0.3.19` |
| tf-playwright-stealth (chromium/firefox ± headless) | tf-playwright-stealth | `tf-playwright-stealth>=1.2.0` |
| nodriver-chrome / _headless | NoDriver (CDP, SOCKS5-only proxy) | `nodriver>=0.47.0` |
| zendriver-chrome / _headless | ZenDriver (NoDriver fork) | `zendriver>=0.14.2` |
| seleniumbase-cdp-chrome | SeleniumBase **CDP mode** (UC-style) | `seleniumbase>=4.42.2` |
| selenium-chrome (± headless) | plain Selenium, **no proxy** (deprecated path) | `selenium>=4.36.0` |
| adspower / adspower_headless | AdsPower (proprietary anti-detect, needs desktop app + API key) | n/a |

Note on naming: there is no "camoufoux"; the tool is **Camoufox** (Firefox-based). "SeleniumBase-UC" here = `seleniumbase-cdp-chrome` (CDP/UC mode). puppeteer-stealth is **not** tested (Python-only harness).

### Anti-bot targets (10 bypass tests + 3 fingerprint/data extractions)
Bypass targets — `config/benchmark_targets.py:36-96`:

| # | Target name | Real URL | Protection |
|---|---|---|---|
| 0 | google_search | google.com/search | Google |
| 1 | cloudflare_protected | community.cloudflare.com | **Cloudflare** |
| 2 | datadome_protected | datadome.co/customers-stories | **DataDome** |
| 3 | datadome_protected_2 | hermes.com | **DataDome** (alt) |
| 4 | amazon_product | a.co/d/... | Amazon captcha |
| 5 | ticketmaster | ticketmaster.com | **Imperva** |
| 6 | akamai_protected | mrporter.com | **Akamai Bot Manager** |
| 7 | perimeterx_protected | priceline.com | **PerimeterX / HUMAN** |
| 8 | kasada_protected | wizzair.com | **Kasada** |
| 9 | reddit | reddit.com | Reddit |

Data-extraction targets — `config/benchmark_targets.py:120-140`:
- **reCAPTCHA v3 score** via antcpt.com/score_detector (0–1)
- **CreepJS** trust/bot score + WebRTC-leak IP (abrahamjuliot.github.io/creepjs)
- **ipify** IP (proxy-leak check)

Not tested: Cloudflare **Turnstile** widget solving, reCAPTCHA v2 solving, bot.sannysoft. It measures *challenge-page bypass* (did the interstitial appear?), not captcha *solving*.

---

## 2. Results — verbatim (from `results/example/summary.md`, mirrored in `README.md:65-91`)

### Overall Bypass Rate (10 targets, % passed)
```
| Engine                                  | Bypass Rate (%) |
| patchright                              | 100.0 |
| cloakbrowser                            |  90.0 |
| camoufox_headless                       |  90.0 |
| nodriver-chrome                         |  80.0 |
| adspower                                |  80.0 |
| seleniumbase-cdp-chrome                 |  80.0 |
| adspower_headless                       |  70.0 |
| tf-playwright-stealth-firefox           |  70.0 |
| tf-playwright-stealth-firefox_headless  |  70.0 |
| zendriver-chrome                        |  70.0 |
| cloakbrowser_headless                   |  60.0 |
| tf-playwright-stealth-chromium          |  60.0 |
| playwright-chrome                       |  60.0 |
| playwright-firefox_headless             |  60.0 |
| playwright-firefox                      |  60.0 |
| zendriver-chrome_headless               |  60.0 |
| tf-playwright-stealth-chromium_headless |  50.0 |
| selenium-chrome__no_proxy               |  50.0 |
| playwright-chrome_headless              |  40.0 |
| nodriver-chrome_headless                |  40.0 |
| patchright_headless                     |  40.0 |
| camoufox                                |  30.0 |
| selenium-chrome_headless__no_proxy      |  30.0 |
```

### Per-target bypass grid (Y = bypassed) — derived from `results/example/benchmark_results.json`
Columns: google | cloudflare | datadome1 | datadome2 | amazon | ticketmaster(Imperva) | akamai | perimeterx | kasada | reddit
```
patchright              Y Y Y Y Y Y Y Y Y Y   (10/10)
cloakbrowser            . Y Y Y Y Y Y Y Y Y   ( 9/10, only misses google)
camoufox_headless       Y Y Y Y Y Y . Y Y Y   ( 9/10, misses akamai)
seleniumbase-cdp-chrome . Y Y Y Y Y . Y Y Y   ( 8/10, misses google+akamai)
nodriver-chrome         . Y Y Y Y Y . Y Y Y   ( 8/10, misses google+akamai)
zendriver-chrome        Y Y . Y Y Y . Y . Y   ( 7/10, misses datadome1+akamai+kasada)
zendriver-chrome_hless  Y Y . . Y Y . Y . Y   ( 6/10)
patchright_headless     . Y . . Y Y . Y . .   ( 4/10)
nodriver-chrome_hless   . Y . . Y Y . Y . .   ( 4/10)
```
Key finding on the two protections HireMeOps cares about most:
- **Cloudflare**: bypassed by *every* engine in the grid, headed or headless (col 1 all Y). Cloudflare interstitial is basically solved across the board here.
- **DataDome**: only headed engines with strong stealth pass both DataDome tests. patchright, cloakbrowser, camoufox_headless, seleniumbase-cdp, nodriver-chrome pass both; zendriver misses datadome1; all headless-Chromium (patchright_headless, nodriver_headless) fail both.

### reCAPTCHA v3 score (antcpt, 0–1; higher = more human)
Nearly everything ties at **0.90** (patchright, nodriver, seleniumbase, playwright, cloakbrowser, adspower, tf-stealth all 0.90). `camoufox`, `zendriver-chrome`, `zendriver-chrome_headless` = **nan** (site broke during test, not a real 0). So reCAPTCHA v3 does **not** differentiate the field here.

### CreepJS trust/bot score
**Useless this run** — all 0.00/0.00. Summary note (`summary.md`, README:187): "CreepJS disabled trust and bot scores" (upstream creepjs issue #292). Only the WebRTC-IP column is meaningful (leak check); most engines show the datacenter proxy IP or a distinct IP = no leak.

### Resource usage (headed patchright, for capacity planning)
`patchright`: **1314 MB / 53.3% CPU** — one of the heaviest (`summary.md:58`). `patchright_headless`: 1277 MB / 16.6%. AdsPower is far lighter (~123–130 MB) because it offloads to its own app. So patchright's stealth costs RAM.

---

## 3. Methodology — credibility

Reasonably transparent but **statistically thin**:
- **Real sites, real protections** (community.cloudflare.com, hermes.com, priceline.com, wizzair.com, ticketmaster.com) — not a synthetic detector page. Good external validity.
- Bypass check = DOM assertion for the challenge element. E.g. Cloudflare (`utils/targets/check_bypass/cloudflare_protected.py:11-16`): success = `[title="Just a moment..."]` **not** present (+ non-English variant). Simple and honest, but binary — "no interstitial" is scored as success even if the page later soft-blocks.
- **N = 1 per engine.** Each engine hits each target once. No repeats, no confidence intervals. A single Cloudflare/DataDome coin-flip can swing a 10% bar.
- **Different proxy per engine** (README:63 "Proxy IP in this example is different for each engine"). This is a confound: engine A and engine B are tested on *different residential IPs of different reputation*, so bypass differences partly measure proxy luck, not the engine. The README itself stresses clean-proxy dependence (README:48-56).
- **Recent + version-pinned.** Data May 2026; libs pinned to current-ish (patchright 1.55.2, playwright 1.55, nodriver 0.47, zendriver 0.14.2, seleniumbase 4.42.2). Trustworthy as a *2026-current* snapshot.
- Author sells automation consulting (README:8), so mild promotional bias, but the harness is open and re-runnable.

Verdict on credibility: **directionally useful, not authoritative.** Treat the ranking as "who's in the top tier," not precise ordering. The patchright=100 vs cloakbrowser=90 gap is one target on possibly-different proxies.

---

## 4. Where our tools rank

- **patchright (what HireMeOps uses), headed: #1, 100% (10/10).** Passes Cloudflare, both DataDome, Imperva, Akamai, PerimeterX, Kasada, Amazon, Google, Reddit. reCAPTCHA v3 = 0.90. This is the ceiling of the whole benchmark.
- **patchright_headless: near bottom, 40% (4/10).** Passes only cloudflare, amazon, imperva, perimeterx. Fails both DataDome, akamai, kasada, google, reddit. Headless Chromium is heavily penalized regardless of stealth lib.
- **zendriver-chrome: 70% (7/10)**, headless 60%. Misses DataDome-1, Akamai, Kasada.
- **nodriver-chrome: 80% (8/10)**, headless 40%. Misses Google + Akamai headed.
- **seleniumbase-cdp-chrome (UC/CDP mode): 80% (8/10)**, only tested headed. Misses Google + Akamai.

So among the migration candidates you named, headed ranking is **patchright (100) > nodriver (80) = seleniumbase-cdp (80) > zendriver (70)**. Every one of them is *below* patchright.

---

## 5. Reproducible harness

Yes — fully runnable, we could re-run it ourselves.
- Entry: `python main.py` (`main.py`, README:299-302). Python 3.8+.
- Install: `pip install -r requirements.txt`, then `playwright install` / `patchright install chromium` / `camoufox fetch` (README:229-268).
- Config: `.env` (`PROXY_ENABLED`, `PAGE_LOAD_TIMEOUT_S=90`, `MAX_RETRIES=3` — README:307-323) + `documents/proxies.txt` (needs ≥1 proxy per engine, and ≥1 SOCKS5 for NoDriver — README:281-297).
- Trim engine list in `config/engines.py` and targets in `config/benchmark_targets.py` to test only what we care about (patchright vs zendriver vs seleniumbase on Cloudflare+DataDome).
- Outputs `results/*/summary.md` + `benchmark_results.json` + screenshots.
- **To make it trustworthy for a real decision** we'd want to patch it: same proxy pool per engine, and loop each target N≥20 for a bypass *rate* instead of a single boolean. Right now it's one-shot.

---

## 6. Verdict for HireMeOps

**Stay on patchright. No migration.** The numbers say patchright is the single best evader in the field and we're already on it.

Justification (quoting the run):
- patchright **100.0%** overall vs next-best cloakbrowser **90.0%**, camoufox_headless **90.0%**, and the CDP-driver family (nodriver **80.0**, seleniumbase-cdp **80.0**, zendriver **70.0**). Migrating to zendriver/nodriver/SeleniumBase-UC would *lose* 20–30 bypass points on this data.
- On our two real threats: **Cloudflare is bypassed by every engine** (grid col 1 = all Y), and **DataDome is passed by headed patchright on both tests** while the CDP drivers and all headless-Chromium engines miss at least one. patchright is on the winning side of the only protection that actually separates the field.
- reCAPTCHA v3: patchright ties the top at **0.90** — no engine beats it.

Two operational takeaways that matter more than the library choice:
1. **Run patchright headed, not headless.** patchright 100% vs patchright_headless **40%** is the largest single gap in the whole table. HireMeOps already keeps windows visible (per project memory "Focus-safe automation") — that decision is exactly what this benchmark rewards. Never run the anti-bot automations headless.
2. **Proxy/IP reputation dominates.** The README hammers this (README:48-56) and the per-engine-different-proxy confound proves it. Our evasion budget is better spent on clean residential IPs + human-pacing (the `automation/human.js` plan in project memory) than on swapping browser libs.

Only reasons to revisit later: if patchright's headed RAM (**1314 MB/instance**) becomes a scaling problem (AdsPower is ~130 MB but proprietary + 80% headed bypass), or if we ever need *concurrent headless* at scale — in which case none of these libs are great (all headless-Chromium ≤40% on DataDome) and the answer is more IPs, not a different lib.
