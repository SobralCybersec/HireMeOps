import { describe, expect, it } from "vitest";
import { classifyPageAuth } from "./cloud-auth.mjs";

function pageAt(url, markers) {
  return {
    url: () => url,
    evaluate: async () => markers,
  };
}

describe("cloud page authentication", () => {
  it("does not treat a same-host shell as authenticated", async () => {
    await expect(
      classifyPageAuth(
        "linkedin",
        pageAt("https://www.linkedin.com/jobs/search/", { authenticatedMarkers: 0 }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });
  });

  it("requires positive LinkedIn UI evidence", async () => {
    await expect(
      classifyPageAuth(
        "linkedin",
        pageAt("https://www.linkedin.com/feed/", { authenticatedMarkers: 1 }),
      ),
    ).resolves.toMatchObject({ status: "valid" });
  });

  it("preserves challenge classification from page markers", async () => {
    await expect(
      classifyPageAuth(
        "linkedin",
        pageAt("https://www.linkedin.com/jobs/search/", { challengeMarkers: 1 }),
      ),
    ).resolves.toMatchObject({ status: "challenged" });
  });
});
