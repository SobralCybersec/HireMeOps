import { describe, expect, it } from "vitest";
import { infojobsPushProfile } from "./infojobs.js";

describe("infojobsPushProfile", () => {
  it("uses the InfoJobs CV URL when opening the profile form", async () => {
    const navigations = [];
    const locator = {
      first() {
        return this;
      },
      isVisible: async () => false,
    };
    const page = {
      locator: () => locator,
      goto: async (url) => navigations.push(url),
      waitForSelector: async () => {
        throw new Error("synthetic form unavailable");
      },
    };

    await infojobsPushProfile(page);

    expect(navigations).toEqual(["https://www.infojobs.com.br/candidate/cv/insert2.aspx"]);
  });
});
