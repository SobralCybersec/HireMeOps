import { openUrl } from "@tauri-apps/plugin-opener";
import { runAutoApply } from "./auto-apply";
import {
  applyLinkedInJob,
  deleteOldScans,
  queueAllJobs,
  runAllSearches,
  runSearchAction,
} from "./search-actions";
import type { SearchPlatform } from "./search-runners";
import type { JobSearchState } from "./useJobSearchState";
import type { useJobSearchData } from "./useJobSearchData";
import type { useJobSearchDerived } from "./useJobSearchDerived";

type Data = ReturnType<typeof useJobSearchData>;
type Derived = ReturnType<typeof useJobSearchDerived>;

type Context = {
  state: JobSearchState;
  data: Data;
  derived: Derived;
};

export function useSearchRunActions({ state, data }: Omit<Context, "derived">) {
  const {
    activeProfileId,
    filters,
    generateQueries,
    loadJobs,
    loadMatches,
    runSearch,
    runLinkedInSearch,
  } = data;
  const { selectedSkills, runningAll, setRunningAll, setSearchMsg } = state;
  const handleRunSearch = (platform: SearchPlatform) =>
    runSearchAction({
      profileId: activeProfileId,
      platform,
      filters,
      selectedSkills,
      runSearch,
      loadJobs,
      loadMatches,
      runLinkedIn: runLinkedInSearch,
      setMessage: setSearchMsg,
      generateQueries,
    });
  const handleRunAll = () =>
    runAllSearches({
      profileId: activeProfileId,
      runningAll,
      setRunning: setRunningAll,
      setMessage: setSearchMsg,
      runSearch: handleRunSearch,
    });
  return { handleRunSearch, handleRunAll };
}

export function useSearchSelectionActions({ state, data, derived }: Context) {
  const { selectedId, setSelectedId, setMobilePane, setSearchMsg } = state;
  const { activeProfileId, loadJobs, scoreJob, setJobStatus } = data;
  const { selected, filtered } = derived;
  const toggleSkill = (skill: string) =>
    state.setSelectedSkills((previous) =>
      previous.includes(skill)
        ? previous.filter((current) => current !== skill)
        : [...previous, skill],
    );
  const selectJob = (id: string) => {
    setSelectedId(id);
    setMobilePane("detail");
  };
  const handleScoreSelected = async () => {
    if (selectedId === null || activeProfileId === null) return;
    await scoreJob(selectedId, activeProfileId);
  };
  const handleQueueSelected = async () => {
    if (selectedId === null) return;
    await setJobStatus(selectedId, "queued");
  };
  const handleQueueDetail = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "queued");
  };
  const handleQueueAll = () =>
    queueAllJobs({
      profileId: activeProfileId,
      filtered,
      setMessage: setSearchMsg,
      setJobStatus,
      loadJobs,
    });
  const handleSkipSelected = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "ignored");
  };
  return {
    toggleSkill,
    selectJob,
    handleScoreSelected,
    handleQueueSelected,
    handleQueueDetail,
    handleQueueAll,
    handleSkipSelected,
  };
}

export function useSearchNavigationActions({ state, data, derived }: Context) {
  const { setSearchMsg, setRemovingId } = state;
  const { activeProfileId, loadJobs, loadMoreJobs, loadMatches, removeQuery } = data;
  const { selected, scoreByJobId } = derived;
  const handleOpenSelected = async () => {
    if (selected === null) return;
    try {
      await openUrl(selected.url);
    } catch (error) {
      setSearchMsg(`Could not open job URL: ${String(error)}`);
    }
  };
  const handleRemoveQuery = async (id: string) => {
    setRemovingId(id);
    await removeQuery(id);
    setRemovingId(null);
  };
  const handleDeleteOldScans = () =>
    deleteOldScans({
      profileId: activeProfileId,
      setMessage: setSearchMsg,
      loadJobs,
      loadMatches,
    });
  const loadMore = () => {
    if (activeProfileId === null) return;
    void loadMoreJobs(
      activeProfileId,
      state.statusFilter === "all" ? undefined : state.statusFilter,
    );
  };
  const matchScoreFor = (jobId: string): number | null => scoreByJobId.get(jobId) ?? null;
  return {
    handleOpenSelected,
    handleRemoveQuery,
    handleDeleteOldScans,
    loadMore,
    matchScoreFor,
  };
}

export function useSearchJobActions(context: Context) {
  return {
    ...useSearchSelectionActions(context),
    ...useSearchNavigationActions(context),
  };
}

export function useSearchApplyActions({ state, data, derived }: Context) {
  const { activeProfileId, jobs, matches, loadJobs, loadMatches, setJobStatus } = data;
  const { isApplying, setIsApplying, setSearchMsg, setLinkedinParked } = state;
  const { selected } = derived;
  const handleAutoApply = () => {
    if (activeProfileId === null) return;
    void runAutoApply({
      profileId: activeProfileId,
      jobs,
      matches,
      isApplying,
      setMessage: setSearchMsg,
      setApplying: setIsApplying,
      setJobStatus,
      loadJobs,
      loadMatches,
    });
  };
  const handleApplyLinkedIn = () =>
    applyLinkedInJob({
      selected,
      matches,
      profileId: activeProfileId,
      isApplying,
      setApplying: setIsApplying,
      setMessage: setSearchMsg,
      setParked: setLinkedinParked,
      loadJobs,
      loadMatches,
    });
  return { handleAutoApply, handleApplyLinkedIn };
}

export function useSearchActions(context: Context) {
  return {
    ...useSearchRunActions(context),
    ...useSearchJobActions(context),
    ...useSearchApplyActions(context),
  };
}
