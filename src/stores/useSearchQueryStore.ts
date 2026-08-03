import { create } from "zustand";
import type { SearchQueryDto, SearchQueryInput } from "../types/domain";
import { safeInvoke, invokeStrict, errMessage } from "../lib/tauriInvoke";

interface SearchQueryStoreState {
  queries: SearchQueryDto[];
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;

  /**
   * Load saved search queries for the given profile. When `preferenceId` is
   * provided it narrows the list to that preference; otherwise every query for
   * the profile is returned. On backend failure safeInvoke collapses to null →
   * empty list.
   */
  load: (profileId: string, preferenceId?: string) => Promise<void>;

  /**
   * Generate (and persist) LinkedIn + Google dork queries from the given
   * preference input. Uses invokeStrict so backend errors reach the UI, then
   * reloads the saved list. Returns the new query ids on success, or null on
   * failure.
   */
  generate: (input: SearchQueryInput) => Promise<string[] | null>;

  /**
   * Delete a saved search query by id and reload the list for its profile.
   * Uses invokeStrict so backend errors surface in `error`.
   */
  remove: (id: string) => Promise<void>;

  clearError: () => void;
}

export const useSearchQueryStore = create<SearchQueryStoreState>((set, get) => ({
  queries: [],
  isLoading: false,
  isGenerating: false,
  error: null,

  load: async (profileId, preferenceId) => {
    set({ isLoading: true, error: null });
    const args: Record<string, unknown> = { profileId };
    // Only forward a concrete preference id - omit the key entirely otherwise
    // so the backend returns every query for the profile.
    if (preferenceId !== undefined) args.preferenceId = preferenceId;
    const queries = await safeInvoke<SearchQueryDto[]>("list_search_queries", args);
    set({ queries: queries ?? [], isLoading: false });
  },

  generate: async (input) => {
    set({ isGenerating: true, error: null });
    try {
      const ids = await invokeStrict<string[]>("generate_search_queries", {
        input,
      });
      // Refresh the saved list so callers see the newly persisted rows.
      await get().load(input.profileId, input.preferenceId ?? undefined);
      set({ isGenerating: false });
      return ids;
    } catch (e) {
      set({ error: `Generate failed: ${errMessage(e)}`, isGenerating: false });
      return null;
    }
  },

  remove: async (id) => {
    // Capture profileId before the delete so reload still works if this was
    // the last query for the profile.
    const profileId = get().queries.find((q) => q.id === id)?.profileId;
    set({ error: null });
    try {
      await invokeStrict<void>("delete_search_query", { id });
      if (profileId !== undefined) await get().load(profileId);
    } catch (e) {
      set({ error: `Delete failed: ${errMessage(e)}` });
    }
  },

  clearError: () => set({ error: null }),
}));
