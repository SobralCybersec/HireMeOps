// ProgramaThor job search scrape (view-only, no apply). Server-rendered Rails
// list, so no Xvfb / anti-bot dance — a plain paginated GET per page.
// Key: buildProgramathorSearchUrl — `/jobs` (page 1) or `/jobs/page/N`; a query
//   that matches a known skill slug narrows to `/jobs-<slug>` (else the full list,
//   which the CV scorer filters downstream since every posting here is a dev job).
// Key: scrapeProgramathorPage — one <a href="/jobs/ID-..."> per `.cell-list`
//   (ad cells have no /jobs/ link → skipped); job_id = the leading digits.
// Key: programathorSearchJobs — pages by URL to the detected last page, capped.

// A query is only turned into a `/jobs-<slug>` narrow when it cleanly maps to a
// single ProgramaThor skill; multi-word roles ("Backend Engineer") fall back to
// the full recent list. Kept tiny on purpose — the scorer does the real matching.
function skillSlug(query) {
  const q = String(query ?? "")
    .toLowerCase()
    .trim();
  if (!q) return null;
  const map = {
    react: "react",
    reactjs: "react",
    node: "node-js",
    "node.js": "node-js",
    nodejs: "node-js",
    python: "python",
    java: "java",
    go: "go",
    golang: "go",
    rust: "rust",
    php: "php",
    ".net": "net",
    dotnet: "net",
    typescript: "typescript",
    angular: "angular",
    "vue.js": "vue-js",
    vue: "vue-js",
    devops: "devops",
    qa: "quality-assurance",
  };
  return map[q] ?? null;
}

export function buildProgramathorSearchUrl({ query = "", page } = {}) {
  const base = "https://programathor.com.br";
  const slug = skillSlug(query);
  const root = slug ? `/jobs-${slug}` : "/jobs";
  // Page 1 has no `/page/1` suffix; higher pages are `/page/N`.
  const path = page != null && Number(page) > 1 ? `${root}/page/${Number(page)}` : root;
  return `${base}${path}`;
}

function scrapeProgramathorPage(page) {
  return page.evaluate(() => {
    const origin = location.origin;
    const clean = (s) =>
      String(s ?? "")
        .replace(/\s+/g, " ")
        .trim();

    const readJobLink = (cell) => {
      const a = cell.querySelector('a[href^="/jobs/"]');
      const href = a ? a.getAttribute("href") || "" : "";
      const m = href.match(/\/jobs\/(\d+)/);
      return href && m ? { a, href, jobId: m[1] } : null;
    };

    const readTitle = (a) => {
      const h3 = a.querySelector("h3");
      if (!h3) return "";
      const clone = h3.cloneNode(true);
      clone.querySelectorAll(".new-label, .presential-only-badge").forEach((n) => n.remove());
      return clean(clone.textContent);
    };

    const readIconText = (a, selector) => {
      const icon = a.querySelector(`.cell-list-content-icon i.${selector}`);
      return clean(icon?.closest("span")?.textContent);
    };

    const buildJob = ({ a, href, jobId }) => {
      const location = readIconText(a, "fa-map-marker-alt");
      const fields = [
        location ? `Local: ${location}` : "",
        readIconText(a, "fa-chart-bar") ? `Nível: ${readIconText(a, "fa-chart-bar")}` : "",
        readIconText(a, "fa-file-alt") ? `Contrato: ${readIconText(a, "fa-file-alt")}` : "",
        readIconText(a, "fa-money-bill-alt") ? `Salário: ${readIconText(a, "fa-money-bill-alt")}` : "",
      ];
      const skills = Array.from(a.querySelectorAll(".tag-list.background-gray"))
        .map((tag) => clean(tag.textContent))
        .filter(Boolean);
      if (skills.length) fields.push(`Skills: ${skills.join(", ")}`);
      return {
        job_id: jobId,
        title: readTitle(a) || null,
        company: readIconText(a, "fa-briefcase") || null,
        location: location || null,
        apply_url: new URL(href.split("?")[0], origin).href,
        is_easy_apply: false,
        description: fields.filter(Boolean).join("\n") || null,
      };
    };

    const readCell = (cell) => {
      const link = readJobLink(cell);
      return link ? [buildJob(link)] : [];
    };

    const jobs = Array.from(document.querySelectorAll(".cell-list")).flatMap(readCell);

    // Pagination: the "Last »" link carries the highest /jobs/page/N, and a
    // rel="Próx" link means there's a next page from where we are.
    const pageNums = Array.from(document.querySelectorAll(".pagination .page-link[href]"))
      .map((el) => {
        const mm = (el.getAttribute("href") || "").match(/\/page\/(\d+)/);
        return mm ? Number(mm[1]) : NaN;
      })
      .filter((n) => !Number.isNaN(n));
    const lastPage = pageNums.length ? Math.max(...pageNums) : 1;
    const hasNext = !!document.querySelector('.pagination .page-link[rel="Próx"]');
    return { jobs, hasNext, lastPage };
  });
}

async function scrapeProgramathorPageAt(page, urlOpts, pageNumber) {
  await page.goto(buildProgramathorSearchUrl({ ...urlOpts, page: pageNumber }), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector(".cell-list a[href^='/jobs/']", { timeout: 15_000 }).catch(() => {});
  return scrapeProgramathorPage(page);
}

function mergeProgramathorJobs(jobs, seen, pageJobs) {
  for (const job of pageJobs) {
    if (!job.job_id || seen.has(job.job_id)) continue;
    seen.add(job.job_id);
    jobs.push(job);
  }
}

export async function programathorSearchJobs(page, opts = {}) {
  const { maxPages = 5, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from page 1's "Last »" link (capped at maxPages)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeProgramathorPageAt(page, urlOpts, p);
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    mergeProgramathorJobs(jobs, seen, pageJobs);
    hasNextAfterLast = hasNext;
    // Stop only on a genuinely empty page (real end / block), never on !hasNext.
    if (pageJobs.length === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}
