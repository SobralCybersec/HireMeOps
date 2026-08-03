/**
 * Unit tests for useJobStore.
 *
 * The tauriInvoke module is mocked so no real Tauri IPC takes place.
 * We verify:
 *   - correct command names are called
 *   - arg keys are camelCase on the wire (mirrors cv/library.ts proof)
 *   - store state is updated correctly on success
 *   - error state is set (and null-safe) on failure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist the mock before any imports that depend on tauriInvoke.
vi.mock("../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown) =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

import { safeInvoke, invokeStrict } from "../lib/tauriInvoke";
import { useJobStore } from "./useJobStore";
import type { JobPostDto, JobMatchDto } from "../types/domain";

/* ── Fixtures ─────────────────────────────────────────────────────── */

const mockJob: JobPostDto = {
  id: "j1",
  profileId: "p1",
  platform: "LinkedIn",
  url: "https://linkedin.com/jobs/1",
  canonicalUrl: null,
  title: "Senior Rust Developer",
  company: "Cloudflare",
  location: "Remote",
  remoteMode: "remote",
  summary: null,
  seniority: "senior",
  employmentType: null,
  salaryMin: null,
  salaryMax: null,
  currency: null,
  postedAt: null,
  discoveredAt: "2025-01-01T00:00:00Z",
  status: "discovered",
  searchQueryId: null,
  discoverySource: null,
};

const mockMatch: JobMatchDto = {
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

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Reset store to a clean baseline before each test. */
function resetStore() {
  useJobStore.setState({
    jobs: [],
    matches: [],
    isLoading: false,
    error: null,
  });
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("useJobStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("upsertJob live-inserts a new job and replaces by id (no duplicates)", () => {
    const { upsertJob } = useJobStore.getState();
    upsertJob(mockJob);
    expect(useJobStore.getState().jobs).toHaveLength(1);

    // Same id, updated field → replace in place, still one row.
    upsertJob({ ...mockJob, status: "matched" });
    const jobs = useJobStore.getState().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("matched");

    // A different id prepends (newest first).
    upsertJob({ ...mockJob, id: "j2" });
    expect(useJobStore.getState().jobs.map((j) => j.id)).toEqual(["j2", "j1"]);
  });

  // ── loadJobs ──────────────────────────────────────────────────────
  describe("loadJobs", () => {
    it("calls list_job_posts with camelCase profileId and populates jobs", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockJob]);

      await useJobStore.getState().loadJobs("p1");

      expect(safeInvoke).toHaveBeenCalledWith("list_job_posts", { profileId: "p1" });
      expect(useJobStore.getState().jobs).toEqual([mockJob]);
      expect(useJobStore.getState().isLoading).toBe(false);
    });

    it("forwards statusFilter when provided and not 'all'", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useJobStore.getState().loadJobs("p1", "queued");

      expect(safeInvoke).toHaveBeenCalledWith("list_job_posts", {
        profileId: "p1",
        statusFilter: "queued",
      });
    });

    it("omits statusFilter key entirely when value is 'all'", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useJobStore.getState().loadJobs("p1", "all");

      // Key must be absent so the backend returns all statuses.
      expect(safeInvoke).toHaveBeenCalledWith("list_job_posts", { profileId: "p1" });
    });

    it("sets jobs to [] when safeInvoke returns null (backend error)", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await useJobStore.getState().loadJobs("p1");

      expect(useJobStore.getState().jobs).toEqual([]);
      expect(useJobStore.getState().isLoading).toBe(false);
    });

    it("sets isLoading true during fetch and false after", async () => {
      let resolveInvoke!: (v: JobPostDto[]) => void;
      vi.mocked(safeInvoke).mockReturnValueOnce(
        new Promise<JobPostDto[]>((r) => {
          resolveInvoke = r;
        }),
      );

      const promise = useJobStore.getState().loadJobs("p1");
      expect(useJobStore.getState().isLoading).toBe(true);

      resolveInvoke([mockJob]);
      await promise;
      expect(useJobStore.getState().isLoading).toBe(false);
    });
  });

  // ── loadMatches ───────────────────────────────────────────────────
  describe("loadMatches", () => {
    it("calls list_job_matches with camelCase profileId and populates matches", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockMatch]);

      await useJobStore.getState().loadMatches("p1");

      expect(safeInvoke).toHaveBeenCalledWith("list_job_matches", { profileId: "p1" });
      expect(useJobStore.getState().matches).toEqual([mockMatch]);
    });

    it("sets matches to [] when safeInvoke returns null", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await useJobStore.getState().loadMatches("p1");

      expect(useJobStore.getState().matches).toEqual([]);
    });
  });

  // ── scoreJob ──────────────────────────────────────────────────────
  describe("scoreJob", () => {
    it("calls score_job_match with camelCase jobId + profileId and appends match", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce(mockMatch);

      const result = await useJobStore.getState().scoreJob("j1", "p1");

      expect(invokeStrict).toHaveBeenCalledWith("score_job_match", {
        jobId: "j1",
        profileId: "p1",
      });
      expect(result).toEqual(mockMatch);
      expect(useJobStore.getState().matches).toContainEqual(mockMatch);
    });

    it("forwards preferenceId when provided", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce(mockMatch);

      await useJobStore.getState().scoreJob("j1", "p1", "pref-42");

      expect(invokeStrict).toHaveBeenCalledWith("score_job_match", {
        jobId: "j1",
        profileId: "p1",
        preferenceId: "pref-42",
      });
    });

    it("replaces an existing match for the same jobId", async () => {
      const staleMatch = { ...mockMatch, id: "m0", score: 50 };
      useJobStore.setState({ matches: [staleMatch] });
      const freshMatch = { ...mockMatch, score: 87 };
      vi.mocked(invokeStrict).mockResolvedValueOnce(freshMatch);

      await useJobStore.getState().scoreJob("j1", "p1");

      const matches = useJobStore.getState().matches;
      expect(matches).toHaveLength(1);
      expect(matches[0].score).toBe(87);
    });

    it("sets error and returns null on invokeStrict failure", async () => {
      vi.mocked(invokeStrict).mockRejectedValueOnce("backend error");

      const result = await useJobStore.getState().scoreJob("j1", "p1");

      expect(result).toBeNull();
      expect(useJobStore.getState().error).toMatch(/Score failed/);
      expect(useJobStore.getState().error).toContain("backend error");
    });
  });

  // ── runSearch ─────────────────────────────────────────────────────
  describe("runSearch", () => {
    it("calls run_search with camelCase searchQueryId and returns count", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce(42);

      const result = await useJobStore.getState().runSearch("sq-1");

      expect(invokeStrict).toHaveBeenCalledWith("run_search", { searchQueryId: "sq-1" });
      expect(result).toBe(42);
    });

    it("sets error and returns null on failure", async () => {
      vi.mocked(invokeStrict).mockRejectedValueOnce("network timeout");

      const result = await useJobStore.getState().runSearch("sq-1");

      expect(result).toBeNull();
      expect(useJobStore.getState().error).toMatch(/Search failed/);
      expect(useJobStore.getState().error).toContain("network timeout");
    });
  });

  // ── setJobStatus ──────────────────────────────────────────────────
  describe("setJobStatus", () => {
    it("calls update_job_status with camelCase args and optimistically updates job", async () => {
      useJobStore.setState({ jobs: [mockJob] });
      vi.mocked(invokeStrict).mockResolvedValueOnce(undefined);

      await useJobStore.getState().setJobStatus("j1", "queued");

      expect(invokeStrict).toHaveBeenCalledWith("update_job_status", {
        jobId: "j1",
        status: "queued",
      });
      expect(useJobStore.getState().jobs[0].status).toBe("queued");
    });

    it("does not mutate jobs that don't match the jobId", async () => {
      const otherJob: JobPostDto = { ...mockJob, id: "j2", status: "saved" };
      useJobStore.setState({ jobs: [mockJob, otherJob] });
      vi.mocked(invokeStrict).mockResolvedValueOnce(undefined);

      await useJobStore.getState().setJobStatus("j1", "queued");

      expect(useJobStore.getState().jobs[1].status).toBe("saved");
    });

    it("sets error on invokeStrict failure without touching jobs", async () => {
      useJobStore.setState({ jobs: [mockJob] });
      vi.mocked(invokeStrict).mockRejectedValueOnce("db error");

      await useJobStore.getState().setJobStatus("j1", "queued");

      expect(useJobStore.getState().error).toMatch(/Status update failed/);
      // Status must NOT have changed - backend rejected the write.
      expect(useJobStore.getState().jobs[0].status).toBe("discovered");
    });
  });

  // ── clearError ────────────────────────────────────────────────────
  describe("clearError", () => {
    it("sets error back to null", () => {
      useJobStore.setState({ error: "something went wrong" });

      useJobStore.getState().clearError();

      expect(useJobStore.getState().error).toBeNull();
    });
  });
});
