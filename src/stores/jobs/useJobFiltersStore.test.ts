import { beforeEach, describe, expect, it } from "vitest";
import { useJobFiltersStore } from "./useJobFiltersStore";

function resetStore() {
  useJobFiltersStore.setState({
    filters: {
      targetRoles: [],
      seniority: [],
      locations: [],
      remoteModes: [],
      minSalary: null,
      requiredSkills: [],
      preferredSkills: [],
      excludedKeywords: [],
      blockedCompanies: [],
    },
  });
}

describe("useJobFiltersStore", () => {
  beforeEach(resetStore);

  it("setFilter updates a single key and leaves the rest untouched", () => {
    useJobFiltersStore.getState().setFilter("targetRoles", ["Frontend Engineer"]);
    const f = useJobFiltersStore.getState().filters;
    expect(f.targetRoles).toEqual(["Frontend Engineer"]);
    // Other keys are unchanged.
    expect(f.seniority).toEqual([]);
    expect(f.minSalary).toBeNull();
  });

  it("setFilter can set a scalar (minSalary) field", () => {
    useJobFiltersStore.getState().setFilter("minSalary", 120000);
    expect(useJobFiltersStore.getState().filters.minSalary).toBe(120000);
  });

  it("successive setFilter calls accumulate across keys", () => {
    useJobFiltersStore.getState().setFilter("locations", ["Remote"]);
    useJobFiltersStore.getState().setFilter("remoteModes", ["remote"]);
    const f = useJobFiltersStore.getState().filters;
    expect(f.locations).toEqual(["Remote"]);
    expect(f.remoteModes).toEqual(["remote"]);
  });

  it("reset restores every filter to its default", () => {
    useJobFiltersStore.getState().setFilter("targetRoles", ["X"]);
    useJobFiltersStore.getState().setFilter("minSalary", 999);
    useJobFiltersStore.getState().reset();
    const f = useJobFiltersStore.getState().filters;
    expect(f.targetRoles).toEqual([]);
    expect(f.minSalary).toBeNull();
  });
});
