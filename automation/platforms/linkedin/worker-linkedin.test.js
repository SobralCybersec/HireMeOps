import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  classifyLinkedInReadinessError,
  fetchLinkedInJobDetail,
  waitForLinkedInSearchState,
} from "./worker-linkedin.js";
import {
  classifyLinkedInSearchState,
  extractLinkedInCardsFromDocument,
} from "./linkedin-search-dom.js";

function response({ ok = true, json = async () => ({ description: { text: "Role" } }) } = {}) {
  let disposed = 0;
  return {
    ok: () => ok,
    json,
    dispose: async () => {
      disposed += 1;
    },
    get disposed() {
      return disposed;
    },
  };
}

function pageWith(responses) {
  return {
    request: {
      get: async () => responses.shift(),
    },
  };
}

describe("LinkedIn job detail response lifecycle", () => {
  it("disposes successful response after consuming JSON", async () => {
    const current = response();
    await fetchLinkedInJobDetail(pageWith([current]), "csrf", "job-1");
    expect(current.disposed).toBe(1);
  });

  it("disposes non-OK responses on every attempt", async () => {
    const first = response({ ok: false });
    const second = response({ ok: false });
    await fetchLinkedInJobDetail(pageWith([first, second]), "csrf", "job-1");
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
  });

  it("disposes responses when JSON parsing fails", async () => {
    const first = response({
      json: async () => {
        throw new Error("fixture parse failure");
      },
    });
    const second = response({
      json: async () => {
        throw new Error("fixture parse failure");
      },
    });
    await fetchLinkedInJobDetail(pageWith([first, second]), "csrf", "job-1");
    expect(first.disposed).toBe(1);
    expect(second.disposed).toBe(1);
  });
});

describe("LinkedIn search readiness", () => {
  it("distinguishes results, confirmed empty, and unknown DOM", () => {
    expect(classifyLinkedInSearchState({ occludableCards: 1 })).toBe("results");
    expect(classifyLinkedInSearchState({ jobViewLinks: 2 })).toBe("results");
    expect(classifyLinkedInSearchState({ noResultsBanners: 1 })).toBe("empty");
    expect(classifyLinkedInSearchState({ bodyTextLength: 500 })).toBe("not_loaded");
  });

  it("separates a document that never became ready from an unknown loaded DOM", () => {
    expect(classifyLinkedInReadinessError({ readyState: "loading", bodyTextLength: 0 })).toBe(
      "linkedin_document_not_ready",
    );
    expect(classifyLinkedInReadinessError({ readyState: "complete", bodyTextLength: 12 })).toBe(
      "linkedin_results_not_loaded",
    );
  });

  it("keeps unknown DOM distinct from confirmed empty", async () => {
    const page = {
      evaluate: async () => ({
        url: "https://www.linkedin.com/jobs/search/",
        title: "Jobs",
        readyState: "complete",
        occludableCards: 0,
        jobViewLinks: 0,
        noResultsBanners: 0,
        bodyTextLength: 32,
      }),
      waitForTimeout: async () => {},
    };
    const result = await waitForLinkedInSearchState(page, { timeout: 0 });
    expect(result.state).toBe("not_loaded");
  });

  it("accepts only the specific no-results banner as empty", async () => {
    const page = {
      evaluate: async () => ({
        url: "https://www.linkedin.com/jobs/search/",
        title: "Jobs",
        readyState: "complete",
        occludableCards: 0,
        jobViewLinks: 0,
        noResultsBanners: 1,
        bodyTextLength: 500,
      }),
    };
    const result = await waitForLinkedInSearchState(page, { timeout: 0 });
    expect(result.state).toBe("empty");
  });
});

function withDocument(html, callback) {
  const dom = new JSDOM(html, { url: "https://www.linkedin.com/jobs/search/" });
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  try {
    return callback();
  } finally {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
    dom.window.close();
  }
}

describe("LinkedIn card extraction", () => {
  it("supports the traditional card container", () => {
    const [job] = withDocument(
      `<li data-occludable-job-id="101">
        <a class="job-card-list__title--link" href="/jobs/view/101"><span aria-hidden="true">Role</span></a>
        <div class="artdeco-entity-lockup__subtitle">Company · Remote</div>
      </li>`,
      extractLinkedInCardsFromDocument,
    );
    expect(job).toMatchObject({
      job_id: "101",
      title: "Role",
      company: "Company",
      location: "Remote",
      apply_url: "https://www.linkedin.com/jobs/view/101",
    });
  });

  it("supports a job link without the traditional list item", () => {
    const [job] = withDocument(
      `<article class="base-card">
        <a href="/jobs/view/202"><span>Fallback role</span></a>
        <div class="artdeco-entity-lockup__subtitle">Fallback company · São Paulo</div>
      </article>`,
      extractLinkedInCardsFromDocument,
    );
    expect(job).toMatchObject({
      job_id: "202",
      title: "Fallback role",
      company: "Fallback company",
      location: "São Paulo",
    });
  });

  it("deduplicates repeated job links", () => {
    const jobs = withDocument(
      `<article><a href="/jobs/view/303">Repeated role</a></article>
       <article><a href="/jobs/view/303">Repeated role again</a></article>`,
      extractLinkedInCardsFromDocument,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].job_id).toBe("303");
  });
});
