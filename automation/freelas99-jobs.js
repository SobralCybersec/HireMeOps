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
    const readDescription = (card) => {
      const descEl = card.querySelector(".item-text.description");
      const dataContent = descEl?.getAttribute("data-content") || "";
      if (dataContent.trim()) return clean(dataContent.replace(/<[^>]+>/g, " "));
      return descEl
        ? clean(descEl.textContent).replace(/…\s*Expandir/gi, " ").replace(/\bEsconder\b/gi, " ").trim()
        : "";
    };

    const readCardDetails = (card) => {
      const info = clean(card.querySelector(".item-text.information")?.textContent);
      const skills = Array.from(card.querySelectorAll(".item-text.habilidades a.habilidade"))
        .map((s) => clean(s.textContent))
        .filter(Boolean);
      const company = clean(card.querySelector(".item-text.client a")?.textContent) || null;
      return { info, skills, company, description: readDescription(card) };
    };

    const readCardLink = (card) => {
      const a = card.querySelector("hgroup h1.title a[href]");
      const href = a ? a.getAttribute("href") || "" : "";
      const applyUrl = href ? new URL(href.split("?")[0], origin).href : null;
      return { a, applyUrl };
    };

    const readCard = (card) => {
      const jobId = card.getAttribute("data-id");
      if (!jobId) return [];
      const { a, applyUrl } = readCardLink(card);
      if (!applyUrl) return [];
      const title = clean(a ? a.textContent : card.getAttribute("data-nome") || "");
      const { info, skills, company, description } = readCardDetails(card);
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
    };

    const pagination = () => {
      const active = document.querySelector(".pagination-component .page-item.selected");
      const cur = active ? Number(active.getAttribute("data-page")) : 1;
      const pages = Array.from(document.querySelectorAll(".pagination-component .page-item[data-page]"))
      .map((el) => Number(el.getAttribute("data-page")))
      .filter((n) => !Number.isNaN(n));
      return {
        hasNext: pages.some((n) => n > cur),
        lastPage: pages.length ? Math.max(...pages, cur) : cur,
      };
    };

    const jobs = Array.from(document.querySelectorAll("li.result-item[data-id]")).flatMap(readCard);
    return { jobs, ...pagination() };
  });
}

async function scrapeFreelas99PageAt(page, urlOpts, pageNumber) {
  await page.goto(buildFreelas99SearchUrl({ ...urlOpts, page: pageNumber }), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector("li.result-item[data-id]", { timeout: 15_000 }).catch(() => {});
  return scrapeFreelas99Page(page);
}

function mergeFreelas99Jobs(jobs, seen, pageJobs) {
  for (const job of pageJobs) {
    if (!job.job_id || seen.has(job.job_id)) continue;
    seen.add(job.job_id);
    jobs.push(job);
  }
}

export async function freelas99SearchJobs(page, opts = {}) {
  const { maxPages = 30, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from the pagination on page 1 (the "Última" link)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeFreelas99PageAt(page, urlOpts, p);
    // Learn the real last page from page 1 so we paginate all the way to it (capped at maxPages),
    // instead of stopping at a hardcoded few pages.
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    mergeFreelas99Jobs(jobs, seen, pageJobs);
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
