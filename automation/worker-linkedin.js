import { session } from "./worker-context.js";

export async function cmdSearchJobs(config) {
  const { handle, keywords = "", location = "", page_index = 0, filters = {} } = config;
  const sess = session(handle);
  const { page } = sess;
  const url = buildLinkedInSearchUrl({ keywords, location, pageIndex: page_index, filters });
  const noResults = await openLinkedInSearch(page, url);
  if (noResults) return { jobs: [], has_next_page: false };

  await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
  const jobs = await readLinkedInCards(page);
  await enrichLinkedInJobs(page, sess.browser, jobs);
  if (jobs.length === 0) return { jobs, has_next_page: false };

  const hasNextPage = await page
    .locator([
      'button[aria-label="View next page"]',
      ".jobs-search-pagination__button--next",
      'button[aria-label^="Page "]:not([aria-current])',
    ].join(", "))
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  return { jobs, has_next_page: hasNextPage };
}

function buildLinkedInSearchUrl({ keywords, location, pageIndex, filters }) {
  const params = new URLSearchParams({ keywords, location, start: String(pageIndex * 25) });
  if (filters.easy_apply_only !== false) params.set("f_AL", "true");
  if (filters.remote_only) params.set("f_WT", "2");
  const dateFilters = { "24h": "r86400", week: "r604800" };
  if (dateFilters[filters.date_posted]) params.set("f_TPR", dateFilters[filters.date_posted]);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function openLinkedInSearch(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    throw new Error("LinkedIn session expired — use the Login LinkedIn button to re-authenticate");
  }
  await page.locator([
    "button.msg-overlay-bubble-header__control--close",
    "button.artdeco-toast-item__dismiss",
  ].join(",")).first().click({ timeout: 2_000 }).catch(() => {});
  await Promise.race([
    page.waitForSelector("li[data-occludable-job-id]", { timeout: 15_000 }).catch(() => {}),
    page.waitForSelector(".jobs-search-no-results-banner, .jobs-search-two-pane__no-results-banner", {
      timeout: 15_000,
    }).catch(() => {}),
  ]);
  return page.evaluate(() => {
    const banner = document.querySelector(
      ".jobs-search-no-results-banner, .jobs-search-two-pane__no-results-banner",
    );
    const text = document.body?.innerText ?? "";
    return !!banner || /Nenhuma vaga corresponde|No matching jobs|No results found|Aucune offre/i.test(text);
  });
}

async function readLinkedInCards(page) {
  return page.evaluate(() => {
    const text = (node) => (node?.textContent ?? "").trim();
    const cards = Array.from(document.querySelectorAll("li[data-occludable-job-id]"));
    return cards.map((card) => {
      const jobId = card.getAttribute("data-occludable-job-id") ?? null;
      const titleEl = card.querySelector(
        ".job-card-list__title--link, .job-card-container__link, .job-card-list__title, " +
          ".artdeco-entity-lockup__title a, a[href*='/jobs/view/'], .artdeco-entity-lockup__title",
      );
      const title = [
        text(titleEl?.querySelector('span[aria-hidden="true"]')),
        titleEl?.getAttribute("aria-label")?.trim(),
        text(titleEl),
      ].find(Boolean) ?? null;
      const subtitle = text(card.querySelector(".artdeco-entity-lockup__subtitle"));
      const separator = subtitle.indexOf(" · ");
      const rawLocation = separator === -1 ? "" : subtitle.slice(separator + 3).trim();
      const paren = rawLocation.lastIndexOf("(");
      const location = (paren === -1 ? rawLocation : rawLocation.slice(0, paren)).trim();
      const company = (separator === -1 ? subtitle : subtitle.slice(0, separator)).trim() ||
        text(card.querySelector(".job-card-container__primary-description, .job-card-container__company-name")) || null;
      const resolvedLocation = location || text(card.querySelector(".job-card-container__metadata-item")) || null;
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const applyUrl = link?.href ?? (jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null);
      const isEasyApply = [
        '[aria-label*="Easy Apply"]',
        'a[href*="openSDUIApplyFlow=true"]',
        ".job-card-container__apply-method",
      ].some((selector) => card.querySelector(selector));
      if (!jobId && !title) return null;
      return { job_id: jobId, title, company, location: resolvedLocation, apply_url: applyUrl, is_easy_apply: isEasyApply };
    }).filter(Boolean);
  });
}

async function enrichLinkedInJobs(page, browser, jobs) {
  const csrf = (
    (await browser.cookies("https://www.linkedin.com")).find((c) => c.name === "JSESSIONID")
      ?.value ?? ""
  ).replace(/"/g, "");
  const DECO = "com.linkedin.voyager.deco.jobs.web.shared.WebLightJobPosting-23";

  const parseDetail = (json) => ({
    title: (json?.title ?? "").trim() || null,
    description: (json?.description?.text ?? "").trim() || null,
    location: (json?.formattedLocation ?? "").trim() || null,
  });

  async function fetchJobDetail(jobId) {
    const attempts = [
      `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}?decorationId=${DECO}`,
      `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}`,
    ];
    let best = null;
    for (const u of attempts) {
      try {
        const res = await page.request.get(u, {
          headers: {
            "csrf-token": csrf,
            "x-restli-protocol-version": "2.0.0",
            accept: "application/json",
          },
          timeout: 10_000,
        });
        if (!res.ok()) continue;
        const parsed = parseDetail(await res.json());
        best = {
          title: best?.title ?? parsed.title,
          description: parsed.description ?? best?.description ?? null,
          location: parsed.location ?? best?.location ?? null,
        };
        if (best.description) break;
      } catch {}
    }
    return best;
  }

  let cursor = 0;
  const runPool = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const detail = job.job_id ? await fetchJobDetail(job.job_id) : null;
      job.description = detail?.description ?? null;
      if (!job.title && detail?.title) job.title = detail.title;
      if (detail?.location) job.location = detail.location;
      await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, () => runPool()));
}

export async function cmdSearchLinkedInPosts({ handle, keywords = "", page_index = 0 }) {
  const { page } = session(handle);

  const base = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywords)}&sortBy=%22date_posted%22&origin=FACETED_SEARCH`;
  const url = page_index > 0 ? `${base}&page=${page_index + 1}` : base;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("/authwall")) {
    throw new Error("LinkedIn session expired — use the Login LinkedIn button to re-authenticate");
  }

  await page
    .waitForSelector(
      'span[data-testid="expandable-text-box"], .feed-shared-update-v2, li.reusable-search__result-container',
      { timeout: 12_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);

  const harvest = () =>
    page
      .evaluate(() => {
        const out = [];
        const textBoxes = Array.from(
          document.querySelectorAll('span[data-testid="expandable-text-box"]'),
        );
        if (textBoxes.length > 0) {
          for (const span of textBoxes) {
            const text = (span.innerText ?? "").trim().slice(0, 3000);
            if (!text) continue;
            let container = span.closest("[componentkey]");
            if (!container) {
              container = span.parentElement;
              for (let i = 0; i < 11 && container?.parentElement; i++) {
                container = container.parentElement;
                if (container.hasAttribute("componentkey") || container.hasAttribute("data-urn"))
                  break;
              }
            }
            const authorLink = container?.querySelector('a[href*="/in/"]');
            const author = authorLink ? (authorLink.innerText ?? "").trim() || null : null;
            const html = container?.outerHTML ?? span.outerHTML;
            let postUrl = null;
            const actM = html.match(/urn:li:activity:(\d+)/);
            if (actM) {
              postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${actM[1]}/`;
            } else {
              const shrM = html.match(/shareId=(\d{10,})/) ?? html.match(/urn:li:share:(\d+)/);
              if (shrM) postUrl = `https://www.linkedin.com/feed/update/urn:li:share:${shrM[1]}/`;
            }
            out.push({ url: postUrl, text, author });
          }
          return out;
        }
        for (const el of document.querySelectorAll(
          "div.feed-shared-update-v2, li.reusable-search__result-container, div[data-urn*='activity']",
        )) {
          const textEl = el.querySelector(
            ".update-components-text, .feed-shared-update-v2__description, .break-words",
          );
          const text = ((textEl ?? el).innerText ?? "").trim().slice(0, 3000);
          if (!text) continue;
          const authorEl = el.querySelector(
            ".update-components-actor__title, .update-components-actor__name",
          );
          const author = authorEl ? (authorEl.innerText ?? "").trim() || null : null;
          const linkEl =
            el.querySelector('a[href*="/feed/update/"]') ?? el.querySelector('a[href*="/posts/"]');
          let postUrl = linkEl?.href ?? null;
          if (!postUrl) {
            const urn = el.getAttribute("data-urn") ?? "";
            const m = urn.match(/urn:li:activity:(\d+)/);
            if (m) postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`;
          }
          out.push({ url: postUrl, text, author });
        }
        return out;
      })
      .catch(() => []);

  const byKey = new Map();
  let stale = 0;
  for (let i = 0; i < 40 && stale < 3; i++) {
    const before = byKey.size;

    await page
      .evaluate(() => {
        document.querySelectorAll('button[data-testid="expandable-text-button"]').forEach((b) => {
          try {
            b.click();
          } catch {}
        });
      })
      .catch(() => {});

    for (const p of await harvest()) {
      const key = p.url || (p.text ? p.text.slice(0, 140) : null);
      if (key && !byKey.has(key)) byKey.set(key, p);
    }

    const fetchWait = page
      .waitForResponse((r) => r.url().includes("voyagerSearchDashClusters") && r.status() === 200, {
        timeout: 4_000,
      })
      .catch(() => null);

    await page.mouse.move(500, 400).catch(() => {});
    await page.mouse.wheel(0, 400 + Math.floor(Math.random() * 400)).catch(() => {});
    await fetchWait;
    await page.waitForTimeout(600 + Math.floor(Math.random() * 800));

    stale = byKey.size === before ? stale + 1 : 0;
    const empty = await page
      .locator(".artdeco-empty-state, .search-no-results")
      .count()
      .catch(() => 0);
    if (empty) break;
  }

  const posts = [...byKey.values()];

  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  for (const post of posts) {
    const m = emailRe.exec(post.text);
    post.email = m ? m[0] : null;
  }

  return { posts, has_next_page: false };
}

export async function cmdSearchGoogle({ handle, query, page_index = 0 }) {
  const { page } = session(handle);

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&start=${page_index * 10}&hl=pt-BR&num=10`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  for (const sel of [
    "button#L2AGLb",
    'button[aria-label*="Aceitar" i]',
    'button[aria-label*="Accept" i]',
    "#introAgreeButton",
  ]) {
    await page.click(sel, { timeout: 3_000 }).catch(() => {});
  }
  await page.waitForTimeout(400);

  const currentUrl = page.url();
  const pageText = await page.evaluate(() => document.documentElement.innerText ?? "");
  if (
    currentUrl.includes("/sorry/") ||
    /recaptcha|unusual traffic|tráfego incomum|antes de continuar|not a robot|detected unusual/i.test(
      pageText,
    )
  ) {
    return { results: [], blocked: true, has_next_page: false };
  }

  try {
    const { results, has_next_page } = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const SKIP = [
        "google.com",
        "googleadservices.com",
        "youtube.com",
        "googleusercontent.com",
        "gstatic.com",
      ];
      for (const h3 of document.querySelectorAll("a h3, h3")) {
        const a = h3.closest("a[href^='http']") || h3.parentElement?.closest("a[href^='http']");
        const url = a?.href;
        if (!url || SKIP.some((d) => url.includes(d)) || seen.has(url)) continue;
        seen.add(url);

        const container = a.closest("div.g, div[data-hveid], div[jscontroller]") || a.parentElement;
        const snippet = (
          container?.querySelector("div[data-sncf], .VwiC3b, div[role='text']")?.innerText ??
          container?.innerText ??
          ""
        )
          .trim()
          .slice(0, 2000);

        out.push({ url, title: (h3.innerText ?? "").trim(), snippet });
      }

      const has_next_page = !!document.querySelector(
        'a#pnnext, a[aria-label="Next page"], td.b a[aria-label*="Próxima" i]',
      );

      return { results: out, has_next_page };
    });

    const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
    for (const r of results) {
      const m = emailRe.exec(`${r.title} ${r.snippet}`);
      r.email = m ? m[0] : null;
    }

    await page.waitForTimeout(600 + Math.floor(Math.random() * 600));
    return { results, blocked: false, has_next_page };
  } catch {
    return { results: [], blocked: false, has_next_page: false };
  }
}
