import { useJobStore } from "../../stores/useJobStore";
import { useJobFiltersStore } from "../../stores/useJobFiltersStore";
import { useSearchQueryStore } from "../../stores/useSearchQueryStore";
import { useProfileStore } from "../../stores/useProfileStore";
import { useJobPreferencesStore } from "../../stores/useJobPreferencesStore";
import { useJobSearchEffects } from "./useJobSearchEffects";
import type { JobSearchState } from "./useJobSearchState";

export function useJobSearchData(state: JobSearchState) {
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const filters = useJobFiltersStore((s) => s.filters);
  const jobStore = useJobStore();
  const isGenerating = useSearchQueryStore((s) => s.isGenerating);
  const searchError = useSearchQueryStore((s) => s.error);
  const savedQueries = useSearchQueryStore((s) => s.queries);
  const loadQueries = useSearchQueryStore((s) => s.load);
  const generateQueries = useSearchQueryStore((s) => s.generate);
  const removeQuery = useSearchQueryStore((s) => s.remove);
  const loadPreferences = useJobPreferencesStore((s) => s.load);
  const clearSearchError = useSearchQueryStore((s) => s.clearError);

  useJobSearchEffects({
    activeProfileId,
    wordsFilter: state.wordsFilter,
    statusFilter: state.statusFilter,
    selectedId: state.selectedId,
    requiredSkills: filters.requiredSkills,
    loadMatches: jobStore.loadMatches,
    loadQueries,
    loadPreferences,
    loadJobs: jobStore.loadJobs,
    setSelectedDetail: state.setSelectedDetail,
    setSelectedSkills: state.setSelectedSkills,
    setIndeedParked: state.setIndeedParked,
    setLinkedinParked: state.setLinkedinParked,
  });

  return {
    activeProfileId,
    filters,
    isGenerating,
    searchError,
    savedQueries,
    generateQueries,
    removeQuery,
    clearSearchError,
    ...jobStore,
  };
}
