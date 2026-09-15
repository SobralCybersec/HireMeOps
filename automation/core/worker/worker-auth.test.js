import { describe, expect, it } from "vitest";
import { classifyLogin } from "./worker-auth.js";

const loginUrl = /\/login|\/signin/;

describe("login probe classification", () => {
  it("distinguishes valid, login-required and challenged URLs", () => {
    expect(classifyLogin("https://fixture.invalid/dashboard", loginUrl)).toBe("valid");
    expect(classifyLogin("https://fixture.invalid/login", loginUrl)).toBe("login_required");
    expect(classifyLogin("https://fixture.invalid/mfa/challenge", loginUrl)).toBe("challenged");
  });
});
