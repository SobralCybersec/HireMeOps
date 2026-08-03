/**
 * Unit tests for useSearchQueryStore.
 *
 * The tauriInvoke module is mocked so no real Tauri IPC takes place.
 * We verify:
 *   - correct command names are called
 *   - arg keys are camelCase on the wire, and preferenceId is omitted when unset
 *   - store state is updated correctly on success (including generate → reload)
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
import { useSearchQueryStore } from "./useSearchQueryStore";
import type { SearchQueryDto, SearchQueryInput } from "../types/domain";

/* ── Fixtures ─────────────────────────────────────────────────────── */

const mockQuery: SearchQueryDto = {
  id: "sq1",
  profileId: "p1",
  preferenceId: null,
  platform: "linkedin",
  query: '("Senior Rust Engineer") ("Rust") remote',
  queryType: "linkedin_search",
  enabled: true,
  lastRunAt: null,
  createdAt: "2025-01-01T00:00:00Z",
};

const mockInput: SearchQueryInput = {
  profileId: "p1",
  titles: ["Senior Rust Engineer"],
  requiredSkills: ["Rust", "Tokio"],
  location: "Berlin",
  remoteMode: "remote",
  seniority: ["senior"],
};

/* ── Helpers ──────────────────────────────────────────────────────── */

/** Reset store to a clean baseline before each test. */
function resetStore() {
  useSearchQueryStore.setState({
    queries: [],
    isLoading: false,
    isGenerating: false,
    error: null,
  });
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("useSearchQueryStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // ── load ──────────────────────────────────────────────────────────
  describe("load", () => {
    it("calls list_search_queries with camelCase profileId and populates queries", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockQuery]);

      await useSearchQueryStore.getState().load("p1");

      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", {
        profileId: "p1",
      });
      expect(useSearchQueryStore.getState().queries).toEqual([mockQuery]);
      expect(useSearchQueryStore.getState().isLoading).toBe(false);
    });

    it("forwards preferenceId when provided", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useSearchQueryStore.getState().load("p1", "pref1");

      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", {
        profileId: "p1",
        preferenceId: "pref1",
      });
    });

    it("omits preferenceId key entirely when undefined", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useSearchQueryStore.getState().load("p1");

      // Key must be absent so the backend returns every query for the profile.
      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", {
        profileId: "p1",
      });
    });

    it("sets queries to [] when safeInvoke returns null (backend error)", async () => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(null);

      await useSearchQueryStore.getState().load("p1");

      expect(useSearchQueryStore.getState().queries).toEqual([]);
      expect(useSearchQueryStore.getState().isLoading).toBe(false);
    });

    it("sets isLoading true during fetch and false after", async () => {
      let resolveInvoke!: (v: SearchQueryDto[]) => void;
      vi.mocked(safeInvoke).mockReturnValueOnce(
        new Promise<SearchQueryDto[]>((r) => {
          resolveInvoke = r;
        }),
      );

      const promise = useSearchQueryStore.getState().load("p1");
      expect(useSearchQueryStore.getState().isLoading).toBe(true);

      resolveInvoke([mockQuery]);
      await promise;
      expect(useSearchQueryStore.getState().isLoading).toBe(false);
    });
  });

  // ── generate ──────────────────────────────────────────────────────
  describe("generate", () => {
    it("calls generate_search_queries with the input, then reloads the list", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce(["sq1", "sq2"]);
      // generate() calls load() internally, which uses safeInvoke.
      vi.mocked(safeInvoke).mockResolvedValueOnce([mockQuery]);

      const ids = await useSearchQueryStore.getState().generate(mockInput);

      expect(invokeStrict).toHaveBeenCalledWith("generate_search_queries", {
        input: mockInput,
      });
      // Reload uses the input's profileId; preferenceId undefined → omitted.
      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", {
        profileId: "p1",
      });
      expect(ids).toEqual(["sq1", "sq2"]);
      expect(useSearchQueryStore.getState().queries).toEqual([mockQuery]);
      expect(useSearchQueryStore.getState().isGenerating).toBe(false);
    });

    it("forwards preferenceId to the reload when present on the input", async () => {
      vi.mocked(invokeStrict).mockResolvedValueOnce(["sq1"]);
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useSearchQueryStore.getState().generate({ ...mockInput, preferenceId: "pref1" });

      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", {
        profileId: "p1",
        preferenceId: "pref1",
      });
    });

    it("sets error and returns null when invokeStrict rejects", async () => {
      vi.mocked(invokeStrict).mockRejectedValueOnce("boom");

      const ids = await useSearchQueryStore.getState().generate(mockInput);

      expect(ids).toBeNull();
      expect(useSearchQueryStore.getState().error).toBe("Generate failed: boom");
      expect(useSearchQueryStore.getState().isGenerating).toBe(false);
      // Failure must not trigger a reload.
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("sets isGenerating true during the call and false after", async () => {
      let resolveInvoke!: (v: string[]) => void;
      vi.mocked(invokeStrict).mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolveInvoke = r;
        }),
      );
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      const promise = useSearchQueryStore.getState().generate(mockInput);
      expect(useSearchQueryStore.getState().isGenerating).toBe(true);

      resolveInvoke(["sq1"]);
      await promise;
      expect(useSearchQueryStore.getState().isGenerating).toBe(false);
    });
  });

  // ── remove ────────────────────────────────────────────────────────
  describe("remove", () => {
    it("calls delete_search_query with id, then reloads the list for the query's profile", async () => {
      useSearchQueryStore.setState({ queries: [mockQuery] });
      vi.mocked(invokeStrict).mockResolvedValueOnce(undefined);
      vi.mocked(safeInvoke).mockResolvedValueOnce([]);

      await useSearchQueryStore.getState().remove("sq1");

      expect(invokeStrict).toHaveBeenCalledWith("delete_search_query", { id: "sq1" });
      expect(safeInvoke).toHaveBeenCalledWith("list_search_queries", { profileId: "p1" });
      expect(useSearchQueryStore.getState().error).toBeNull();
    });

    it("sets error and does not reload when invokeStrict rejects", async () => {
      useSearchQueryStore.setState({ queries: [mockQuery] });
      vi.mocked(invokeStrict).mockRejectedValueOnce("oops");

      await useSearchQueryStore.getState().remove("sq1");

      expect(useSearchQueryStore.getState().error).toBe("Delete failed: oops");
      expect(safeInvoke).not.toHaveBeenCalled();
    });

    it("skips reload when the id is not found in the current query list", async () => {
      useSearchQueryStore.setState({ queries: [] });
      vi.mocked(invokeStrict).mockResolvedValueOnce(undefined);

      await useSearchQueryStore.getState().remove("unknown");

      expect(invokeStrict).toHaveBeenCalledWith("delete_search_query", { id: "unknown" });
      // profileId undefined → load is not called
      expect(safeInvoke).not.toHaveBeenCalled();
    });
  });

  // ── clearError ────────────────────────────────────────────────────
  describe("clearError", () => {
    it("resets error to null", () => {
      useSearchQueryStore.setState({ error: "something failed" });
      useSearchQueryStore.getState().clearError();
      expect(useSearchQueryStore.getState().error).toBeNull();
    });
  });
});
