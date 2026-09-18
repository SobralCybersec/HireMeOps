import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyLinkedInAuth,
  classifyLogin,
  sanitizeProbeError,
  selectLoginProbeSites,
  waitForLinkedInAuthState,
} from "./worker-auth.js";
import { inspectLinkedInAuthDocument } from "../../platforms/linkedin/linkedin-search-dom.js";

const loginUrl = /\/login|\/signin/;

afterEach(() => vi.unstubAllGlobals());

describe("login probe classification", () => {
  it("distinguishes valid, login-required and challenged URLs", () => {
    expect(classifyLogin("https://fixture.invalid/dashboard", loginUrl)).toBe("valid");
    expect(classifyLogin("https://fixture.invalid/login", loginUrl)).toBe("login_required");
    expect(classifyLogin("https://fixture.invalid/mfa/challenge", loginUrl)).toBe("challenged");
  });

  it("requires positive DOM evidence for LinkedIn authentication", () => {
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/jobs/search/",
        authenticatedMarkers: 0,
        authenticatedNavDestinations: 2,
      }),
    ).toBe("unknown");
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/feed/",
        authenticatedMarkers: 0,
        authenticatedNavDestinations: 3,
      }),
    ).toBe("valid");
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/feed/",
        authenticatedMarkers: 0,
        authenticatedNavDestinations: 5,
        loginMarkers: 1,
      }),
    ).toBe("login_required");
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/feed/",
        authenticatedMarkers: 1,
      }),
    ).toBe("valid");
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/jobs/search/",
        challengeMarkers: 1,
      }),
    ).toBe("challenged");
    expect(
      classifyLinkedInAuth({
        url: "https://www.linkedin.com/jobs/search/",
        loginMarkers: 1,
      }),
    ).toBe("login_required");
  });

  it("counts distinct authenticated navigation destinations", () => {
    const selectors = [
      'a[href*="/feed/"]',
      'a[href*="/mynetwork/"]',
      'a[href*="/jobs/"]',
      'a[href*="/messaging/"]',
      'a[href*="/notifications/"]',
    ];
    const visibleNode = { getClientRects: () => [1] };
    const nodes = new Map(selectors.map((selector) => [selector, [visibleNode]]));
    const querySelectorAll = vi.fn((selector) => nodes.get(selector) ?? []);
    vi.stubGlobal("window", {
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    });
    vi.stubGlobal("document", {
      querySelectorAll,
      title: "LinkedIn",
      scripts: [],
      body: { children: [], innerText: "authenticated" },
      documentElement: { outerHTML: "<html></html>" },
    });

    expect(inspectLinkedInAuthDocument()).toMatchObject({
      authenticatedMarkers: 0,
      authenticatedNavDestinations: 5,
      loginMarkers: 0,
      challengeMarkers: 0,
    });
  });

  it("waits for positive authentication evidence after commit", async () => {
    let calls = 0;
    const page = {
      url: () => "https://www.linkedin.com/feed/",
      evaluate: vi.fn(async () => ({ authenticatedMarkers: calls++ > 0 ? 1 : 0 })),
      waitForTimeout: vi.fn(async () => {}),
    };
    await expect(waitForLinkedInAuthState(page, { timeout: 100 })).resolves.toMatchObject({
      status: "valid",
    });
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it("returns unknown after bounded auth probing without evidence", async () => {
    const page = {
      url: () => "https://www.linkedin.com/feed/",
      evaluate: vi.fn(async () => ({ authenticatedMarkers: 0 })),
    };
    await expect(waitForLinkedInAuthState(page, { timeout: 0 })).resolves.toMatchObject({
      status: "unknown",
    });
  });

  it("selects only requested login probes", () => {
    expect(selectLoginProbeSites(["linkedin"])).toEqual(["linkedin"]);
    expect(selectLoginProbeSites(["linkedin", "not-a-platform"])).toEqual(["linkedin"]);
    expect(selectLoginProbeSites()).toContain("infojobs");
  });

  it("redacts secret-like values from probe errors", () => {
    expect(sanitizeProbeError({ name: "TimeoutError", message: "token=fixture-secret" })).toBe(
      "token=[redacted]",
    );
  });
});
