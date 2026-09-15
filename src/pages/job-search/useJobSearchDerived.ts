import { useMemo } from "react";
import type { JobMatchDto, JobPostDto } from "../../types/domain";
import { matchesJobFilter, type JobFilterOptions } from "./job-search-filters";
import type { ContactFilter, FilterStatus, WorkModeFilter } from "./job-search-types";

interface JobSearchDerivedOptions {
  jobs: JobPostDto[];
  matches: JobMatchDto[];
  selectedId: string | null;
  selectedDetail: JobPostDto | null;
  hideDuplicates: boolean;
  statusFilter: FilterStatus;
  platformFilter: string;
  workModeFilter: WorkModeFilter;
  wordsFilter: string;
  locationFilter: string;
  contactFilter: ContactFilter;
  minScore: number | "";
}

function useScoreIndex(matches: JobMatchDto[]) {
  return useMemo(() => {
    const scores = new Map<string, number>();
    for (const match of matches) scores.set(match.jobId, Math.round(match.score));
    return scores;
  }, [matches]);
}

function usePlatformOptions(jobs: JobPostDto[]) {
  return useMemo(() => {
    const present = [...new Set(jobs.map((job) => job.platform).filter(Boolean))].sort();
    return [
      { value: "All", label: "All" },
      ...present.map((platform) => ({
        value: platform,
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
      })),
    ];
  }, [jobs]);
}

function useFilteredJobs(options: JobFilterOptions, jobs: JobPostDto[]) {
  return useMemo(() => jobs.filter((job) => matchesJobFilter(job, options)), [jobs, options]);
}

function selectedJobData(
  jobs: JobPostDto[],
  matches: JobMatchDto[],
  selectedId: string | null,
  selectedDetail: JobPostDto | null,
) {
  const selectedRow = jobs.find((job) => job.id === selectedId) ?? null;
  const selected = selectedDetail?.id === selectedId ? selectedDetail : selectedRow;
  const selectedMatch =
    selected === null ? null : (matches.find((match) => match.jobId === selected.id) ?? null);
  return { selected, selectedMatch };
}

export function useJobSearchDerived(options: JobSearchDerivedOptions) {
  const {
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
  } = options;
  const scoreByJobId = useScoreIndex(matches);
  const platformOptions = usePlatformOptions(jobs);
  const filterOptions: JobFilterOptions = useMemo(
    () => ({
      hideDuplicates,
      statusFilter,
      platformFilter,
      workModeFilter,
      wordsFilter,
      locationFilter,
      contactFilter,
      minScore,
      scoreByJobId,
    }),
    [
      hideDuplicates,
      statusFilter,
      platformFilter,
      workModeFilter,
      wordsFilter,
      locationFilter,
      contactFilter,
      minScore,
      scoreByJobId,
    ],
  );
  const filtered = useFilteredJobs(filterOptions, jobs);
  const { selected, selectedMatch } = selectedJobData(jobs, matches, selectedId, selectedDetail);

  return {
    scoreByJobId,
    platformOptions,
    filtered,
    hiddenDupeCount: hideDuplicates
      ? jobs.filter((job) => job.status === "skipped_duplicate_url").length
      : 0,
    queuedCount: jobs.filter((job) => job.status === "queued").length,
    selected,
    selectedMatch,
    selectedMatchScore: selected === null ? null : (scoreByJobId.get(selected.id) ?? null),
    selectedMatchId: selectedMatch?.id ?? null,
  };
}
