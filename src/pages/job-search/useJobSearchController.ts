import { useJobSearchState } from "./useJobSearchState";
import { useJobSearchData } from "./useJobSearchData";
import { useJobSearchDerived } from "./useJobSearchDerived";
import { createJobSearchViewModel } from "./job-search-view-model";
import { useSearchActions } from "./useJobSearchActions";

export function useJobSearchController() {
  const state = useJobSearchState();
  const data = useJobSearchData(state);
  const {
    statusFilter,
    workModeFilter,
    platformFilter,
    locationFilter,
    wordsFilter,
    minScore,
    selectedId,
    selectedDetail,
    hideDuplicates,
    contactFilter,
  } = state;
  const {
    activeProfileId,
    filters,
    isGenerating,
    searchError,
    jobs,
    matches,
    isLoading,
    error,
    clearSearchError,
    clearError,
  } = data;
  const derived = useJobSearchDerived({
    jobs,
    matches,
    selectedId,
    selectedDetail,
    hideDuplicates,
    statusFilter,
    platformFilter,
    workModeFilter,
    wordsFilter,
    locationFilter,
    contactFilter,
    minScore,
  });
  const actions = useSearchActions({ state, data, derived });
  const canSearch =
    activeProfileId !== null && !isLoading && !isGenerating && filters.targetRoles.length > 0;
  const searchDisabledTitle =
    activeProfileId === null
      ? "Select a profile first"
      : filters.targetRoles.length === 0
        ? "Set target roles in Job Preferences first"
        : undefined;
  const bannerError = error ?? searchError;
  const dismissError = () => {
    clearError();
    clearSearchError();
  };
  return createJobSearchViewModel({
    state,
    data,
    derived,
    actions,
    canSearch,
    searchDisabledTitle,
    bannerError,
    dismissError,
  });
}
