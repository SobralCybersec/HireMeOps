# Google Dork Queries in 2026 — Research Findings

Research date: 2026-08-03. Context: HireMeOps builds Google "dork" queries
(`site:linkedin.com/jobs ("react" OR "typescript") remote after:2026-07-03`)
to discover jobs. User reports the dorks "have issues — maybe the date or the query."

TL;DR: **The date operator and its format are NOT the problem.** `after:YYYY-MM-DD`
still works in 2026. The real breakage is (a) automated dork queries hitting
Google's anti-bot wall (CAPTCHA / "unusual traffic") much harder in 2026, and
(b) `num=100` being dead so you now only get 10 results per request and must
paginate with `start=`. Overly long multi-`OR` dorks make both worse.

---

## 1. `after:` / `before:` operator — STILL WORKS in 2026

- **Status: working, still officially "beta"** (has been beta since April 2019).
  Confirmed functional in 2026 references.
- **Accepted date FORMATS:**
  - `YYYY-MM-DD` (canonical — e.g. `after:2026-07-03`) ✅
  - `YYYY` alone (e.g. `after:2026`) ✅
  - `YYYY/MM/DD` (slash form) also historically accepted by Google, but the
    2026 references only document the dash form. **Use `YYYY-MM-DD` — it's the
    documented, reliable one.** No unix timestamps.
  - So HireMeOps' existing `after:2026-07-03` is the CORRECT format. Format is
    not the bug.
- **Combines with `site:`** — yes. Example from 2026 ref:
  `filetype:pdf site:.gov "annual report" after:2024-01-01`, and
  `"keyword" after:2025-06-01 before:2026-01-01`.
- **2026 caveat / gotcha:** results can be *inconsistent* because the operator
  keys off page date metadata, which many sites report unreliably. A too-recent
  window (e.g. `after:` = yesterday) legitimately returns very few or zero
  results — not because it's broken, but because Google has indexed/dated few
  pages in that window yet. **Widen the window (e.g. last 30 days, not last 3
  days).**
- Separate but related: Google's *dropdown* time filters (Past hour/day/week…)
  broke worldwide in 2026 (returning random dates). The `before:`/`after:`
  operator is the recommended workaround and is unaffected by that dropdown bug.

Sources:
- https://www.digitalapplied.com/blog/google-search-operators-complete-2026-reference (updated 2026-04-10) — "Accepts YYYY-MM-DD or YYYY format"; combines with site:
- https://maxintel.org/google-dorking-reference-2026.html (2026) — YYYY-MM-DD or YYYY; still beta since April 2019; date metadata unreliable
- https://searchengineland.com/search-google-by-date-with-new-before-and-after-search-commands-315184 — operator origin/format
- https://www.androidauthority.com/google-search-time-filters-broken-3693606/ (2026) — dropdown time filters broken worldwide; operator is the workaround
- https://www.searchenginejournal.com/google-shares-insight-about-time-based-search-operators/545963/ — Google confirms YYYY-MM-DD or YYYY

## 2. `site:`, `intitle:`, `inurl:`, quoted phrases, `OR` — ALL STILL WORK

- All marked **STABLE** in 2026 references. Google supports ~25 operators in
  2026; none added since 2019.
- Working in 2026: `site:`, `filetype:`, `intitle:`/`allintitle:`,
  `inurl:`/`allinurl:`, `intext:`, exact-phrase quotes `"..."`, `OR` / `|`,
  and `-` exclusion.
- `OR` **must be UPPERCASE** (or use the `|` pipe). Lowercase `or` is treated as
  a stopword — a silent way to get wrong/empty results.
- **DEPRECATED / dead in 2026** (don't put these in a dork, they kill results):
  `link:`, `~` (synonym), `+`, `info:`, `inanchor:`/`allinanchor:`, and the
  public `cache:` operator (retired).
- The operators aren't blocked — but *automated* use of them is what trips the
  anti-bot systems (see §4).

Sources:
- https://www.digitalapplied.com/blog/google-search-operators-complete-2026-reference (2026-04-10) — STABLE list + deprecated list + OR must be uppercase
- https://maxintel.org/google-dorking-reference-2026.html (2026) — site:/filetype:/intitle:/inurl:/intext: "STABLE"; quotes/OR/minus stable; cache: retired

## 3. `num=100` REMOVED (Sept 2025) — confirmed dead in 2026; use `start=`

- Google silently disabled `&num=100` around **Sept 12–14, 2025**. Confirmed
  still gone in 2026.
- Google now returns **10 results per page regardless of `num`** — no error,
  no redirect, just capped at 10.
- **Pagination replacement: `start=` still works.** `start=0` (page 1),
  `start=10` (page 2), `start=20` (page 3)… 10 results each. To reach the old
  top-100 depth you now make **up to 10 paginated requests** per query.
- Impact reported: ~87.7% of monitored properties lost impressions; SEO tools
  and raw-HTTP scrapers broke overnight. Raw HTTP requests increasingly return
  empty/degraded responses.

Sources:
- https://decodo.com/blog/google-removes-num-100-parameter (2026) — 10/page regardless of num; start=10/20 pagination
- https://locomotive.agency/blog/google-removes-num100-parameter-what-this-means-for-your-website/ — Sept 12–14 2025 change
- https://geneo.app/blog/google-num100-removal-serp-cap-2025/ — SERP cap breaks tools; 10 requests for top-100
- https://brightdata.com/blog/web-data/google-search-url-parameters (2026 full list) — start= param reference
- https://www.demandsphere.com/blog/google-tests-forced-pagination-on-serps/ — forced pagination

## 4. Long/complex dorks + automation → CAPTCHA / "unusual traffic" (worse in 2026)

- **Detection threshold: ~15–20 queries per hour per IP** before CAPTCHAs start
  (figure cited by multiple 2026 dorking references, for a single investigator/IP).
- Detection signals: request frequency, IP reputation, browser fingerprinting,
  behavioral patterns (no mouse movement, no scroll, robotic timing).
- Escalation: CAPTCHA → temporary block → IP ban.
- **2026 enforcement got heavier:**
  - Google deployed **"SearchGuard" (Jan 2025)**, a JavaScript challenge system
    ("tens of thousands of person-hours, millions of dollars"). Raw HTTP dorks
    without JS execution increasingly fail.
  - Google **sued SerpApi (Dec 2025, N.D. Cal., DMCA)** over "hundreds of
    millions of automated queries" daily — signals aggressive posture toward
    automated SERP access.
- Google's ToS **prohibits automated queries**; manually typed dorks are fine.
  A Tauri app firing dorks in a headless/automated browser is exactly the
  pattern that trips this.
- **Long queries make it worse two ways:** (a) a 10-`OR` dork is a low-hit,
  "weird" query that itself looks bot-like and often returns few/zero results;
  (b) to cover many role×skill combos you fire *many* such queries fast, blowing
  past the 15–20/hr threshold and triggering CAPTCHA.

Best-practice query shape in 2026 (from the dorking refs + the mechanics above):
- Keep each query **short and specific**: 1 `site:` + a small quoted phrase or
  2–3 `OR` terms + one `after:` date. Don't stack 8–10 `OR`s in one query.
- **Split** a big role×skill matrix into several small queries rather than one
  giant `OR` monster — but then **pace them** (see below), because more queries
  = more rate-limit exposure. It's a tradeoff: fewer, tighter queries beat one
  bloated query AND beat a flood of medium ones.
- Stay **under ~15 queries/hour per IP** if driving Google directly. Add jitter
  between requests (random multi-second delays), run a real (non-headless-looking)
  browser that executes JS, and paginate with `start=` only as deep as needed
  (first 1–3 pages usually enough for fresh jobs).
- Widen the `after:` window (last ~30 days) so short queries still return a
  useful result set.

Sources:
- https://maxintel.org/google-dorking-reference-2026.html (2026) — 15–20 queries/hour threshold; detection signals; SearchGuard Jan 2025; SerpApi suit Dec 2025; cache: retired
- https://dumpsgate.com/google-dorking-cheat-sheet/ (2026) — dork operators + rate-limit cautions
- https://support.google.com/websearch/thread/66559735 — "after a couple of queries you get CAPTCHA" (dorks + automation)
- https://www.makeuseof.com/google-unusual-traffic-error-fix/ — unusual-traffic causes/fixes
- https://www.capsolver.com/blog/reCAPTCHA/solve-problem-unusual-traffic-computer-network — unusual-traffic mechanics

## 5. RECOMMENDED 2026 job-discovery dork TEMPLATE

Query shape (short, one date filter, few OR terms, uppercase OR):

    site:linkedin.com/jobs ("react" OR "typescript") remote after:2026-07-03

Rules baked in:
- `after:YYYY-MM-DD` — dash format, and use a ~30-day-back window, not 2–3 days.
  Optionally bound it: `after:2026-07-03 before:2026-08-03`.
- `OR` in **UPPERCASE**; keep to **2–3 OR terms max** per query. Split extra
  role/skill combos into separate short queries instead of one long `OR` chain.
- One `site:` per query (linkedin.com/jobs, inhire.io, gupy.io, etc.). Loop the
  boards as separate queries, don't `OR` many domains in one.
- Drop any dead operators (`cache:`, `link:`, `+`, `~`, `info:`, `inanchor:`).

Pagination:
- `num=100` is dead — do NOT rely on it. Paginate with
  `&start=0`, `&start=10`, `&start=20` (10 results each). For fresh jobs, pages
  1–3 (`start=0..20`) are usually enough; going to start=90 = 10 requests and
  10× the CAPTCHA risk.

Anti-block discipline (the actual fix for "dorks have issues"):
- Cap at **~10–15 queries/hour per IP**; add randomized multi-second jitter
  between queries.
- Drive a **real browser that executes JS** (SearchGuard blocks raw HTTP).
  Avoid obvious-headless fingerprints.
- Expect and handle CAPTCHA/"unusual traffic": back off, rotate, or pause —
  don't hammer through it.
- If volume must scale, a SERP API is the ToS-safe/de-risked route (though note
  Google is litigating against some SERP-API vendors as of Dec 2025).

Full template (per board, per small skill-group, paged):

    site:<board> ("<skill1>" OR "<skill2>") <remote|location> after:<today-30d>
    ...then &start=0, &start=10, &start=20 as needed, paced <15/hr with jitter.
