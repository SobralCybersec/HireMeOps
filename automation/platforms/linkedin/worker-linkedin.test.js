import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  cmdSearchJobs,
  classifyLinkedInReadinessError,
  fetchLinkedInJobDetail,
  isLinkedInBootstrapStalled,
  waitForLinkedInSearchState,
} from "./worker-linkedin.js";
import { sessions } from "../../core/worker/worker-context.js";
import {
  classifyLinkedInSearchState,
  extractLinkedInCardsFromDocument,
  inspectLinkedInSearchState,
  inspectLinkedInSearchDocument,
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

describe("LinkedIn cloud renderer lifecycle", () => {
  it("closes search page before cloud enrichment and uses context request", async () => {
    const phases = [];
    const discovered = [];
    const updated = [];
    const detailResponse = response({
      json: async () => ({
        title: "Backend Engineer",
        description: { text: "Role" },
        formattedLocation: "Rio de Janeiro",
      }),
    });
    const page = {
      goto: vi.fn(async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      })),
      url: () => "https://www.linkedin.com/jobs/search/",
      once: vi.fn(),
      off: vi.fn(),
      evaluate: vi.fn(async (inspector) => {
        if (inspector === inspectLinkedInSearchState) {
          return {
            readyState: "interactive",
            occludableCards: 1,
            jobViewLinks: 1,
            noResultsBanners: 0,
            loginMarkers: 0,
            challengeMarkers: 0,
            jobsRootMarkers: 1,
            authenticatedMarkers: 1,
            authenticatedNavDestinations: 3,
          };
        }
        if (inspector === inspectLinkedInSearchDocument) {
          return {
            readyState: "interactive",
            occludableCards: 1,
            jobViewLinks: 1,
            noResultsBanners: 0,
            loginMarkers: 0,
            challengeMarkers: 0,
            jobsRootMarkers: 1,
            authenticatedMarkers: 1,
            authenticatedNavDestinations: 3,
          };
        }
        if (inspector === extractLinkedInCardsFromDocument) {
          return [{ job_id: "job-1", title: "Backend Engineer", company: "Acme" }];
        }
        throw new Error("unexpected inspector");
      }),
      locator: () => ({
        first: () => ({
          click: vi.fn(async () => {}),
          isVisible: vi.fn(async () => false),
        }),
      }),
      close: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
    };
    const browser = {
      cookies: vi.fn(async () => [{ name: "JSESSIONID", value: '"csrf"' }]),
      request: { get: vi.fn(async () => detailResponse) },
    };
    sessions.set("linkedin-cloud-test", { page, browser });
    const previousCloud = process.env.HIREMEOPS_CLOUD;
    process.env.HIREMEOPS_CLOUD = "1";
    try {
      const result = await cmdSearchJobs(
        { handle: "linkedin-cloud-test", keywords: "backend", location: "Rio" },
        {
          onPhase: async (phase) => phases.push(phase),
          onJobsDiscovered: async (jobs) => discovered.push(...jobs),
          onJobUpdated: async (job) => updated.push(job),
        },
      );
      expect(result.auth_status).toBe("valid");
      expect(page.close).toHaveBeenCalledOnce();
      expect(browser.request.get).toHaveBeenCalled();
      expect(discovered).toHaveLength(1);
      expect(updated).toHaveLength(1);
      expect(phases).toEqual([
        "linkedin-attempt-1-start",
        "linkedin-results-ready",
        "linkedin-cards-extracted",
        "linkedin-page-closed",
        "first-jobs-persisted",
      ]);
    } finally {
      sessions.delete("linkedin-cloud-test");
      if (previousCloud == null) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previousCloud;
    }
  });

  it("retries one stalled bootstrap with a fresh page", async () => {
    const previousCloud = process.env.HIREMEOPS_CLOUD;
    process.env.HIREMEOPS_CLOUD = "1";
    const pageUrl = "https://www.linkedin.com/jobs/search/";
    const firstPage = {
      goto: vi.fn(async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      })),
      url: () => pageUrl,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          readyState: "loading",
          occludableCards: 0,
          jobViewLinks: 0,
          noResultsBanners: 0,
          loginMarkers: 0,
          challengeMarkers: 0,
        })
        .mockImplementationOnce(() => new Promise(() => {})),
      waitForTimeout: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      isClosed: () => false,
    };
    const secondPage = {
      goto: vi.fn(async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      })),
      url: () => pageUrl,
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      evaluate: vi.fn(async (inspector) => {
        if (inspector === inspectLinkedInSearchState) {
          return {
            readyState: "interactive",
            occludableCards: 1,
            jobViewLinks: 1,
            noResultsBanners: 0,
            loginMarkers: 0,
            challengeMarkers: 0,
            authenticatedMarkers: 1,
            authenticatedNavDestinations: 3,
          };
        }
        if (inspector === extractLinkedInCardsFromDocument) {
          return [{ job_id: null, title: "Recovered role" }];
        }
        throw new Error("unexpected inspector");
      }),
      close: vi.fn(async () => {}),
      isClosed: () => true,
      locator: vi.fn(),
    };
    const browser = {
      newPage: vi.fn(async () => secondPage),
      cookies: vi.fn(async () => []),
      request: { get: vi.fn() },
    };
    const discovered = [];
    sessions.set("linkedin-bootstrap-retry", { page: firstPage, browser });
    try {
      const result = await cmdSearchJobs(
        { handle: "linkedin-bootstrap-retry", keywords: "backend", location: "Rio" },
        { onJobsDiscovered: async (jobs) => discovered.push(...jobs) },
      );
      expect(result.auth_status).toBe("valid");
      expect(browser.newPage).toHaveBeenCalledOnce();
      expect(firstPage.close).toHaveBeenCalledOnce();
      expect(secondPage.close).toHaveBeenCalledOnce();
      expect(discovered).toEqual([{ job_id: null, title: "Recovered role", description: null }]);
    } finally {
      sessions.delete("linkedin-bootstrap-retry");
      if (previousCloud == null) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previousCloud;
    }
  });

  it("does not retry a login-required page", async () => {
    const previousCloud = process.env.HIREMEOPS_CLOUD;
    process.env.HIREMEOPS_CLOUD = "1";
    const page = {
      goto: vi.fn(async () => ({
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      })),
      url: () => "https://www.linkedin.com/login",
      once: vi.fn(),
      off: vi.fn(),
      evaluate: vi.fn(async () => ({
        readyState: "complete",
        occludableCards: 0,
        jobViewLinks: 0,
        noResultsBanners: 0,
        loginMarkers: 1,
        challengeMarkers: 0,
      })),
      close: vi.fn(async () => {}),
    };
    const browser = { newPage: vi.fn(), cookies: vi.fn(), request: {} };
    sessions.set("linkedin-login-terminal", { page, browser });
    try {
      await expect(
        cmdSearchJobs({ handle: "linkedin-login-terminal", keywords: "backend" }),
      ).rejects.toMatchObject({ code: "login_required" });
      expect(browser.newPage).not.toHaveBeenCalled();
    } finally {
      sessions.delete("linkedin-login-terminal");
      if (previousCloud == null) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previousCloud;
    }
  });
});

describe("LinkedIn search readiness", () => {
  it("detects only the stalled bootstrap signature", () => {
    const diagnostics = {
      navigationStatus: 200,
      readyState: "loading",
      occludableCards: 0,
      jobViewLinks: 0,
      loginMarkers: 0,
      challengeMarkers: 0,
      network: {
        xhrFetchRequests: 0,
        pendingByType: { script: 1 },
        oldestPendingAgeMs: 10_001,
      },
    };
    expect(isLinkedInBootstrapStalled(diagnostics)).toBe(true);
    expect(isLinkedInBootstrapStalled({ ...diagnostics, loginMarkers: 1 })).toBe(false);
    expect(
      isLinkedInBootstrapStalled({
        ...diagnostics,
        network: { ...diagnostics.network, xhrFetchRequests: 1 },
      }),
    ).toBe(false);
    expect(
      isLinkedInBootstrapStalled(
        {
          ...diagnostics,
          network: {
            ...diagnostics.network,
            pendingByType: { script: 0 },
            oldestPendingAgeMs: null,
          },
        },
        "linkedin_renderer_unresponsive",
      ),
    ).toBe(true);
  });

  it("bounds a stuck renderer evaluation", async () => {
    const previousCloud = process.env.HIREMEOPS_CLOUD;
    process.env.HIREMEOPS_CLOUD = "1";
    const page = {
      evaluate: () => new Promise(() => {}),
      once: vi.fn(),
      off: vi.fn(),
    };
    try {
      await expect(
        waitForLinkedInSearchState(page, { timeout: 0, inspectorTimeoutMs: 10 }),
      ).rejects.toMatchObject({ code: "linkedin_renderer_unresponsive" });
    } finally {
      if (previousCloud == null) delete process.env.HIREMEOPS_CLOUD;
      else process.env.HIREMEOPS_CLOUD = previousCloud;
    }
  });

  it("keeps the hot-path inspector free of heavy DOM reads", () => {
    const previousDocument = globalThis.document;
    const documentElement = {};
    const body = {};
    Object.defineProperty(documentElement, "outerHTML", {
      get: () => {
        throw new Error("outerHTML must stay out of readiness polling");
      },
    });
    Object.defineProperty(body, "innerText", {
      get: () => {
        throw new Error("innerText must stay out of readiness polling");
      },
    });
    globalThis.document = {
      readyState: "loading",
      documentElement,
      body,
      querySelectorAll: (selector) =>
        selector.includes("/jobs/view/") ? [{ getClientRects: () => [1] }] : [],
    };
    try {
      expect(inspectLinkedInSearchState()).toMatchObject({
        readyState: "loading",
        jobViewLinks: 1,
        occludableCards: 0,
      });
    } finally {
      globalThis.document = previousDocument;
    }
  });

  it("skips heavy diagnostics after results become ready", async () => {
    let lightCalls = 0;
    let heavyCalls = 0;
    const page = {
      evaluate: async (inspector) => {
        if (inspector === inspectLinkedInSearchState) {
          lightCalls += 1;
          return {
            readyState: "loading",
            occludableCards: lightCalls > 1 ? 1 : 0,
            jobViewLinks: lightCalls > 1 ? 1 : 0,
            noResultsBanners: 0,
            loginMarkers: 0,
            challengeMarkers: 0,
          };
        }
        heavyCalls += 1;
        return { readyState: "loading", occludableCards: 1, jobViewLinks: 1 };
      },
      waitForTimeout: vi.fn(async () => {}),
    };

    await expect(waitForLinkedInSearchState(page, { timeout: 100 })).resolves.toMatchObject({
      state: "results",
    });
    expect(lightCalls).toBe(2);
    expect(heavyCalls).toBe(0);
  });

  it("runs heavy diagnostics once on readiness timeout", async () => {
    let heavyCalls = 0;
    const page = {
      evaluate: async (inspector) => {
        if (inspector === inspectLinkedInSearchState) {
          return {
            readyState: "loading",
            occludableCards: 0,
            jobViewLinks: 0,
            noResultsBanners: 0,
            loginMarkers: 0,
            challengeMarkers: 0,
          };
        }
        expect(inspector).toBe(inspectLinkedInSearchDocument);
        heavyCalls += 1;
        return { readyState: "loading", occludableCards: 0, jobViewLinks: 0 };
      },
      waitForTimeout: vi.fn(async () => {}),
    };

    await waitForLinkedInSearchState(page, { timeout: 0 });
    expect(heavyCalls).toBe(1);
  });

  it("distinguishes results, confirmed empty, and unknown DOM", () => {
    expect(classifyLinkedInSearchState({ occludableCards: 1 })).toBe("results");
    expect(classifyLinkedInSearchState({ jobViewLinks: 2 })).toBe("results");
    expect(classifyLinkedInSearchState({ noResultsBanners: 1 })).toBe("empty");
    expect(classifyLinkedInSearchState({ bodyTextLength: 500 })).toBe("not_loaded");
  });

  it("separates a document that never became ready from an unknown loaded DOM", () => {
    expect(classifyLinkedInReadinessError({ readyState: "loading", bodyTextLength: 23 })).toBe(
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

  it("returns results before DOMContentLoaded when cards are already visible", async () => {
    let domContentLoaded;
    const page = {
      once: (_event, listener) => {
        domContentLoaded = listener;
      },
      off: vi.fn(),
      evaluate: async () => ({
        url: "https://www.linkedin.com/jobs/search/",
        title: "Jobs",
        readyState: "loading",
        occludableCards: 1,
        jobViewLinks: 1,
        noResultsBanners: 0,
        bodyTextLength: 20,
      }),
      waitForTimeout: vi.fn(),
    };
    const result = await waitForLinkedInSearchState(page, { timeout: 100 });
    expect(result.state).toBe("results");
    expect(result.dcl.reached).toBe(false);
    expect(page.off).toHaveBeenCalledWith("domcontentloaded", domContentLoaded);
  });

  it("keeps polling after DCL timeout when results appear", async () => {
    let calls = 0;
    const page = {
      once: vi.fn(),
      off: vi.fn(),
      evaluate: async () => {
        const ready = calls++ > 0;
        return {
          url: "https://www.linkedin.com/jobs/search/",
          title: "Jobs",
          readyState: "loading",
          occludableCards: ready ? 1 : 0,
          jobViewLinks: ready ? 1 : 0,
          noResultsBanners: 0,
          bodyTextLength: ready ? 20 : 23,
        };
      },
      waitForTimeout: vi.fn(),
    };
    const result = await waitForLinkedInSearchState(page, { timeout: 100 });
    expect(result.state).toBe("results");
    expect(result.dcl.reached).toBe(false);
  });

  it("recognizes login and challenge markers as terminal readiness states", async () => {
    const page = {
      evaluate: async () => ({
        readyState: "loading",
        bodyTextLength: 23,
        loginMarkers: 1,
        challengeMarkers: 0,
      }),
    };
    await expect(waitForLinkedInSearchState(page, { timeout: 0 })).resolves.toMatchObject({
      state: "login_required",
    });
    page.evaluate = async () => ({
      readyState: "loading",
      bodyTextLength: 23,
      loginMarkers: 0,
      challengeMarkers: 1,
    });
    await expect(waitForLinkedInSearchState(page, { timeout: 0 })).resolves.toMatchObject({
      state: "challenged",
    });
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
