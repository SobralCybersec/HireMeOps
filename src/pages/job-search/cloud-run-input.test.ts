import { describe, expect, it } from "vitest";
import type { JobFilters, SearchQueryDto } from "../../types/domain";
import { buildLinkedInCloudRunInput } from "./cloud-run-input";

const filters: JobFilters = {
  targetRoles: ["Backend Engineer"],
  seniority: [],
  locations: ["Rio de Janeiro"],
  remoteModes: ["Remote"],
  minSalary: null,
  requiredSkills: [],
  preferredSkills: [],
  excludedKeywords: [],
  blockedCompanies: [],
};

const query: SearchQueryDto = {
  id: "query-1",
  profileId: "default",
  preferenceId: null,
  platform: "linkedin",
  query: "backend engineer",
  queryType: "generated",
  enabled: true,
  lastRunAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("buildLinkedInCloudRunInput", () => {
  it("uses active profile and produces target-only cloud plan", () => {
    const input = buildLinkedInCloudRunInput(" default ", query, filters);

    expect(input.profileId).toBe("default");
    expect(input.queryPlan).toEqual({
      platform: "linkedin",
      command: "search_jobs",
      args: {
        keywords: "backend engineer",
        location: "Rio de Janeiro",
        page_index: 0,
        filters: { easy_apply_only: false, remote_only: true },
      },
    });
  });

  it("changes profile with active profile instead of using a fixed id", () => {
    const nextProfile = { ...query, profileId: "work" };
    expect(buildLinkedInCloudRunInput("work", nextProfile, filters).profileId).toBe("work");
  });

  it("rejects a query belonging to another profile", () => {
    expect(() => buildLinkedInCloudRunInput("work", query, filters)).toThrow(
      "Search query belongs to a different profile.",
    );
  });
});
