// 99freelas project search scrape (view-only, no apply); server-rendered cards, no Xvfb needed.
// Key: buildFreelas99SearchUrl — pure URL helper (`page=N`; site ignores `pagina=`)
// Key: scrapeFreelas99Page — description uses textContent (keeps hidden .details) over innerText
// Key: freelas99SearchJobs — pages results, dedups by job_id

export function buildFreelas99SearchUrl({ query = "", page } = {}) {
  const parts = [`q=${encodeURIComponent(String(query).trim())}`];
  // 99freelas paginates via `page=N` (NOT `pagina=` — the site silently ignores that and
  // re-serves page 1, which looked like "only crawls pages 1–2" because page 2 == page 1 → all dupes).
  if (page != null && Number(page) > 1) parts.push(`page=${encodeURIComponent(page)}`);
  return `https://www.99freelas.com.br/projects?${parts.join("&")}`;
}

function scrapeFreelas99Page(page) {
  return page.evaluate(() => {
    const origin = location.origin;
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll("li.result-item[data-id]"));
    const jobs = cards.flatMap((card) => {
      const jobId = card.getAttribute("data-id");
      if (!jobId) return [];
      const a = card.querySelector("hgroup h1.title a[href]");
      const href = a ? a.getAttribute("href") || "" : "";
      const title = clean(a ? a.textContent : card.getAttribute("data-nome") || "");
      const applyUrl = href ? new URL(href.split("?")[0], origin).href : null;
      if (!applyUrl) return [];

      const descEl = card.querySelector(".item-text.description");
      const dataContent = descEl ? descEl.getAttribute("data-content") || "" : "";
      let description = "";
      if (dataContent.trim()) {
        description = clean(dataContent.replace(/<[^>]+>/g, " "));
      } else if (descEl) {
        description = clean(descEl.textContent).replace(/…\s*Expandir/gi, " ").replace(/\bEsconder\b/gi, " ").trim();
      }

      const info = clean((card.querySelector(".item-text.information") || {}).textContent);
      const skills = Array.from(card.querySelectorAll(".item-text.habilidades a.habilidade"))
        .map((s) => clean(s.textContent))
        .filter(Boolean);
      const company = clean((card.querySelector(".item-text.client a") || {}).textContent) || null;

      const full = [info, skills.length ? `Habilidades: ${skills.join(", ")}` : "", description]
        .filter(Boolean)
        .join("\n\n");

      return [
        {
          job_id: jobId,
          title: title || null,
          company,
          location: null,
          apply_url: applyUrl,
          is_easy_apply: false,
          description: full || null,
        },
      ];
    });

    const active = document.querySelector(".pagination-component .page-item.selected");
    const cur = active ? Number(active.getAttribute("data-page")) : 1;
    const pages = Array.from(document.querySelectorAll(".pagination-component .page-item[data-page]"))
      .map((el) => Number(el.getAttribute("data-page")))
      .filter((n) => !Number.isNaN(n));
    const hasNext = pages.some((n) => n > cur);
    // The "Última" link carries the highest data-page, so max(pages) is the true last page.
    const lastPage = pages.length ? Math.max(...pages, cur) : cur;
    return { jobs, hasNext, lastPage };
  });
}

export async function freelas99SearchJobs(page, opts = {}) {
  const { maxPages = 30, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from the pagination on page 1 (the "Última" link)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    await page.goto(buildFreelas99SearchUrl({ ...urlOpts, page: p }), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // The result cards render via JS AFTER domcontentloaded; `.search-page-header` appears immediately,
    // so waiting on it resolved too early and we scraped an empty list (0 projects). Wait for the actual
    // project cards instead. If none appear (genuinely empty / captcha), fall through and scrape 0.
    await page.waitForSelector("li.result-item[data-id]", { timeout: 15_000 }).catch(() => {});

    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeFreelas99Page(page);
    // Learn the real last page from page 1 so we paginate all the way to it (capped at maxPages),
    // instead of stopping at a hardcoded few pages.
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    for (const job of pageJobs) {
      if (job.job_id && !seen.has(job.job_id)) {
        seen.add(job.job_id);
        jobs.push(job);
      }
    }
    hasNextAfterLast = hasNext;
    // March all the way to the detected last page (e.g. 12) even when the widget hides the middle
    // pages — we fetch each `page=N` by URL regardless of whether it's a clickable chip. Only stop
    // early on a genuinely EMPTY page (real end / captcha), never on `!hasNext` (a middle page often
    // omits a "next" chip) and never on all-duplicates (the old `pagina=` bug that re-served page 1
    // is gone now that we use `page=`).
    if (pageJobs.length === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}
