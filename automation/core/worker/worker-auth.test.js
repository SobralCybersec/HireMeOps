import { describe, expect, it } from "vitest";
import { classifyLogin, sanitizeProbeError, selectLoginProbeSites } from "./worker-auth.js";

const loginUrl = /\/login|\/signin/;

describe("login probe classification", () => {
  it("distinguishes valid, login-required and challenged URLs", () => {
    expect(classifyLogin("https://fixture.invalid/dashboard", loginUrl)).toBe("valid");
    expect(classifyLogin("https://fixture.invalid/login", loginUrl)).toBe("login_required");
    expect(classifyLogin("https://fixture.invalid/mfa/challenge", loginUrl)).toBe("challenged");
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
