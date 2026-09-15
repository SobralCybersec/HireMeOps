import { useEffect } from "react";
import { safeInvoke } from "../../lib/tauriInvoke";
import type { JobPostDto } from "../../types/domain";
import type { FilterStatus } from "./job-search-types";

type LoadJobs = (profileId: string, statusFilter?: string, search?: string) => Promise<void>;

interface JobSearchEffectsOptions {
  activeProfileId: string | null;
  wordsFilter: string;
  statusFilter: FilterStatus;
  selectedId: string | null;
  requiredSkills: string[];
  loadMatches: (profileId: string) => Promise<void>;
  loadQueries: (profileId: string) => Promise<void>;
  loadPreferences: (profileId: string) => Promise<void>;
  loadJobs: LoadJobs;
  setSelectedDetail: (value: JobPostDto | null) => void;
  setSelectedSkills: (value: string[]) => void;
  setIndeedParked: (value: boolean) => void;
  setLinkedinParked: (value: boolean) => void;
}

export function useJobSearchEffects(options: JobSearchEffectsOptions) {
  const {
    activeProfileId,
    wordsFilter,
    statusFilter,
    selectedId,
    requiredSkills,
    loadMatches,
    loadQueries,
    loadPreferences,
    loadJobs,
    setSelectedDetail,
    setSelectedSkills,
    setIndeedParked,
    setLinkedinParked,
  } = options;

  useEffect(() => {
    if (!activeProfileId) return;
    void loadMatches(activeProfileId);
    void loadQueries(activeProfileId);
    void loadPreferences(activeProfileId);
  }, [activeProfileId, loadMatches, loadQueries, loadPreferences]);

  useEffect(() => {
    if (!activeProfileId) return;
    const term = wordsFilter.trim();
    const status = statusFilter === "all" ? undefined : statusFilter;
    if (term.length === 1) {
      void loadJobs(activeProfileId, status, undefined);
      return;
    }
    const timer = window.setTimeout(
      () => void loadJobs(activeProfileId, status, term.length >= 2 ? term : undefined),
      term.length >= 2 ? 200 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [activeProfileId, loadJobs, statusFilter, wordsFilter]);

  useEffect(() => {
    if (!activeProfileId || !selectedId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedDetail(null);
    void safeInvoke<JobPostDto>("get_job_post", {
      profileId: activeProfileId,
      jobId: selectedId,
    }).then((detail) => {
      if (!cancelled) setSelectedDetail(detail);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, selectedId, setSelectedDetail]);

  useEffect(() => {
    setSelectedSkills(requiredSkills);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredSkills.join("|")]);

  useEffect(() => {
    setIndeedParked(false);
    setLinkedinParked(false);
  }, [selectedId, setIndeedParked, setLinkedinParked]);
}
