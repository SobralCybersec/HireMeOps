// Tests upwork-jobs.js: buildUpworkSearchUrl, stripTags, findJobsArray, nuxtJobToCard.
import { describe, it, expect } from "vitest";
import { buildUpworkSearchUrl, findJobsArray, nuxtJobToCard, stripTags } from "./upwork-jobs.js";

describe("buildUpworkSearchUrl", () => {
  it("builds the documented newest-first query shape", () => {
    expect(buildUpworkSearchUrl({ query: "java developer" })).toBe(
      "https://www.upwork.com/nx/search/jobs/?nbs=1&q=java%20developer&sort=recency",
    );
  });
  it("omits page for page 1, appends &page=N for N>1", () => {
    expect(buildUpworkSearchUrl({ query: "java", page: 1 })).not.toContain("page=");
    expect(buildUpworkSearchUrl({ query: "java", page: 2 })).toContain("&page=2");
  });
  it("comma-joins contractor_tier and job type when present", () => {
    const url = buildUpworkSearchUrl({ query: "x", contractorTier: [2, 3], jobType: [0] });
    expect(url).toContain("contractor_tier=2,3");
    expect(url).toContain("t=0");
  });
});

describe("stripTags", () => {
  it("removes highlight markup and decodes basic entities", () => {
    expect(stripTags('Senior <span class="highlight">Java</span> Dev')).toBe("Senior Java Dev");
    expect(stripTags("A &amp; B &lt;ok&gt;")).toBe("A & B <ok>");
  });
});

describe("findJobsArray", () => {
  it("deep-finds the array whose items carry ciphertext + title", () => {
    const root = { a: { b: { state: { xyz: { jobs: [{ ciphertext: "~021", title: "T" }] } } } } };
    const arr = findJobsArray(root);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].ciphertext).toBe("~021");
  });
  it("returns null when no job-like array exists", () => {
    expect(findJobsArray({ a: [1, 2, 3], b: { c: "x" } })).toBe(null);
  });
});

describe("nuxtJobToCard", () => {
  it("maps a NUXT job record, folding budget + skills into the description", () => {
    const card = nuxtJobToCard({
      uid: "42",
      ciphertext: "~0242",
      title: '<span class="highlight">Java</span> Dev',
      description: "Build things.",
      hourlyBudget: { min: 20, max: 30 },
      attrs: [{ prettyName: "Java" }, { prefLabel: "Spring Boot" }],
      client: { location: { country: "US" } },
    });
    expect(card.job_id).toBe("42");
    expect(card.title).toBe("Java Dev");
    expect(card.apply_url).toBe("https://www.upwork.com/jobs/~0242/");
    expect(card.is_easy_apply).toBe(false);
    expect(card.location).toBe("US");
    expect(card.description).toContain("Rate: $20–$30/hr");
    expect(card.description).toContain("Skills: Java, Spring Boot");
    expect(card.description).toContain("Build things.");
  });
});
