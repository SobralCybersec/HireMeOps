import type { JobSearchPanesModel, JobSearchViewModel, SearchFiltersModel } from "../JobSearch";
import type { JobSearchState } from "./useJobSearchState";
import type { useJobSearchData } from "./useJobSearchData";
import type { useJobSearchDerived } from "./useJobSearchDerived";
import type { useSearchActions } from "./useJobSearchActions";

type Data = ReturnType<typeof useJobSearchData>;
type Derived = ReturnType<typeof useJobSearchDerived>;
type Actions = ReturnType<typeof useSearchActions>;

type Context = {
  state: JobSearchState;
  data: Data;
  derived: Derived;
  actions: Actions;
};

function createSearchFiltersModel({ state, data, derived, actions }: Context): SearchFiltersModel {
  return {
    mobilePane: state.mobilePane,
    platformFilter: state.platformFilter,
    platformOptions: derived.platformOptions,
    wordsFilter: state.wordsFilter,
    locationFilter: state.locationFilter,
    statusFilter: state.statusFilter,
    workModeFilter: state.workModeFilter,
    minScore: state.minScore,
    contactFilter: state.contactFilter,
    requiredSkills: data.filters.requiredSkills,
    selectedSkills: state.selectedSkills,
    savedQueries: data.savedQueries,
    removingId: state.removingId,
    onPlatformChange: state.setPlatformFilter,
    onWordsChange: state.setWordsFilter,
    onLocationChange: state.setLocationFilter,
    onStatusChange: state.setStatusFilter,
    onWorkModeChange: state.setWorkModeFilter,
    onMinScoreChange: state.setMinScore,
    onContactChange: state.setContactFilter,
    onToggleSkill: actions.toggleSkill,
    onRemoveQuery: (id) => void actions.handleRemoveQuery(id),
  };
}

function createSearchResultsModel({ state, data, derived, actions }: Context) {
  return {
    mobilePane: state.mobilePane,
    filtered: derived.filtered,
    activeProfileId: data.activeProfileId,
    isLoading: data.isLoading,
    selectedId: state.selectedId,
    matchScoreFor: actions.matchScoreFor,
    selectJob: actions.selectJob,
    nextCursor: data.nextCursor,
    wordsFilter: state.wordsFilter,
    loadMore: actions.loadMore,
  };
}

function createSearchDetailModel({ state, data, derived, actions }: Context) {
  return {
    mobilePane: state.mobilePane,
    selected: derived.selected,
    selectedMatchScore: derived.selectedMatchScore,
    selectedMatch: derived.selectedMatch,
    selectedMatchId: derived.selectedMatchId,
    activeProfileId: data.activeProfileId,
    isLoading: data.isLoading,
    isApplying: state.isApplying,
    indeedParked: state.indeedParked,
    linkedinParked: state.linkedinParked,
    setIsApplying: state.setIsApplying,
    setSearchMsg: state.setSearchMsg,
    setIndeedParked: state.setIndeedParked,
    setLinkedinParked: state.setLinkedinParked,
    setDraftModalOpen: state.setDraftModalOpen,
    handleQueueDetail: actions.handleQueueDetail,
    handleOpenSelected: actions.handleOpenSelected,
    handleApplyLinkedIn: actions.handleApplyLinkedIn,
    handleSkipSelected: actions.handleSkipSelected,
    loadJobs: data.loadJobs,
  };
}

function createSearchPanesModel(context: Context): JobSearchPanesModel {
  return {
    showPreferences: context.state.showPreferences,
    filters: createSearchFiltersModel(context),
    results: createSearchResultsModel(context),
    detail: createSearchDetailModel(context),
  };
}

type ViewContext = Context & {
  canSearch: boolean;
  searchDisabledTitle: string | undefined;
  bannerError: string | null;
  dismissError: () => void;
};

export function createJobSearchViewModel(context: ViewContext): JobSearchViewModel {
  const {
    state,
    data,
    derived,
    actions,
    canSearch,
    searchDisabledTitle,
    bannerError,
    dismissError,
  } = context;
  return {
    activeProfileId: data.activeProfileId,
    filtered: derived.filtered,
    jobs: data.jobs,
    matches: data.matches,
    queuedCount: derived.queuedCount,
    showPreferences: state.showPreferences,
    bannerError,
    dismissError,
    canSearch,
    runningAll: state.runningAll,
    isGenerating: data.isGenerating,
    searchDisabledTitle,
    handleRunAll: actions.handleRunAll,
    showManual: state.showManual,
    toggleManual: () => state.setShowManual((value) => !value),
    handleRunSearch: actions.handleRunSearch,
    togglePreferences: () => state.setShowPreferences((value) => !value),
    handleDeleteOldScans: actions.handleDeleteOldScans,
    selectedId: state.selectedId,
    isLoading: data.isLoading,
    handleScoreSelected: actions.handleScoreSelected,
    handleQueueSelected: actions.handleQueueSelected,
    handleQueueAll: actions.handleQueueAll,
    handleSkipSelected: actions.handleSkipSelected,
    isApplying: state.isApplying,
    handleAutoApply: actions.handleAutoApply,
    hideDuplicates: state.hideDuplicates,
    hiddenDupeCount: derived.hiddenDupeCount,
    setHideDuplicates: state.setHideDuplicates,
    searchMsg: state.searchMsg,
    mobilePane: state.mobilePane,
    setMobilePane: state.setMobilePane,
    panesModel: createSearchPanesModel({ state, data, derived, actions }),
    selectedMatchId: derived.selectedMatchId,
    draftModalOpen: state.draftModalOpen,
    setDraftModalOpen: state.setDraftModalOpen,
  };
}
