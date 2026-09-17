import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdCheckLogin, cmdCheckLogins } from "./worker-auth.js";
import { sessions } from "./worker-context.js";

function pageAt(url, markers = {}) {
  return {
    url: vi.fn(() => url),
    isClosed: vi.fn(() => false),
    goto: vi.fn(),
    evaluate: vi.fn(async () => markers),
    close: vi.fn(async () => {}),
  };
}

function browserWith(page) {
  return {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
  };
}

beforeEach(() => sessions.clear());
afterEach(() => sessions.clear());

describe("login probe navigation lifecycle", () => {
  it("does not navigate an existing LinkedIn page for a single check", async () => {
    const page = pageAt("https://www.linkedin.com/checkpoint/challenge/");
    const browser = browserWith(page);
    sessions.set("handle-1", { user_data_dir: "profile-1", browser, page });

    const result = await cmdCheckLogin({ user_data_dir: "profile-1" });

    expect(result).toEqual({ logged_in: false });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("classifies open portal pages without resetting them during all-site checks", async () => {
    const page = pageAt("https://www.linkedin.com/feed/", { authenticatedMarkers: 1 });
    const browser = browserWith(page);
    sessions.set("handle-1", { user_data_dir: "profile-1", browser, page });

    const result = await cmdCheckLogins({ user_data_dir: "profile-1", sites: ["linkedin"] });

    expect(result.platform_status).toEqual({ linkedin: "valid" });
    expect(result.status).toEqual({ linkedin: true });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("does not treat an arbitrary LinkedIn page as authenticated", async () => {
    const page = pageAt("https://www.linkedin.com/jobs/search/");
    const browser = browserWith(page);
    sessions.set("handle-1", { user_data_dir: "profile-1", browser, page });

    const result = await cmdCheckLogins({ user_data_dir: "profile-1", sites: ["linkedin"] });

    expect(result.platform_status).toEqual({ linkedin: "unknown" });
    expect(result.status).toEqual({ linkedin: false });
    expect(page.goto).not.toHaveBeenCalled();
  });
});
