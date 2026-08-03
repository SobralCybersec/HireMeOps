/**
 * Unit tests for useJobPreferencesStore.
 *
 * The tauriInvoke module is mocked so no real Tauri IPC takes place.
 * We verify:
 *   - correct command names are called
 *   - arg keys are camelCase on the wire (list) and nested under `input` (create)
 *   - store state is updated correctly on success
 *   - error state is set (and null-safe) on failure
 *   - the create path refetches the list so the new row is reflected
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
import { useJobPreferencesStore } from "./useJobPreferencesStore";
import type { JobPreferenceDto, CreateJobPreferenceInput } from "../types/domain";

/* ── Fixtures ─────────────────────────────────────────────────────── */

const mockPref: JobPreferenceDto = {
  id: "pref-1",
  profileId: "p1",
  name: "Default",
  targetRolesJson: '["Backend Engineer"]',
  seniorityJson: '["Senior"]',
  locationsJson: '["Remote"]',
  remoteModesJson: '["Remote"]',
  minSalary: 120000,
  salaryCurrency: "USD",
  requiredSkillsJson: '["Rust"]',
  preferredSkillsJson: '["gRPC"]',
  excludedKeywordsJson: "[]",
  blockedCompaniesJson: "[]",
  autoApplyEnabled: true,
  autoSubmitEnabled: true,
  autoSubmitMinScore: 60,
  needsReviewConfidenceThreshold: 50,
  retryFailedEnabled: true,
  retryLimit: 10,
  dailyApplicationLimit: null,
  dailyConnectionLimit: null,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

const mockInput: CreateJobPreferenceInput = {
  profileId: "p1",
  name: "Default",
  targetRolesJson: '["Backend Engineer"]',
  minSalary: 120000,
  salaryCurrency: "USD",
};

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Reset store to a clean baseline before each test. */
function resetStore() {
  useJobPreferencesStore.setState({
    preferences: [],
    isLoading: false,
    isSaving: false,
    error: null,
  });
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("useJobPreferencesStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── load ──────────────────────────────────────────────────────────
  describe("load", () => {
    it("calls list_job_preferences with camelCase profileId and populates preferences", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockPref]);

      await useJobPreferencesStore.getState().load("p1");

      expect(safeInvoke).toHaveBeenCalledWith("list_job_preferences", {
        profileId: "p1",
      });
      expect(useJobPreferencesStore.getState().preferences).toEqual([mockPref]);
      expect(useJobPreferencesStore.getState().isLoading).toBe(false);
    });

    it("sets preferences to [] when safeInvoke returns null (backend error)", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await useJobPreferencesStore.getState().load("p1");

      expect(useJobPreferencesStore.getState().preferences).toEqual([]);
      expect(useJobPreferencesStore.getState().isLoading).toBe(false);
    });

    it("sets isLoading true during fetch and false after", async () => {
      let resolveInvoke!: (v: JobPreferenceDto[]) => void;
      vi.mocked(safeInvoke).mockReturnValueOnce(
        new Promise<JobPreferenceDto[]>((r) => {
          resolveInvoke = r;
        }),
      );

      const promise = useJobPreferencesStore.getState().load("p1");
      expect(useJobPreferencesStore.getState().isLoading).toBe(true);

      resolveInvoke([mockPref]);
      await promise;
      expect(useJobPreferencesStore.getState().isLoading).toBe(false);
    });
  });

  // ── save ──────────────────────────────────────────────────────────
  describe("save", () => {
    it("calls create_job_preference with the payload nested under `input`", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce("pref-1");
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockPref]);

      const id = await useJobPreferencesStore.getState().save(mockInput);

      expect(invokeStrict).toHaveBeenCalledWith("create_job_preference", {
        input: mockInput,
      });
      expect(id).toBe("pref-1");
    });

    it("refetches the list (camelCase profileId) after a successful create", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce("pref-1");
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockPref]);

      await useJobPreferencesStore.getState().save(mockInput);

      expect(safeInvoke).toHaveBeenCalledWith("list_job_preferences", {
        profileId: "p1",
      });
      expect(useJobPreferencesStore.getState().preferences).toEqual([mockPref]);
      expect(useJobPreferencesStore.getState().isSaving).toBe(false);
    });

    it("keeps existing preferences when the post-create refetch fails", async () => {
      useJobPreferencesStore.setState({ preferences: [mockPref] });
      vi.mocked(invokeStrict).mockResolvedValueOnce("pref-2");
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await useJobPreferencesStore.getState().save(mockInput);

      // Refetch returned null → previous list is preserved, not wiped.
      expect(useJobPreferencesStore.getState().preferences).toEqual([mockPref]);
    });

    it("sets error and returns null on invokeStrict failure, without refetching", async () => {
      vi.mocked(invokeStrict).mockRejectedValueOnce("write rejected");

      const id = await useJobPreferencesStore.getState().save(mockInput);

      expect(id).toBeNull();
      expect(useJobPreferencesStore.getState().error).toBe("write rejected");
      expect(useJobPreferencesStore.getState().isSaving).toBe(false);
      // The list must NOT be refetched when the write itself failed.
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("sets isSaving true during the write and false after", async () => {
      let resolveInvoke!: (v: string) => void;
      vi.mocked(invokeStrict).mockReturnValueOnce(
        new Promise<string>((r) => {
          resolveInvoke = r;
        }),
      );
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockPref]);

      const promise = useJobPreferencesStore.getState().save(mockInput);
      expect(useJobPreferencesStore.getState().isSaving).toBe(true);

      resolveInvoke("pref-1");
      await promise;
      expect(useJobPreferencesStore.getState().isSaving).toBe(false);
    });
  });

  // ── clearError ────────────────────────────────────────────────────
  describe("clearError", () => {
    it("sets error back to null", () => {
      useJobPreferencesStore.setState({ error: "something went wrong" });

      useJobPreferencesStore.getState().clearError();

      expect(useJobPreferencesStore.getState().error).toBeNull();
    });
  });
});
