import { create } from "zustand";
import type { JobPreferenceDto, CreateJobPreferenceInput } from "../types/domain";
import { safeInvoke, invokeStrict, errMessage } from "../lib/tauriInvoke";
import { useJobFiltersStore } from "./useJobFiltersStore";

interface JobPreferencesStoreState {
  preferences: JobPreferenceDto[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  /**
   * Load all job preferences for a profile via `list_job_preferences`.
   * Read path - uses safeInvoke, so a backend failure collapses to an empty
   * list rather than throwing.
   */
  load: (profileId: string) => Promise<void>;

  /**
   * Persist a new preference set via `create_job_preference`. Write path -
   * uses invokeStrict so a real backend error surfaces (and is stored in
   * `error`). On success the list is refetched so the new row is reflected.
   *
   * NOTE: the backend only exposes create (no update), so each call inserts a
   * *new* preference row. Returns the new row id, or null on failure.
   */
  save: (input: CreateJobPreferenceInput) => Promise<string | null>;

  clearError: () => void;
}

export const useJobPreferencesStore = create<JobPreferencesStoreState>((set, get) => ({
  preferences: [],
  isLoading: false,
  isSaving: false,
  error: null,

  load: async (profileId) => {
    set({ isLoading: true, error: null });
    const preferences = await safeInvoke<JobPreferenceDto[]>("list_job_preferences", { profileId });
    set({ preferences: preferences ?? [], isLoading: false });

    // Auto-hydrate filters on boot: only when targetRoles is empty (i.e. user
    // has not customised the filters this session) and we have saved preferences.
    // Hydrate the FULL set — excludedKeywords/blockedCompanies drive the scorer's
    // hard-skip, so they must be live even if the user never opens the
    // calibration panel (the preferences page is now merged into Job Search).
    const arr = preferences ?? [];
    const latest = arr[arr.length - 1];
    if (latest && useJobFiltersStore.getState().filters.targetRoles.length === 0) {
      const parse = (json: string | null | undefined): string[] => {
        try {
          return JSON.parse(json ?? "[]") as string[];
        } catch {
          return [];
        }
      };
      const s = useJobFiltersStore.getState();
      s.setFilter("targetRoles", parse(latest.targetRolesJson));
      s.setFilter("seniority", parse(latest.seniorityJson));
      s.setFilter("locations", parse(latest.locationsJson));
      s.setFilter("remoteModes", parse(latest.remoteModesJson));
      s.setFilter("requiredSkills", parse(latest.requiredSkillsJson));
      s.setFilter("preferredSkills", parse(latest.preferredSkillsJson));
      s.setFilter("excludedKeywords", parse(latest.excludedKeywordsJson));
      s.setFilter("blockedCompanies", parse(latest.blockedCompaniesJson));
      s.setFilter("minSalary", latest.minSalary ?? null);
    }
  },

  save: async (input) => {
    set({ isSaving: true, error: null });
    try {
      // Rust signature is `create_job_preference(input: CreateJobPreferenceInput)`
      // → the payload is nested under `input` (camelCase keys inside).
      const id = await invokeStrict<string>("create_job_preference", {
        input,
      });
      // Refetch so the freshly-created row appears without a manual reload.
      const preferences = await safeInvoke<JobPreferenceDto[]>("list_job_preferences", {
        profileId: input.profileId,
      });
      set({
        preferences: preferences ?? get().preferences,
        isSaving: false,
      });
      return id;
    } catch (e) {
      set({ error: errMessage(e), isSaving: false });
      return null;
    }
  },

  clearError: () => set({ error: null }),
}));
