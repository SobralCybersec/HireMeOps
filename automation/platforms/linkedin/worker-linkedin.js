import { session } from "../../core/worker/worker-context.js";
import {
  classifyLinkedInAuth,
  classifyPlatformUrl,
  sanitizeProbeError,
  sanitizeProbeUrl,
} from "../../core/auth/auth-classification.js";
import { createNavigationTelemetry } from "../../cloud/cloud-navigation-telemetry.mjs";
import {
  classifyLinkedInSearchState,
  extractLinkedInCardsFromDocument,
  inspectLinkedInSearchState,
  inspectLinkedInSearchDocument,
} from "./linkedin-search-dom.js";

export async function cmdSearchJobs(config, hooks = {}) {
  const { handle, keywords = "", location = "", page_index = 0, filters = {} } = config;
  const sess = session(handle);
  const { page } = sess;
  const url = buildLinkedInSearchUrl({ keywords, location, pageIndex: page_index, filters });
  let cloudExtraction = null;
  const searchState = await openLinkedInSearch(
    page,
    url,
    process.env.HIREMEOPS_CLOUD === "1"
      ? {
          onResultsReady: async ({ state, diagnostics }) => {
            const jobs = state === "empty" ? [] : await readLinkedInCards(page);
            if (state !== "empty" && jobs.length === 0) throw linkedInSearchError(diagnostics);
            const hasNextPage =
              state === "empty" ? false : await readLinkedInNextPage(page, diagnostics);
            await closeCloudSearchPage(page);
            await hooks.onPhase?.("linkedin-results-ready");
            await hooks.onPhase?.("linkedin-cards-extracted");
            await hooks.onPhase?.("linkedin-page-closed");
            cloudExtraction = { jobs, hasNextPage };
          },
        }
      : undefined,
  );
  if (searchState.state === "empty") {
    const extraction = cloudExtraction ?? { jobs: [], hasNextPage: false };
    return {
      jobs: extraction.jobs,
      has_next_page: extraction.hasNextPage,
      auth_status: searchState.authStatus,
    };
  }

  const jobsFromCloud = cloudExtraction?.jobs;
  if (process.env.HIREMEOPS_CLOUD !== "1") {
    await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
  }
  const jobs = jobsFromCloud ?? (await readLinkedInCards(page));
  if (jobs.length === 0) throw linkedInSearchError(searchState.diagnostics);
  const hasNextPage =
    cloudExtraction?.hasNextPage ?? (await readLinkedInNextPage(page, searchState.diagnostics));
  if (process.env.HIREMEOPS_CLOUD !== "1") await closeCloudSearchPage(page);
  await hooks.onJobsDiscovered?.(jobs);
  await hooks.onPhase?.("first-jobs-persisted");
  await enrichLinkedInJobs(page, sess.browser, jobs, hooks.onJobUpdated);
  return {
    jobs,
    has_next_page: hasNextPage,
    auth_status: searchState.authStatus,
  };
}

async function closeCloudSearchPage(page) {
  if (process.env.HIREMEOPS_CLOUD !== "1") return;
  try {
    await page.close?.();
  } catch {}
}

async function readLinkedInNextPage(page, diagnostics) {
  if (process.env.HIREMEOPS_CLOUD === "1") {
    return Number(diagnostics?.nextPageButtons) > 0;
  }
  return page
    .locator(
      [
        'button[aria-label="View next page"]',
        ".jobs-search-pagination__button--next",
        'button[aria-label^="Page "]:not([aria-current])',
      ].join(", "),
    )
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
}

export async function waitForLinkedInSearchState(page, { timeout = 15_000, pollInterval } = {}) {
  const startedAt = Date.now();
  const deadline = Date.now() + Math.max(0, timeout);
  const interval = pollInterval ?? linkedInReadinessPollInterval();
  const dcl = observeDomContentLoaded(page, deadline);
  try {
    let stateDiagnostics = await readLinkedInSearchState(page);
    let state = classifyLinkedInSearchState(stateDiagnostics);
    dcl.markReady(["interactive", "complete"].includes(stateDiagnostics.readyState));
    while (state === "not_loaded" && Date.now() < deadline) {
      await page.waitForTimeout(Math.min(interval, deadline - Date.now()));
      stateDiagnostics = await readLinkedInSearchState(page);
      dcl.markReady(["interactive", "complete"].includes(stateDiagnostics.readyState));
      state = classifyLinkedInSearchState(stateDiagnostics);
    }
    const diagnostics =
      state === "results" ? stateDiagnostics : await readLinkedInSearchDiagnostics(page, stateDiagnostics);
    return {
      state,
      diagnostics: { ...stateDiagnostics, ...diagnostics },
      dcl: dcl.snapshot(),
      semanticElapsedMs: Date.now() - startedAt,
    };
  } finally {
    dcl.stop();
  }
}

function linkedInReadinessPollInterval() {
  return process.env.HIREMEOPS_CLOUD === "1" ? 750 : 250;
}

function observeDomContentLoaded(page, deadline) {
  const startedAt = Date.now();
  const state = { reached: false, elapsedMs: null };
  if (typeof page.once !== "function") {
    return {
      markReady: (ready) => {
        if (ready) {
          state.reached = true;
          state.elapsedMs ??= Date.now() - startedAt;
        }
      },
      snapshot: () => ({ ...state }),
      stop: () => {},
    };
  }
  const onDomContentLoaded = () => {
    state.reached = true;
    state.elapsedMs = Date.now() - startedAt;
  };
  page.once("domcontentloaded", onDomContentLoaded);
  return {
    markReady: (ready) => {
      if (ready && !state.reached) {
        state.reached = true;
        state.elapsedMs ??= Date.now() - startedAt;
      }
    },
    snapshot: () => ({
      ...state,
      elapsedMs: state.elapsedMs ?? Math.min(Date.now() - startedAt, deadline - startedAt),
    }),
    stop: () => page.off?.("domcontentloaded", onDomContentLoaded),
  };
}

async function readLinkedInSearchState(page) {
  return page.evaluate(inspectLinkedInSearchState);
}

async function readLinkedInSearchDiagnostics(page, fallback = {}) {
  try {
    return await page.evaluate(inspectLinkedInSearchDocument);
  } catch (error) {
    return {
      ...fallback,
      diagnosticError: sanitizeProbeError(error),
    };
  }
}

function linkedInSearchError(diagnostics, code = "linkedin_results_not_loaded") {
  const error = new Error(code);
  error.code = code;
  error.diagnostics = diagnostics;
  return error;
}

function linkedInNavigationTimeout() {
  return process.env.HIREMEOPS_CLOUD === "1" ? 30_000 : 15_000;
}

export function classifyLinkedInReadinessError(diagnostics) {
  return diagnostics?.readyState === "loading"
    ? "linkedin_document_not_ready"
    : "linkedin_results_not_loaded";
}

function navigationMetadata(response) {
  if (!response) return { navigationStatus: null, navigationContentType: null };
  try {
    const contentType = response.headers?.()["content-type"]?.split(";", 1)[0] ?? null;
    return { navigationStatus: response.status?.() ?? null, navigationContentType: contentType };
  } catch {
    return { navigationStatus: null, navigationContentType: null };
  }
}

function buildLinkedInSearchUrl({ keywords, location, pageIndex, filters }) {
  const params = new URLSearchParams({ keywords, location, start: String(pageIndex * 25) });
  if (filters.easy_apply_only !== false) params.set("f_AL", "true");
  if (filters.remote_only) params.set("f_WT", "2");
  const dateFilters = { "24h": "r86400", week: "r604800" };
  if (dateFilters[filters.date_posted]) params.set("f_TPR", dateFilters[filters.date_posted]);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function openLinkedInSearch(page, url, { onResultsReady } = {}) {
  const telemetry =
    process.env.HIREMEOPS_CLOUD === "1"
      ? createNavigationTelemetry(page, {
          resourcePolicyEnabled: cloudResourcePolicyEnabled(),
        })
      : null;
  let response = null;
  try {
    response = await page.goto(url, { waitUntil: "commit", timeout: 30_000 });
    const currentUrl = page.url();
    const urlStatus = classifyPlatformUrl("linkedin", currentUrl);
    if (urlStatus !== "valid") throw linkedInSearchError({ url: currentUrl }, urlStatus);
    const readiness = await waitForLinkedInSearchState(page, {
      timeout: linkedInNavigationTimeout(),
    });
    const diagnostics = {
      url: currentUrl,
      ...readiness.diagnostics,
      dcl: readiness.dcl,
      semanticElapsedMs: readiness.semanticElapsedMs,
      ...(telemetry
        ? {
            network: telemetry.snapshot(),
            resourcePolicyEnabled: cloudResourcePolicyEnabled(),
          }
        : {}),
    };
    const authStatus = classifyLinkedInAuth({ url: currentUrl, ...readiness.diagnostics });
    if (readiness.state === "not_loaded") {
      throw linkedInSearchError(diagnostics, classifyLinkedInReadinessError(diagnostics));
    }
    if (readiness.state === "login_required" || readiness.state === "challenged") {
      throw linkedInSearchError(diagnostics, readiness.state);
    }
    if (authStatus !== "valid") {
      throw linkedInSearchError(diagnostics, authStatus === "unknown" ? "linkedin_auth_unknown" : authStatus);
    }
    await onResultsReady?.({ state: readiness.state, diagnostics });
    if (!page.isClosed?.()) {
      await page
        .locator(
          [
            "button.msg-overlay-bubble-header__control--close",
            "button.artdeco-toast-item__dismiss",
          ].join(","),
        )
        .first()
        .click({ timeout: 2_000 })
        .catch(() => {});
    }
    logLinkedInSearchDiagnostics(readiness.state, response, diagnostics);
    return { ...readiness, diagnostics, authStatus };
  } catch (error) {
    const diagnostics = {
      ...(error.diagnostics ?? { url: page.url() }),
      errorName: error?.name ?? "Error",
      errorMessage: sanitizeProbeError(error),
      ...(telemetry
        ? {
            network: telemetry.snapshot(),
            resourcePolicyEnabled: cloudResourcePolicyEnabled(),
          }
        : {}),
    };
    error.diagnostics = diagnostics;
    logLinkedInSearchDiagnostics(error.code ?? "failed", response, diagnostics);
    throw error;
  } finally {
    telemetry?.detach();
  }
}

function cloudResourcePolicyEnabled() {
  return !/^(0|false|no)$/i.test(process.env.HIREMEOPS_CLOUD_BLOCK_HEAVY_RESOURCES ?? "1");
}

function logLinkedInSearchDiagnostics(state, response, diagnostics) {
  const { url: diagnosticUrl, ...metadata } = diagnostics;
  process.stderr.write(
    `[linkedin-search] ${JSON.stringify({
      state,
      ...navigationMetadata(response),
      finalUrl: sanitizeProbeUrl(diagnosticUrl),
      ...metadata,
    })}\n`,
  );
  const network = diagnostics.network;
  if (network) {
    process.stderr.write(
      `[linkedin-network-summary] requests=${network.requestsTotal} ` +
        `scripts=${network.scriptRequests} ` +
        `script2xx=${network.scriptResponses2xx} ` +
        `scriptPending=${network.pendingByType?.script ?? 0} ` +
        `styles=${network.requestsByType?.stylesheet ?? 0} ` +
        `xhrFetch=${network.xhrFetchRequests} ` +
        `pageErrors=${network.pageErrorCount} ` +
        `consoleErrors=${network.consoleErrorCount}\n`,
    );
  }
}

async function readLinkedInCards(page) {
  return page.evaluate(extractLinkedInCardsFromDocument);
}

const LINKEDIN_DETAIL_DECO = "com.linkedin.voyager.deco.jobs.web.shared.WebLightJobPosting-23";

function parseLinkedInDetail(json) {
  return {
    title: (json?.title ?? "").trim() || null,
    description: (json?.description?.text ?? "").trim() || null,
    location: (json?.formattedLocation ?? "").trim() || null,
  };
}

export async function fetchLinkedInJobDetail(requestContext, csrf, jobId) {
  const attempts = [
    `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}?decorationId=${LINKEDIN_DETAIL_DECO}`,
    `https://www.linkedin.com/voyager/api/jobs/jobPostings/${jobId}`,
  ];
  let best = null;
  for (const url of attempts) {
    const parsed = await fetchLinkedInDetailAttempt(requestContext, csrf, url);
    if (!parsed) continue;
    best = mergeLinkedInDetail(best, parsed);
    if (best.description) break;
  }
  return best;
}

async function fetchLinkedInDetailAttempt(requestContext, csrf, url) {
  let response = null;
  try {
    const request = requestContext?.get ? requestContext : requestContext?.request;
    response = await request.get(url, {
      headers: {
        "csrf-token": csrf,
        "x-restli-protocol-version": "2.0.0",
        accept: "application/json",
      },
      timeout: 10_000,
    });
    if (!response.ok()) return null;
    return parseLinkedInDetail(await response.json());
  } catch {
    return null;
  } finally {
    if (response) await response.dispose().catch(() => {});
  }
}

function mergeLinkedInDetail(current, parsed) {
  return {
    title: detailValue(current, parsed, "title"),
    description: detailValue(parsed, current, "description"),
    location: detailValue(parsed, current, "location"),
  };
}

function detailValue(primary, fallback, field) {
  return primary?.[field] ?? fallback?.[field] ?? null;
}

async function enrichLinkedInJobs(page, browser, jobs, onJobUpdated) {
  const csrf = (
    (await browser.cookies("https://www.linkedin.com")).find((c) => c.name === "JSESSIONID")
      ?.value ?? ""
  ).replace(/"/g, "");
  let cursor = 0;
  const runPool = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const detail = job.job_id ? await fetchLinkedInJobDetail(browser.request, csrf, job.job_id) : null;
      job.description = detail?.description ?? null;
      if (!job.title && detail?.title) job.title = detail.title;
      if (detail?.location) job.location = detail.location;
      await onJobUpdated?.(job);
      if (process.env.HIREMEOPS_CLOUD !== "1") {
        await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
      }
    }
  };
  const concurrency = process.env.HIREMEOPS_CLOUD === "1" ? 1 : 3;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => runPool()));
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
