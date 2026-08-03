// Catho job search + one-offer apply; scrapes /vagas into JobCards, applies via "Quero me candidatar".
// Key: buildCathoSearchUrl / cathoSlug — pure URL helpers, unit-testable without a browser
// Key: cathoSearchJobs — pages results, optional per-offer description enrichment
// Key: cathoApply — per-offer explicit apply click, never batch-auto

export function buildCathoSearchUrl({ query = "", areaIds = [], workModels = [], lastDays, page } = {}) {
  const parts = [];
  (Array.isArray(areaIds) ? areaIds : []).forEach((id, i) =>
    parts.push(`area_id[${i}]=${encodeURIComponent(id)}`),
  );
  (Array.isArray(workModels) ? workModels : []).forEach((m, i) => {
    const v = String(m).toLowerCase();
    const mapped = v.includes("onsite") || v.includes("presen") ? "presential" : v;
    parts.push(`work_model[${i}]=${encodeURIComponent(mapped)}`);
  });
  if (lastDays != null && `${lastDays}` !== "") parts.push(`lastdays=${encodeURIComponent(lastDays)}`);
  if (page != null && Number(page) > 1) parts.push(`page=${encodeURIComponent(page)}`);
  const qs = parts.length ? `?${parts.join("&")}` : "";
  return `https://www.catho.com.br/vagas/${cathoSlug(query)}/${qs}`;
}

export function cathoSlug(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function scrapeCathoPage(page) {
  return page.evaluate(() => {
    const origin = location.origin;
    const cards = Array.from(document.querySelectorAll("article.offer, li[data-offer-item]"));
    const jobs = cards.flatMap((card) => {
      const a = card.querySelector("h2.title_offer a[href]");
      if (!a) return [];
      const href = a.getAttribute("href") || "";
      const jobId =
        card.getAttribute("data-click-offer") ||
        card.getAttribute("data-offer-item") ||
        href.match(/\/(\d+)(?:[/?#]|$)/)?.[1] ||
        null;
      if (!jobId) return [];
      const title = (a.getAttribute("title") || a.textContent || "").trim() || null;
      const applyUrl = href ? new URL(href, origin).href : null;
      const company = (card.querySelector("p.mb-2 span.text-12")?.textContent || "").trim() || null;

      const locP = card.querySelector(".i_job_location")?.closest("p");
      let loc = null;
      if (locP) {
        const t = locP.textContent.replace(/\s+/g, " ").trim();
        const m = t.match(/-\s*(.+)$/);
        loc = (m ? m[1] : t).trim() || null;
      }
      const salary = (
        card.querySelector(".i_salary")?.closest("p")?.querySelector("strong")?.textContent || ""
      ).trim();

      return [
        {
          job_id: jobId,
          title,
          company,
          location: loc,
          apply_url: applyUrl,
          is_easy_apply: !!card.querySelector("[data-apply]"),
          description: salary ? `Salário: ${salary}` : null,
        },
      ];
    });
    return { jobs, hasNext: jobs.length > 0 };
  });
}

export async function cathoSearchJobs(page, opts = {}) {
  const { maxPages = 3, enrichDescriptions = true, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(50, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;

  for (let p = 1; p <= cap; p++) {
    await page.goto(buildCathoSearchUrl({ ...urlOpts, page: p }), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForSelector("article.offer, li[data-offer-item]", { timeout: 15_000 })
      .catch(() => {});

    const { jobs: pageJobs, hasNext } = await scrapeCathoPage(page);
    for (const job of pageJobs) {
      if (job.job_id && !seen.has(job.job_id)) {
        seen.add(job.job_id);
        jobs.push(job);
      }
    }
    hasNextAfterLast = hasNext;
    if (!hasNext || pageJobs.length === 0) break;
  }

  if (enrichDescriptions) {
    for (const job of jobs) {
      if (!job.apply_url) continue;
      try {
        await page.goto(job.apply_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const detail = await page.evaluate(() => {
          const el = document.querySelector(".whitespace-pre-line");
          return el ? el.textContent.replace(/[ \t]+\n/g, "\n").trim() : "";
        });
        if (detail) job.description = job.description ? `${job.description}\n\n${detail}` : detail;
      } catch {
      }
    }
  }

  return { jobs, has_next_page: hasNextAfterLast };
}

const CATHO_LOGIN_RE = /\/(login|acesso|entrar|autenticacao)|account\.catho|auth\.catho/i;

export async function cathoApply(page, { offerId, applyUrl } = {}) {
  if (!applyUrl) return { offerId, status: "not_found", reason: "no apply_url" };

  await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page
    .waitForSelector("[data-apply-container-detail], #form-apply-simple, button[data-apply]", {
      timeout: 15_000,
    })
    .catch(() => {});

  if (CATHO_LOGIN_RE.test(page.url())) {
    return { offerId, status: "needs_login", reason: "sign in to Catho, then retry" };
  }

  const btn = page
    .locator(
      "#form-apply-simple button[data-apply], [data-apply-container-detail] button[data-apply], button[data-apply]",
    )
    .first();
  if ((await btn.count()) === 0) return { offerId, status: "no_apply_button" };

  if (await page.locator("[data-sent-apply-indicator]").first().isVisible().catch(() => false)) {
    return { offerId, status: "applied" };
  }

  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click().catch(() => {});

  const applied = await page
    .locator("[data-sent-apply-indicator], .box_alerts.success")
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);

  return { offerId, status: applied ? "applied" : "submitted" };
}
