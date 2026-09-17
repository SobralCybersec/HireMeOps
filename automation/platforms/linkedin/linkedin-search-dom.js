export function classifyLinkedInSearchState(diagnostics) {
  if (Number(diagnostics?.occludableCards) > 0 || Number(diagnostics?.jobViewLinks) > 0) {
    return "results";
  }
  if (Number(diagnostics?.noResultsBanners) > 0) return "empty";
  return "not_loaded";
}

export function inspectLinkedInSearchDocument() {
  const noResultsSelector =
    ".jobs-search-no-results-banner, .jobs-search-two-pane__no-results-banner";
  const visible = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    occludableCards: document.querySelectorAll("li[data-occludable-job-id]").length,
    jobViewLinks: document.querySelectorAll('a[href*="/jobs/view/"]').length,
    noResultsBanners: Array.from(document.querySelectorAll(noResultsSelector)).filter(visible)
      .length,
    bodyTextLength: document.body?.innerText?.length ?? 0,
    documentHtmlLength: document.documentElement?.outerHTML?.length ?? 0,
  };
}

export function extractLinkedInCardsFromDocument() {
  const text = (node) => (node?.textContent ?? "").trim();
  const jobLinkSelector = 'a[href*="/jobs/view/"]';
  const validJobLink = (link) => {
    try {
      const parsed = new URL(link.href, location.href);
      return (
        /(^|\.)linkedin\.com$/i.test(parsed.hostname) &&
        /^\/jobs\/view\/[^/?#]+/.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  };
  const jobLinks = Array.from(document.querySelectorAll(jobLinkSelector)).filter(validJobLink);
  const jobIdFromLink = (link) => {
    try {
      return (
        new URL(link.href, location.href).pathname.match(/\/jobs\/view\/([^/?#]+)/)?.[1] ?? null
      );
    } catch {
      return null;
    }
  };
  const keyFor = (card, link, index) => {
    const id = card.getAttribute("data-occludable-job-id")?.trim();
    if (id) return `id:${id}`;
    const linkedId = link ? jobIdFromLink(link) : null;
    if (linkedId) return `id:${linkedId}`;
    if (link) {
      try {
        return `url:${new URL(link.href, location.href).pathname}`;
      } catch {
        return `card:${index}`;
      }
    }
    return `card:${index}`;
  };
  const roots = new Map();
  Array.from(document.querySelectorAll("li[data-occludable-job-id]")).forEach((card, index) => {
    roots.set(keyFor(card, card.querySelector(jobLinkSelector), index), card);
  });
  jobLinks.forEach((link, index) => {
    const card =
      link.closest("li, article, [data-job-id], .job-card-container, .base-card") ??
      link.parentElement ??
      link;
    const key = keyFor(card, link, index);
    if (!roots.has(key)) roots.set(key, card);
  });
  const seen = new Set();
  return Array.from(roots.values())
    .map((card) => {
      const link = card.matches?.(jobLinkSelector) ? card : card.querySelector(jobLinkSelector);
      const jobId = card.getAttribute("data-occludable-job-id")?.trim() || jobIdFromLink(link);
      const titleEl = card.querySelector(
        ".job-card-list__title--link, .job-card-container__link, .job-card-list__title, " +
          ".artdeco-entity-lockup__title a, a[href*='/jobs/view/'], .artdeco-entity-lockup__title",
      );
      const title =
        [
          text(titleEl?.querySelector('span[aria-hidden="true"]')),
          titleEl?.getAttribute("aria-label")?.trim(),
          text(titleEl),
        ].find(Boolean) ?? null;
      const subtitle = text(card.querySelector(".artdeco-entity-lockup__subtitle"));
      const separator = subtitle.indexOf(" · ");
      const rawLocation = separator === -1 ? "" : subtitle.slice(separator + 3).trim();
      const paren = rawLocation.lastIndexOf("(");
      const location = (paren === -1 ? rawLocation : rawLocation.slice(0, paren)).trim();
      const company =
        (separator === -1 ? subtitle : subtitle.slice(0, separator)).trim() ||
        text(
          card.querySelector(
            ".job-card-container__primary-description, .job-card-container__company-name",
          ),
        ) ||
        null;
      const resolvedLocation =
        location || text(card.querySelector(".job-card-container__metadata-item")) || null;
      const applyUrl =
        link?.href ?? (jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : null);
      const isEasyApply = [
        '[aria-label*="Easy Apply"]',
        'a[href*="openSDUIApplyFlow=true"]',
        ".job-card-container__apply-method",
      ].some((selector) => card.querySelector(selector));
      if (!jobId && !title) return null;
      const dedupeKey = jobId || applyUrl || `${title}:${company}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);
      return {
        job_id: jobId,
        title,
        company,
        location: resolvedLocation,
        apply_url: applyUrl,
        is_easy_apply: isEasyApply,
      };
    })
    .filter(Boolean);
}
