// GeekHunter job search scrape (view-only, no apply). Chakra-UI SPA: cards
// render after JS, so we wait for the first job link before scraping. The
// className hashes (css-XXXX) are build-volatile, so selectors lean on stable
// anchors (aria-label, href shape, emoji) with textContent fallbacks.
// Key: buildGeekhunterSearchUrl — `?searchTerm=&page=N` (+ optional remote + recency)
// Key: scrapeGeekhunterPage — one <a aria-label="Visualizar vaga"> per card;
//   job_id = the `<company>/<slug>` tail of the href
// Key: geekhunterSearchJobs — pages to the detected last page, capped

export function buildGeekhunterSearchUrl({ query = "", page, remoteOnly = false } = {}) {
  const parts = [`searchTerm=${encodeURIComponent(String(query).trim())}`];
  if (page != null && Number(page) > 1) parts.push(`page=${Number(page)}`);
  // Newest-first so repeated runs surface fresh postings before the cap bites.
  parts.push("orderBy=moreRecent");
  if (remoteOnly) parts.push("workModality=remote");
  return `https://www.geekhunter.com/pt/vagas?${parts.join("&")}`;
}

function scrapeGeekhunterPage(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    const readCardLink = (a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pt\/([^/]+)\/jobs\/([^/?#]+)/);
      return m ? { href, company: decodeURIComponent(m[1]).replace(/-/g, " "), jobId: `${m[1]}/${m[2]}` } : null;
    };
    const readCardText = (a) => Array.from(a.querySelectorAll("p.chakra-text")).map((p) => clean(p.textContent));
    const readCardFields = (a) => {
      const ps = readCardText(a);
      const location = ps.find((t) => /brasil/i.test(t)) || ps.find((t) => /,\s*[A-Z]{2}\b/.test(t)) || null;
      return {
        ps,
        title: ps.find((t) => t.length > 3) || null,
        location,
        modality: ps.find((t) => /^(remoto|h[íi]brido|presencial)$/i.test(t)) || "",
        salary: ps.find((t) => /R\$/.test(t)) || "",
        skills: Array.from(a.querySelectorAll(".css-dqhvn"))
          .map((s) => clean(s.textContent))
        .filter((s) => s && !/^\+\d+$/.test(s)),
      };
    };
    const cardDescription = ({ modality, location, salary, skills }) =>
      [
        modality ? `Modalidade: ${modality}` : "",
        location ? `Local: ${location}` : "",
        salary ? `Salário: ${salary}` : "",
        skills.length ? `Skills: ${skills.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    const buildCard = ({ a, href, company, jobId }) => {
      const fields = readCardFields(a);
      const cleanLocation = fields.location ? fields.location.replace(/^[^\p{L}]+/u, "").trim() : null;
      return {
        job_id: jobId,
        title: fields.title,
        company: company || null,
        location: cleanLocation,
        apply_url: href.startsWith("http") ? href.split("?")[0] : `https://www.geekhunter.com${href}`,
        is_easy_apply: false,
        description: cardDescription(fields) || null,
      };
    };
    const readCard = (a) => {
      const link = readCardLink(a);
      return link ? [buildCard({ a, ...link })] : [];
    };
    const cards = Array.from(document.querySelectorAll('a[aria-label="Visualizar vaga"][href]'));
    const jobs = cards.flatMap(readCard);
    const nums = Array.from(document.querySelectorAll('button[data-testid="button"]'))
      .map((b) => Number(clean(b.textContent)))
      .filter((n) => !Number.isNaN(n));
    const lastPage = nums.length ? Math.max(...nums) : 1;
    const nextBtn = document.querySelector('button[aria-label="Próxima página"]');
    const hasNext = !!nextBtn && !nextBtn.disabled;
    return { jobs, hasNext, lastPage };
  });
}

async function scrapeGeekhunterPageAt(page, urlOpts, pageNumber) {
  await page.goto(buildGeekhunterSearchUrl({ ...urlOpts, page: pageNumber }), {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForSelector('a[aria-label="Visualizar vaga"]', { timeout: 20_000 }).catch(() => {});
  return scrapeGeekhunterPage(page);
}

function mergeGeekhunterJobs(jobs, seen, pageJobs) {
  for (const job of pageJobs) {
    if (!job.job_id || seen.has(job.job_id)) continue;
    seen.add(job.job_id);
    jobs.push(job);
  }
}

export async function geekhunterSearchJobs(page, opts = {}) {
  const { maxPages = 5, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from page 1's numbered pager (capped at maxPages)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeGeekhunterPageAt(page, urlOpts, p);
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    mergeGeekhunterJobs(jobs, seen, pageJobs);
    hasNextAfterLast = hasNext;
    if (pageJobs.length === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}
