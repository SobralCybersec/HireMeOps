import { describe, expect, it, vi } from "vitest";
import {
  classifyLinkedInAuth,
  classifyLogin,
  sanitizeProbeError,
  selectLoginProbeSites,
  waitForLinkedInAuthState,
} from "./worker-auth.js";

const loginUrl = /\/login|\/signin/;

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
      }),
    ).toBe("unknown");
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
