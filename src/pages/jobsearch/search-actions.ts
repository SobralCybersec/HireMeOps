import type {
  JobFilters,
  JobMatchDto,
  JobPostDto,
  JobStatus,
  SearchQueryInput,
} from "../../types/domain";
import { invokeStrict, errMessage } from "../../lib/tauriInvoke";
import { useAutomationStore } from "../../stores/useAutomationStore";
import { draftApplication, submitApplication } from "../../stores/useJobStore";
import { useSearchQueryStore } from "../../stores/useSearchQueryStore";
import { runPlatformSearch, type SearchPlatform } from "./search-runners";

export function createSearchInput(options: {
  profileId: string;
  filters: JobFilters;
  selectedSkills: string[];
}): SearchQueryInput {
  const { profileId, filters, selectedSkills } = options;
  return {
    profileId,
    titles: filters.targetRoles,
    requiredSkills: selectedSkills.length > 0 ? selectedSkills : filters.requiredSkills,
    location: filters.locations[0] ?? null,
    remoteMode: filters.remoteModes[0]?.toLowerCase() ?? null,
    seniority: filters.seniority,
  };
}

type SearchRunner = (
  profileId: string,
  queryId: string,
  keywords: string,
  location?: string,
  remoteOnly?: boolean,
) => Promise<{ ingested: number } | null>;

export async function runSearchAction(options: {
  profileId: string | null;
  platform: SearchPlatform;
  filters: JobFilters;
  selectedSkills: string[];
  runSearch: (queryId: string) => Promise<number | null>;
  loadJobs: (profileId: string) => Promise<void>;
  loadMatches: (profileId: string) => Promise<void>;
  runLinkedIn: SearchRunner;
  setMessage: (message: string | null) => void;
  generateQueries: (input: SearchQueryInput) => Promise<string[] | null>;
}) {
  const {
    profileId,
    platform,
    filters,
    selectedSkills,
    runSearch,
    loadJobs,
    loadMatches,
    runLinkedIn,
    setMessage,
    generateQueries,
  } = options;
  if (profileId === null) return;
  setMessage(null);
  const input = createSearchInput({ profileId, filters, selectedSkills });
  const ids = await generateQueries(input);
  if (ids === null) return;
  await runPlatformSearch(platform, {
    profileId,
    filters,
    selectedSkills,
    available: useSearchQueryStore.getState().queries,
    setMessage,
    runSearch,
    loadJobs,
    loadMatches,
    runLinkedIn,
  });
}

export async function runAllSearches(options: {
  profileId: string | null;
  runningAll: boolean;
  setRunning: (value: boolean) => void;
  setMessage: (message: string | null) => void;
  runSearch: (platform: SearchPlatform) => Promise<void>;
}) {
  const { profileId, runningAll, setRunning, setMessage, runSearch } = options;
  if (profileId === null || runningAll) return;
  setRunning(true);
  const platforms: SearchPlatform[] = [
    "linkedin",
    "google",
    "posts",
    "catho",
    "infojobs",
    "gupy",
    "indeed",
    "upwork",
    "99freelas",
    "programathor",
    "geekhunter",
  ];
  for (const [index, platform] of platforms.entries()) {
    setMessage("Running searches… (" + index + "/" + platforms.length + ") - " + platform);
    try {
      await runSearch(platform);
    } catch {
      // One source failing should not abort remaining sources.
    }
  }
  setMessage("All " + platforms.length + " searches finished.");
  setRunning(false);
}

export async function queueAllJobs(options: {
  profileId: string | null;
  filtered: JobPostDto[];
  setMessage: (message: string | null) => void;
  setJobStatus: (jobId: string, status: JobStatus) => Promise<void>;
  loadJobs: (profileId: string) => Promise<void>;
}) {
  const { profileId, filtered, setMessage, setJobStatus, loadJobs } = options;
  if (profileId === null) return;
  const queueable = new Set<JobStatus>(["discovered", "matched", "needs_review", "saved"]);
  const jobs = filtered.filter(
    (job) => job.status !== "skipped_duplicate_url" && queueable.has(job.status),
  );
  if (jobs.length === 0) {
    setMessage("No new jobs to queue.");
    return;
  }
  setMessage("Queuing " + jobs.length + " job" + (jobs.length === 1 ? "" : "s") + "…");
  for (const job of jobs) await setJobStatus(job.id, "queued");
  await loadJobs(profileId);
  setMessage("Queued " + jobs.length + " job" + (jobs.length === 1 ? "" : "s") + ".");
}

export async function deleteOldScans(options: {
  profileId: string | null;
  setMessage: (message: string | null) => void;
  loadJobs: (profileId: string) => Promise<void>;
  loadMatches: (profileId: string) => Promise<void>;
}) {
  const { profileId, setMessage, loadJobs, loadMatches } = options;
  if (profileId === null) return;
  if (!window.confirm("Delete ALL scan results not yet applied to? This cannot be undone.")) return;
  try {
    const deleted = await invokeStrict<number>("delete_old_scans", { profileId, daysOld: 0 });
    await loadJobs(profileId);
    await loadMatches(profileId);
    setMessage("Deleted " + deleted + " stale job" + (deleted === 1 ? "" : "s") + ".");
  } catch (error) {
    setMessage("Delete failed: " + errMessage(error));
  }
}

export async function applyLinkedInJob(options: {
  selected: JobPostDto | null;
  matches: JobMatchDto[];
  profileId: string | null;
  isApplying: boolean;
  setApplying: (value: boolean) => void;
  setMessage: (message: string | null) => void;
  setParked: (value: boolean) => void;
  loadJobs: (profileId: string) => Promise<void>;
  loadMatches: (profileId: string) => Promise<void>;
}) {
  const {
    selected,
    matches,
    profileId,
    isApplying,
    setApplying,
    setMessage,
    setParked,
    loadJobs,
    loadMatches,
  } = options;
  if (selected === null || profileId === null || isApplying) return;
  const matchId = matches.find((match) => match.jobId === selected.id)?.id;
  if (matchId === undefined) {
    setMessage("Score this job first. The application is drafted from its match.");
    return;
  }
  setApplying(true);
  try {
    const draftId = await draftApplication(matchId);
    await submitApplication(draftId);
    await useAutomationStore.getState().start();
    await waitForLinkedInApply({ title: selected.title, setMessage, setParked });
    await loadJobs(profileId);
    await loadMatches(profileId);
  } catch (error) {
    setMessage(errMessage(error));
  } finally {
    setApplying(false);
  }
}

async function waitForLinkedInApply(options: {
  title: string;
  setMessage: (message: string | null) => void;
  setParked: (value: boolean) => void;
}) {
  const { title, setMessage, setParked } = options;
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const state = useAutomationStore.getState().state;
    if (state === "NeedsReview") {
      setParked(true);
      setMessage(
        'Easy Apply form filled & AI-answered for "' +
          title +
          '". Review it in the window, then submit or discard.',
      );
      return;
    }
    if (["Completed", "Failed", "Stopped"].includes(state)) {
      setMessage("LinkedIn apply: " + state.toLowerCase() + " (check Applications if unexpected).");
      return;
    }
    if (Date.now() > deadline) {
      setMessage("LinkedIn apply timed out. Check the Applications queue.");
      return;
    }
  }
}
