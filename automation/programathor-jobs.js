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

    const jobs = Array.from(document.querySelectorAll(".cell-list")).flatMap((cell) => {
      const a = cell.querySelector('a[href^="/jobs/"]');
      const href = a ? a.getAttribute("href") || "" : "";
      // Ad cells (`min-height-180`) and other non-job cells have no /jobs/ link.
      if (!href) return [];
      const m = href.match(/\/jobs\/(\d+)/);
      const jobId = m ? m[1] : null;
      if (!jobId) return [];

      // Title lives in <h3.text-24>; drop the "NOVA" / presencial badges.
      const h3 = a.querySelector("h3");
      let title = "";
      if (h3) {
        const clone = h3.cloneNode(true);
        clone.querySelectorAll(".new-label, .presential-only-badge").forEach((n) => n.remove());
        title = clean(clone.textContent);
      }

      // The icon row: each <span> is prefixed by a Font-Awesome <i>. Read them by
      // their icon class so a reordered/missing field never shifts the mapping.
      const iconText = (sel) => {
        const icon = a.querySelector(`.cell-list-content-icon i.${sel}`);
        const span = icon ? icon.closest("span") : null;
        return span ? clean(span.textContent) : "";
      };
      const company = iconText("fa-briefcase") || null;
      const locationRaw = iconText("fa-map-marker-alt");
      const seniority = iconText("fa-chart-bar");
      const contract = iconText("fa-file-alt");
      const salary = iconText("fa-money-bill-alt");

      const skills = Array.from(a.querySelectorAll(".tag-list.background-gray"))
        .map((t) => clean(t.textContent))
        .filter(Boolean);

      const full = [
        locationRaw ? `Local: ${locationRaw}` : "",
        seniority ? `Nível: ${seniority}` : "",
        contract ? `Contrato: ${contract}` : "",
        salary ? `Salário: ${salary}` : "",
        skills.length ? `Skills: ${skills.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return [
        {
          job_id: jobId,
          title: title || null,
          company,
          location: locationRaw || null,
          apply_url: new URL(href.split("?")[0], origin).href,
          is_easy_apply: false,
          description: full || null,
        },
      ];
    });

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

export async function programathorSearchJobs(page, opts = {}) {
  const { maxPages = 5, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from page 1's "Last »" link (capped at maxPages)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    await page.goto(buildProgramathorSearchUrl({ ...urlOpts, page: p }), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // Server-rendered, but wait for the first card so a slow first byte doesn't
    // scrape an empty list. If none appear (genuinely empty / blocked), scrape 0.
    await page.waitForSelector(".cell-list a[href^='/jobs/']", { timeout: 15_000 }).catch(() => {});

    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeProgramathorPage(page);
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    for (const job of pageJobs) {
      if (job.job_id && !seen.has(job.job_id)) {
        seen.add(job.job_id);
        jobs.push(job);
      }
    }
    hasNextAfterLast = hasNext;
    // Stop only on a genuinely empty page (real end / block), never on !hasNext.
    if (pageJobs.length === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}
