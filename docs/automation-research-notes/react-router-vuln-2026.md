# react-router / react-router-dom — 2026 vuln triage

Context: client-side-only SPA, `react-router-dom` v7.x, `createBrowserRouter` (Data Mode),
no SSR / no Framework mode / no server. `npm audit` flags HIGH, vulnerable range `>=7.12.0-pre.0`.

## 1. The 2026 advisories (what npm audit is actually stacking)

All four hit the react-router v7 line in 2026. The `>=7.12.0-pre.0` in your audit is npm's
normalized *installed-is-a-prerelease* lower bound — it means npm resolved your tree to a
7.12-line **pre-release** build, and every advisory whose range extends past it collapses into
one flag.

| ID | Type | Severity | react-router affected | Fixed | Hits a pure client SPA? |
|----|------|----------|----------------------|-------|--------------------------|
| **CVE-2026-42342** / GHSA-8x6r-g9mw-2r78 | DoS via unbounded path expansion, `__manifest` endpoint | **HIGH** (CVSS 7.5) | `>=7.0.0 <7.15.0` | **7.15.0** | **No** — Framework Mode / server only |
| CVE-2026-22029 / GHSA-2w69-qvjg-hvjx | XSS via open redirects (loaders/actions) | HIGH (CVSS 8.0) | `>=7.0.0 <=7.11.0` | 7.12.0 | Only if you build redirects from untrusted input |
| CVE-2026-21884 / GHSA-8v8x-cx79-35w7 | XSS in `<ScrollRestoration>` getKey/storageKey during SSR | HIGH (CVSS 8.2) | `<=7.11.x` | 7.12.0 | **No** — Framework Mode **SSR** only |
| CVE-2026-53668 / GHSA-jjmj-jmhj-qwj2 | Open redirect leading to XSS | Moderate (CVSS 6.9) | `>=7.9.6 <=7.12.0` | 7.13.0 | Only if you build redirects from untrusted input |

The one **HIGH** advisory whose range still covers the 7.12–7.14 line (and therefore is what your
`>=7.12.0-pre.0` HIGH flag resolves to) is **CVE-2026-42342, the `__manifest` DoS** — fixed in
**7.15.0**. Everything below 7.15.0 stays flagged HIGH until you cross that line.
[2026-06] https://github.com/advisories/GHSA-8x6r-g9mw-2r78
[2026-01] https://github.com/advisories/GHSA-2w69-qvjg-hvjx
[2026-07] https://github.com/advisories/GHSA-jjmj-jmhj-qwj2

## 2. Applies-to-SPA verdict — mostly NO, not exploitable in your app

Pure client SPA, `createBrowserRouter`, no SSR, no server runtime:

- **DoS (`__manifest`) — NOT exploitable.** The `__manifest` endpoint only exists in Framework
  Mode's server runtime. You have no server. There is no endpoint to flood. This is the HIGH flag,
  and it does not touch you. Advisory text: not impacted in Declarative or Data Mode.
- **ScrollRestoration SSR XSS — NOT exploitable.** Requires SSR in Framework Mode. You render
  client-side. Dead in the water.
- **Open-redirect XSS (both CVE-2026-22029 and -53668) — technically in Data Mode's scope, but
  only *practically* exploitable if your own loaders/actions construct a redirect target from
  untrusted content** (user-supplied `?next=` / `?returnTo=` style params fed into a `redirect()`
  or `<Navigate to>`). A typical client SPA with no server loaders and no untrusted-input redirects
  has no reachable sink. Check your code for `redirect(` / `Navigate to={...}` built from URL params
  before you call it a real risk.

Bottom line: the HIGH-severity finding driving your audit (the DoS) is **not exploitable** in a
client-only SPA. This is an audit-noise HIGH, not a live hole — but you still want it green.

## 3. Fixed version — upgrade to stable `7.15.0` (or latest 7.x)

- `react-router-dom` / `react-router` **>= 7.15.0** clears **every** 2026 advisory, including the
  DoS (the highest fix bar). 7.13.0 alone does NOT — it leaves the DoS HIGH flag.
- 7.15.0 is a **minor** bump inside the same major (v7 → v7). Per semver it is **non-breaking**.
  The only caveat: 7.15.0 stabilized some `unstable_*` APIs (`unstable_instrumentations` →
  `instrumentations`, `unstable_useTransitions` → `useTransitions`). If you never opted into those
  experimental flags — and a normal SPA hasn't — nothing in your code changes.
  [2026-05] https://github.com/remix-run/react-router/releases
- Install: `npm i react-router-dom@^7.15.0` (react-router is pulled transitively; the caret keeps
  you on the safe 7.x line and picks up later 7.x patches).

## 4. The pre-release trap — yes, you're on a pre-release; pin to stable

`>=7.12.0-pre.0` is not a real vulnerable-*range* boundary anyone published — it's npm audit
echoing that **your installed build is a `7.12.0-pre.x` pre-release**. That happens when a
`package.json` range like `^7.12.0-pre.0`, or a `@next` / `@pre` dist-tag, or a lockfile pinned to
an RC pulled a pre-release instead of a stable release. Pre-releases sit *outside* normal semver
resolution, so they also dodge the stable patched versions — the audit can't "fix" its way out.

**The fix is exactly what you suspected: get off the pre-release, pin to stable.**
1. In `package.json`, set `"react-router-dom": "^7.15.0"` (drop any `-pre` / `next` tag).
2. Delete the react-router entries from the lockfile (or `npm i react-router-dom@^7.15.0`), reinstall.
3. `npm audit` → HIGH clears. `npm ls react-router react-router-dom` → confirm both resolve to a
   plain `7.15.x`, no `-pre` suffix.

No major upgrade, no code rewrite. It's a pin, not a migration.

---
### Sources
- CVE-2026-42342 DoS (HIGH, fix 7.15.0): https://github.com/advisories/GHSA-8x6r-g9mw-2r78 [2026-06]
- CVE-2026-22029 open-redirect XSS (HIGH, fix 7.12.0): https://github.com/advisories/GHSA-2w69-qvjg-hvjx [2026-01]
- CVE-2026-21884 ScrollRestoration SSR XSS (HIGH, fix 7.12.0): https://github.com/advisories/GHSA-8v8x-cx79-35w7 [2026-01]
- CVE-2026-53668 open redirect → XSS (Moderate, fix 7.13.0): https://github.com/advisories/GHSA-jjmj-jmhj-qwj2 [2026-07]
- react-router 7.15.0 release / changelog: https://github.com/remix-run/react-router/releases [2026-05]
- Netlify roundup of RR 2026 CVEs: https://www.netlify.com/changelog/2026-07-23-react-router-security-vulnerabilities/ [2026-07]
