/**
 * Unit tests for the applications/draft pure helpers.
 *
 * These are the logic behind the ApplicationsQueue "Review" action and the
 * JobSearch draft flow: a row keyed by job post id must be resolved to the
 * scored `job_matches.id` that `draft_application` operates on.
 */
import { describe, it, expect } from "vitest";
import { resolveMatchIdForJob } from "./applications";
import type { JobMatchDto } from "../types/domain";

/* ── Fixture ──────────────────────────────────────────────────────── */

const baseMatch: JobMatchDto = {
  id: "m1",
  jobId: "j1",
  profileId: "p1",
  preferenceId: null,
  score: 87,
  roleScore: 90,
  skillScore: 85,
  seniorityScore: 88,
  locationScore: 95,
  salaryScore: 80,
  matchedSkillsJson: "[]",
  missingSkillsJson: "[]",
  riskFlagsJson: "[]",
  recommendation: "apply",
  explanation: "Good fit.",
  modelProvider: null,
  modelName: null,
  createdAt: "2025-01-01T00:00:00Z",
};

/* ── Tests ────────────────────────────────────────────────────────── */

describe("resolveMatchIdForJob", () => {
  it("returns the match id for a job that has been scored", () => {
    expect(resolveMatchIdForJob([baseMatch], "j1")).toBe("m1");
  });

  it("returns null when no match exists for the job (unscored)", () => {
    expect(resolveMatchIdForJob([baseMatch], "j2")).toBeNull();
  });

  it("returns null for an empty matches list", () => {
    expect(resolveMatchIdForJob([], "j1")).toBeNull();
  });

  it("selects the correct match when several jobs are scored", () => {
    const matches: JobMatchDto[] = [
      { ...baseMatch, id: "m1", jobId: "j1" },
      { ...baseMatch, id: "m2", jobId: "j2" },
      { ...baseMatch, id: "m3", jobId: "j3" },
    ];
    expect(resolveMatchIdForJob(matches, "j2")).toBe("m2");
  });

  it("returns the first match when a job has duplicate match rows", () => {
    const matches: JobMatchDto[] = [
      { ...baseMatch, id: "m-old", jobId: "j1" },
      { ...baseMatch, id: "m-new", jobId: "j1" },
    ];
    expect(resolveMatchIdForJob(matches, "j1")).toBe("m-old");
  });
});
