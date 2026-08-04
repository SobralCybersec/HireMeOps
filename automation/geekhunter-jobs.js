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
    const clean = (s) =>
      String(s ?? "")
        .replace(/\s+/g, " ")
        .trim();

    const cards = Array.from(document.querySelectorAll('a[aria-label="Visualizar vaga"][href]'));
    const jobs = cards.flatMap((a) => {
      const href = a.getAttribute("href") || "";
      // Real job links look like /pt/<company>/jobs/<slug>. Skip anything else.
      const m = href.match(/\/pt\/([^/]+)\/jobs\/([^/?#]+)/);
      if (!m) return [];
      const company = decodeURIComponent(m[1]).replace(/-/g, " ");
      const jobId = `${m[1]}/${m[2]}`;

      // Title: the first heading-ish <p> in the card is the role. Fall back to the
      // longest short line if the class anchor moved.
      const ps = Array.from(a.querySelectorAll("p.chakra-text")).map((p) => clean(p.textContent));
      const title = ps.find((t) => t.length > 3) || null;

      // Location: the <p> carrying the country flag emoji + "Brasil".
      const location =
        ps.find((t) => /brasil/i.test(t)) || ps.find((t) => /,\s*[A-Z]{2}\b/.test(t)) || null;
      // Work modality chip (Remoto / Híbrido / Presencial).
      const modality = ps.find((t) => /^(remoto|h[íi]brido|presencial)$/i.test(t)) || "";
      // Salary line, if the card exposes one.
      const salary = ps.find((t) => /R\$/.test(t)) || "";

      const skills = Array.from(a.querySelectorAll(".css-dqhvn"))
        .map((s) => clean(s.textContent))
        .filter((s) => s && !/^\+\d+$/.test(s)); // drop the "+3" overflow chip

      const full = [
        modality ? `Modalidade: ${modality}` : "",
        location ? `Local: ${location}` : "",
        salary ? `Salário: ${salary}` : "",
        skills.length ? `Skills: ${skills.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const clean_location = location ? location.replace(/^[^\p{L}]+/u, "").trim() : null;

      return [
        {
          job_id: jobId,
          title,
          company: company || null,
          location: clean_location,
          apply_url: href.startsWith("http")
            ? href.split("?")[0]
            : `https://www.geekhunter.com${href}`,
          is_easy_apply: false,
          description: full || null,
        },
      ];
    });

    // Pagination: Chakra numbered buttons; max numeric label is the last page.
    // "Próxima página" (aria-label) enabled means there's a next page.
    const nums = Array.from(document.querySelectorAll('button[data-testid="button"]'))
      .map((b) => Number(clean(b.textContent)))
      .filter((n) => !Number.isNaN(n));
    const lastPage = nums.length ? Math.max(...nums) : 1;
    const nextBtn = document.querySelector('button[aria-label="Próxima página"]');
    const hasNext = !!nextBtn && !nextBtn.disabled;
    return { jobs, hasNext, lastPage };
  });
}

export async function geekhunterSearchJobs(page, opts = {}) {
  const { maxPages = 5, ...urlOpts } = opts;
  const cap = Math.max(1, Math.min(30, Number(maxPages) || 1));

  const jobs = [];
  const seen = new Set();
  let hasNextAfterLast = false;
  let lastPage = cap; // refined from page 1's numbered pager (capped at maxPages)

  for (let p = 1; p <= Math.min(cap, lastPage); p++) {
    await page.goto(buildGeekhunterSearchUrl({ ...urlOpts, page: p }), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // SPA: cards hydrate after domcontentloaded. Wait for the first job link;
    // if none appear (empty result / block), scrape 0 and stop.
    await page
      .waitForSelector('a[aria-label="Visualizar vaga"]', { timeout: 20_000 })
      .catch(() => {});

    const { jobs: pageJobs, hasNext, lastPage: detected } = await scrapeGeekhunterPage(page);
    if (p === 1 && detected && detected > 1) lastPage = Math.min(cap, detected);

    for (const job of pageJobs) {
      if (job.job_id && !seen.has(job.job_id)) {
        seen.add(job.job_id);
        jobs.push(job);
      }
    }
    hasNextAfterLast = hasNext;
    if (pageJobs.length === 0) break;
  }

  return { jobs, has_next_page: hasNextAfterLast };
}
