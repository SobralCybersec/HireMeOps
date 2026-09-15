import { create } from "zustand";
import type { JobFilters } from "../types/domain";

const DEFAULT_FILTERS: JobFilters = {
  targetRoles: [],
  seniority: [],
  locations: [],
  remoteModes: [],
  minSalary: null,
  requiredSkills: [],
  preferredSkills: [],
  excludedKeywords: [],
  blockedCompanies: [],
};

interface JobFiltersStoreState {
  filters: JobFilters;
  setFilter: <K extends keyof JobFilters>(key: K, value: JobFilters[K]) => void;
  reset: () => void;
}

export const useJobFiltersStore = create<JobFiltersStoreState>((set) => ({
  filters: DEFAULT_FILTERS,
  setFilter: (key, value) => set((state) => ({ filters: { ...state.filters, [key]: value } })),
  reset: () => set({ filters: DEFAULT_FILTERS }),
}));
