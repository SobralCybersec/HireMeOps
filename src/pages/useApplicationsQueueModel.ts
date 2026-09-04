import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ApplicationStatus, AutomationState, JobStatus } from "../types/domain";
import { useJobStore } from "../stores/useJobStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useAnime } from "../lib/useAnime";
import { animate, stagger } from "animejs";
import {
  FILTERS,
  type ApplicationRow,
  type FilterKey,
  buildColumns,
} from "./ApplicationsQueueModel";

const IDLE_STATES: AutomationState[] = [
  "Queued",
  "Stopped",
  "Failed",
  "Completed",
  "PausedByUser",
  "RetryScheduled",
  "SkippedDuplicateUrl",
];

function toAppStatus(status: JobStatus): ApplicationStatus | null {
  const map: Partial<Record<JobStatus, ApplicationStatus>> = {
    queued: "queued",
    needs_review: "needs_review",
    applied: "submitted",
    failed: "failed",
    skipped_duplicate_url: "skipped_duplicate",
  };
  return map[status] ?? null;
}

function useAutomationQueue() {
  const activeProfileId = useProfileStore((state) => state.activeProfileId);
  const autoState = useAutomationStore((state) => state.state);
  const autoDetail = useAutomationStore((state) => state.detail);
  const autoError = useAutomationStore((state) => state.error);
  const start = useAutomationStore((state) => state.start);
  const pause = useAutomationStore((state) => state.pause);
  const resume = useAutomationStore((state) => state.resume);
  const stop = useAutomationStore((state) => state.stop);
  const confirmSubmit = useAutomationStore((state) => state.confirmSubmit);
  const rejectSubmit = useAutomationStore((state) => state.rejectSubmit);
  const clearError = useAutomationStore((state) => state.clearError);
  const loadJobs = useJobStore((state) => state.loadJobs);
  const automationRef = useRef<HTMLDivElement>(null);
  const isIdle = IDLE_STATES.includes(autoState);
  const isPaused = autoState === "PausedByUser";
  const isRunning = !isIdle && !isPaused;
  const needsReview = autoState === "NeedsReview";
  const refreshRows = useCallback(() => {
    if (activeProfileId) void loadJobs(activeProfileId);
  }, [activeProfileId, loadJobs]);
  const handleConfirm = useCallback(async () => {
    await confirmSubmit();
    refreshRows();
  }, [confirmSubmit, refreshRows]);
  const handleDiscard = useCallback(async () => {
    await rejectSubmit();
    refreshRows();
  }, [rejectSubmit, refreshRows]);
  return {
    activeProfileId,
    autoState,
    autoDetail,
    autoError,
    start,
    pause,
    resume,
    stop,
    clearError,
    automationRef,
    isIdle,
    isPaused,
    isRunning,
    needsReview,
    handleConfirm,
    handleDiscard,
  };
}

function useQueueData(
  activeProfileId: string | null,
  activeFilter: FilterKey,
  automationRef: RefObject<HTMLDivElement | null>,
) {
  const jobs = useJobStore((state) => state.jobs);
  const matches = useJobStore((state) => state.matches);
  const isLoading = useJobStore((state) => state.isLoading);
  const loadJobs = useJobStore((state) => state.loadJobs);
  const loadMatches = useJobStore((state) => state.loadMatches);
  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadMatches(activeProfileId);
  }, [activeProfileId, loadJobs, loadMatches]);
  const matchByJobId = useMemo(
    () => new Map(matches.map((match) => [match.jobId, match] as const)),
    [matches],
  );
  const allRows = useMemo<ApplicationRow[]>(
    () =>
      jobs.flatMap((job) => {
        const status = toAppStatus(job.status);
        if (!status) return [];
        const match = matchByJobId.get(job.id);
        return [
          {
            id: job.id,
            jobTitle: job.title,
            company: job.company,
            platform: job.platform,
            status,
            retryAttemptCount: 0,
            url: job.url,
            matchScore: match ? Number(match.score) : null,
          },
        ];
      }),
    [jobs, matchByJobId],
  );
  const rows = useMemo(
    () => (activeFilter === "all" ? allRows : allRows.filter((row) => row.status === activeFilter)),
    [allRows, activeFilter],
  );
  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<FilterKey, number>>(
        (result, filter) => {
          result[filter.key] =
            filter.key === "all"
              ? allRows.length
              : allRows.filter((row) => row.status === filter.key).length;
          return result;
        },
        {} as Record<FilterKey, number>,
      ),
    [allRows],
  );
  const tableRef = useRef<HTMLDivElement>(null);
  const handleReview = useCallback(() => {
    automationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [automationRef]);
  const columns = useMemo(() => buildColumns(handleReview), [handleReview]);
  useAnime(
    tableRef,
    () =>
      animate("tbody tr", {
        opacity: [0, 1],
        translateY: [4, 0],
        delay: stagger(30, { from: "first" }),
        duration: 250,
        ease: "outExpo",
      }),
    [activeFilter, rows.length],
  );
  return {
    rows,
    counts,
    columns,
    tableRef,
    isLoading,
    totalRows: allRows.length,
    emptyBody:
      activeProfileId === null
        ? "Select a profile to see your applications."
        : "Run Job Search and start automation to begin applying.",
  };
}

export function useApplicationsQueueModel(activeFilter: FilterKey) {
  const automation = useAutomationQueue();
  const data = useQueueData(automation.activeProfileId, activeFilter, automation.automationRef);
  return { ...automation, ...data };
}
