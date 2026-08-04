// Upwork job search scrape (view-only, no apply); reads window.__NUXT__ hydration state, falls back to DOM.
// Key: buildUpworkSearchUrl — pure URL helper
// Key: findJobsArray — deep-finds the job-card array inside __NUXT__ (state key hashes shift per build)
// Key: nuxtJobToCard / scrapeUpworkDom — map to shared JobCard shape (NUXT path / DOM fallback)
// Key: upworkSearchJobs — pages results, dedups by job_id; clears the Cloudflare wall via the keyless pass

import { passCaptchaIfChallenged } from "./captcha.js";

export function buildUpworkSearchUrl({
  query = "",
  sort = "recency",
  page,
  contractorTier = [],
  jobType = [],
} = {}) {
  const parts = [`nbs=1`, `q=${encodeURIComponent(String(query).trim())}`];
  if (sort) parts.push(`sort=${encodeURIComponent(sort)}`);
  const tiers = (Array.isArray(contractorTier) ? contractorTier : []).filter(
    (t) => t != null && `${t}` !== "",
  );
  if (tiers.length) parts.push(`contractor_tier=${tiers.map(encodeURIComponent).join(",")}`);
  const types = (Array.isArray(jobType) ? jobType : []).filter((t) => t != null && `${t}` !== "");
  if (types.length) parts.push(`t=${types.map(encodeURIComponent).join(",")}`);
  if (page != null && Number(page) > 1) parts.push(`page=${encodeURIComponent(page)}`);
  return `https://www.upwork.com/nx/search/jobs/?${parts.join("&")}`;
}

function stripTags(s) {
  return String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function findJobsArray(root) {
  const seen = new Set();
  const stack = [{ v: root, d: 0 }];
  while (stack.length) {
    const { v, d } = stack.pop();
    if (!v || typeof v !== "object" || d > 8) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length && v[0] && typeof v[0] === "object" && "ciphertext" in v[0] && "title" in v[0])
        return v;
      for (const item of v) stack.push({ v: item, d: d + 1 });
    } else {
      for (const key of Object.keys(v)) stack.push({ v: v[key], d: d + 1 });
    }
  }
  return null;
}

function nuxtJobToCard(j) {
  const cipher = j.ciphertext || (j.uid ? `~02${j.uid}` : null);
  if (!cipher) return null;
  const title = stripTags(j.title);
  const parts = [];
  const hb = j.hourlyBudget;
  if (hb && (hb.min || hb.max)) {
    parts.push(`Rate: $${hb.min ?? "?"}–$${hb.max ?? "?"}/hr`);
  } else if (j.amount && j.amount.amount) {
    parts.push(`Budget: $${j.amount.amount}`);
  }
  const skills = Array.isArray(j.attrs)
    ? j.attrs.map((a) => a && (a.prettyName || a.prefLabel)).filter(Boolean)
    : [];
  if (skills.length) parts.push(`Skills: ${skills.join(", ")}`);
  const body = stripTags(j.description);
  const description = [parts.join(" · "), body].filter(Boolean).join("\n\n") || null;
  const country = j.client && j.client.location && j.client.location.country;
  return {
    job_id: String(j.uid || cipher),
    title: title || null,
    company: null,
    location: country || null,
    apply_url: `https://www.upwork.com/jobs/${cipher}/`,
    is_easy_apply: false,
    description,
  };
}

function scrapeUpworkDom(page) {
  return page.evaluate(() => {
    const clean = (s) =>
      String(s ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const cards = Array.from(
      document.querySelectorAll('article.job-tile[data-test="JobTile"], article[data-ev-job-uid]'),
    );
    const jobs = cards.flatMap((card) => {
      const uid = card.getAttribute("data-ev-job-uid");
      const a = card.querySelector('a[data-test="job-tile-title-link"]');
      const href = a ? a.getAttribute("href") || "" : "";
      const m = href.match(/~0?2?(\d{6,})/) || (uid ? [null, uid] : null);
      const id = uid || (m ? m[1] : null);
      if (!id) return [];
      const title = clean(a ? a.textContent : "");
      const desc = clean(
        (card.querySelector('[data-test="JobDescription"] p, .air3-line-clamp p') || {})
          .textContent,
      );
      const skills = Array.from(
        card.querySelectorAll('[data-test="TokenClamp JobAttrs"] .air3-token'),
      )
        .map((t) => clean(t.textContent))
        .filter(Boolean);
      const info = Array.from(card.querySelectorAll('ul[data-test="JobInfo"] li'))
        .map((li) => clean(li.textContent))
        .filter(Boolean);
      const description =
        [info.join(" · "), skills.length ? `Skills: ${skills.join(", ")}` : "", desc]
          .filter(Boolean)
          .join("\n\n") || null;
      const cipher = href.match(/(~0\d\d+)/);
      const apply = cipher
        ? `https://www.upwork.com/jobs/${cipher[1]}/`
        : `https://www.upwork.com/jobs/~02${id}/`;
      return [
        {
          job_id: String(id),
          title: title || null,
          company: null,
          location: null,
          apply_url: apply,
          is_easy_apply: false,
          description,
        },
      ];
    });
    return jobs;
  });
}

export async function upworkSearchJobs(page, opts = {}) {
  const { maxPages = 3, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(20, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;

  for (let p = 1; p <= cap; p++) {
    await page.goto(buildUpworkSearchUrl({ ...urlOpts, page: p }), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Upwork fronts search with a Cloudflare wall. Give the interstitial a beat
    // to render, then run the keyless auto-pass (headed/Xvfb is what clears it);
    // best-effort — if it doesn't lift we still try to scrape whatever loaded.
    await page.waitForTimeout(1_500).catch(() => {});
    await passCaptchaIfChallenged(page).catch(() => {});
    await page
      .waitForSelector('article.job-tile[data-test="JobTile"], article[data-ev-job-uid]', {
        timeout: 20_000,
      })
      .catch(() => {});

    let pageJobs = [];
    const nuxt = await page
      .evaluate(() => (window.__NUXT__ ? window.__NUXT__ : null))
      .catch(() => null);
    if (nuxt) {
      const arr = findJobsArray(nuxt) || [];
      pageJobs = arr.map(nuxtJobToCard).filter(Boolean);
    }
    if (pageJobs.length === 0) {
      pageJobs = await scrapeUpworkDom(page).catch(() => []);
    }

    let added = 0;
    for (const job of pageJobs) {
      if (job.job_id && !seen.has(job.job_id)) {
        seen.add(job.job_id);
        jobs.push(job);
        added += 1;
      }
    }
    hasNextAfterLast = pageJobs.length > 0;
    if (added === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}

export { findJobsArray, nuxtJobToCard, stripTags };
