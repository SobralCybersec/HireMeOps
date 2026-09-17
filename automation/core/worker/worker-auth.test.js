import { describe, expect, it } from "vitest";
import {
  classifyLinkedInAuth,
  classifyLogin,
  sanitizeProbeError,
  selectLoginProbeSites,
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
