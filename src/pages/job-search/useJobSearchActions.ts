import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { runAutoApply } from "./auto-apply";
import { buildLinkedInCloudRunInput } from "./cloud-run-input";
import {
  applyLinkedInJob,
  deleteOldScans,
  queueAllJobs,
  runAllSearches,
  runSearchAction,
} from "./search-actions";
import { errMessage, invokeStrict } from "../../lib/tauri/tauriInvoke";
import type { SearchPlatform } from "./search-runners";
import type { CloudRunReceipt } from "../../types/domain";
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
    savedQueries,
  } = data;
  const { selectedSkills, runningAll, setRunningAll, setSearchMsg } = state;
  const [cloudRunning, setCloudRunning] = useState(false);
  const linkedInQuery = savedQueries.find(
    (query) =>
      query.profileId === activeProfileId && query.platform === "linkedin" && query.enabled,
  );
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
  const handleRunCloud = async () => {
    if (!activeProfileId || !linkedInQuery || cloudRunning) return;
    setCloudRunning(true);
    setSearchMsg("Starting cloud LinkedIn search…");
    try {
      const receipt = await invokeStrict<CloudRunReceipt>("trigger_cloud_run", {
        input: buildLinkedInCloudRunInput(activeProfileId, linkedInQuery, filters),
      });
      if (receipt.profileId !== activeProfileId) throw new Error("Cloud run profile mismatch.");
      setSearchMsg(
        `Cloud run started · profile ${receipt.profileId} · revision ${receipt.sessionRevision} · search ${receipt.searchRunId}`,
      );
    } catch (error) {
      setSearchMsg(`Cloud run failed: ${errMessage(error)}`);
    } finally {
      setCloudRunning(false);
    }
  };
  return {
    handleRunSearch,
    handleRunAll,
    handleRunCloud,
    cloudRunning,
    cloudReady: activeProfileId !== null && linkedInQuery !== undefined,
  };
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
