import { create } from "zustand";
import type {
  JobPostDto,
  JobMatchDto,
  LinkedInSearchResult,
  GoogleSearchResult,
} from "../types/domain";
import { safeInvoke, invokeStrict, errMessage } from "../lib/tauriInvoke";

interface JobStoreState {
  jobs: JobPostDto[];
  matches: JobMatchDto[];
  isLoading: boolean;
  error: string | null;

  /**
   * Load job posts for the given profile. When `statusFilter` is provided
   * (and not "all") it is forwarded to `list_job_posts` as a server-side
   * filter. On backend failure safeInvoke collapses to null → empty list.
   */
  loadJobs: (profileId: string, statusFilter?: string) => Promise<void>;

  /** Load all match scores for the profile. */
  loadMatches: (profileId: string) => Promise<void>;

  /**
   * Score a single job against the active profile (optionally a specific
   * preference). Uses invokeStrict so backend errors reach the UI.
   * Returns the new JobMatchDto on success, or null on failure.
   */
  scoreJob: (
    jobId: string,
    profileId: string,
    preferenceId?: string,
  ) => Promise<JobMatchDto | null>;

  /**
   * Trigger a saved search query. Returns the number of new jobs found on
   * success, or null on failure. Requires a searchQueryId - the UI must
   * provide one from the search-query management surface (not yet built).
   */
  runSearch: (searchQueryId: string) => Promise<number | null>;

  /**
   * Scrape LinkedIn and ingest results for a profile + query combo.
   * Returns the ingest summary or null on failure.
   */
  runLinkedInSearch: (
    profileId: string,
    searchQueryId: string | null | undefined,
    keywords: string,
    location?: string | null,
    remoteOnly?: boolean,
  ) => Promise<LinkedInSearchResult | null>;

  /**
   * Live-insert a job discovered mid-search (from the `job.search.item_found`
   * event), so the Vagas list grows as scraping runs instead of only when the
   * search finishes. Dedupes by id (replace-in-place if already present).
   */
  upsertJob: (job: JobPostDto) => void;

  /** Optimistically update a job's status in the store and persist via backend. */
  setJobStatus: (jobId: string, status: string) => Promise<void>;

  /** Open a Chromium window for the user to log in to LinkedIn. Fire-and-forget. */
  loginLinkedIn: (profileId: string) => Promise<void>;

  clearError: () => void;
}

export const useJobStore = create<JobStoreState>((set) => ({
  jobs: [],
  matches: [],
  isLoading: false,
  error: null,

  loadJobs: async (profileId, statusFilter) => {
    set({ isLoading: true, error: null });
    const args: Record<string, unknown> = { profileId };
    // Only forward a concrete status string - omit key entirely for "all"
    // so the backend returns every status rather than filtering to "all".
    if (statusFilter !== undefined && statusFilter !== "all") {
      args.statusFilter = statusFilter;
    }
    const jobs = await safeInvoke<JobPostDto[]>("list_job_posts", args);
    set({ jobs: jobs ?? [], isLoading: false });
  },

  loadMatches: async (profileId) => {
    const matches = await safeInvoke<JobMatchDto[]>("list_job_matches", { profileId });
    set({ matches: matches ?? [] });
  },

  upsertJob: (job) =>
    set((state) => {
      const at = state.jobs.findIndex((j) => j.id === job.id);
      if (at === -1) return { jobs: [job, ...state.jobs] };
      const jobs = state.jobs.slice();
      jobs[at] = job;
      return { jobs };
    }),

  scoreJob: async (jobId, profileId, preferenceId) => {
    try {
      const args: Record<string, unknown> = { jobId, profileId };
      if (preferenceId !== undefined) args.preferenceId = preferenceId;
      const match = await invokeStrict<JobMatchDto>("score_job_match", args);
      // Replace any prior match for this job with the fresh one.
      set((s) => ({
        matches: [...s.matches.filter((m) => m.jobId !== jobId), match],
      }));
      return match;
    } catch (e) {
      set({ error: `Score failed: ${errMessage(e)}` });
      return null;
    }
  },

  runSearch: async (searchQueryId) => {
    try {
      const count = await invokeStrict<number>("run_search", { searchQueryId });
      return count;
    } catch (e) {
      set({ error: `Search failed: ${errMessage(e)}` });
      return null;
    }
  },

  runLinkedInSearch: async (profileId, searchQueryId, keywords, location, remoteOnly) => {
    try {
      const result = await invokeStrict<LinkedInSearchResult>("run_linkedin_search", {
        profileId,
        searchQueryId: searchQueryId ?? null,
        keywords,
        location: location ?? null,
        easyApplyOnly: true,
        remoteOnly: remoteOnly ?? false,
      });
      return result;
    } catch (e) {
      set({ error: `LinkedIn search failed: ${errMessage(e)}` });
      return null;
    }
  },

  setJobStatus: async (jobId, status) => {
    try {
      await invokeStrict<void>("update_job_status", { jobId, status });
      // Optimistic update so the list reflects the new status immediately.
      set((s) => ({
        jobs: s.jobs.map((j) =>
          j.id === jobId ? { ...j, status: status as JobPostDto["status"] } : j,
        ),
      }));
    } catch (e) {
      set({ error: `Status update failed: ${errMessage(e)}` });
    }
  },

  loginLinkedIn: async (profileId: string): Promise<void> => {
    await invokeStrict<void>("linkedin_job_login", { profileId });
  },

  clearError: () => set({ error: null }),
}));

/**
 * Scrape Google (dork search) and ingest results for a profile + query combo.
 * Throws on failure (including when Google blocks with a captcha wall) so the
 * caller can surface the message via UI state rather than the store error banner.
 */
export async function runGoogleSearch(
  profileId: string,
  searchQueryId: string,
  query: string,
  maxPages?: number,
): Promise<GoogleSearchResult> {
  return invokeStrict<GoogleSearchResult>("run_google_search", {
    profileId,
    searchQueryId,
    query,
    maxPages: maxPages ?? null,
  });
}

/**
 * Search Catho (/vagas) and ingest the offers into job_posts (dedup by URL) so
 * they appear in the normal Job Search list and get scored. `areaIds` /
 * `workModels` map to the URL's `area_id[]` / `work_model[]`; `lastDays` is
 * optional (omit for any date). Throws on failure for the caller to surface.
 */
export async function runCathoSearch(
  profileId: string,
  searchQueryId: string | null,
  query: string,
  areaIds?: number[],
  workModels?: string[],
  lastDays?: number,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_catho_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    query,
    areaIds: areaIds ?? null,
    workModels: workModels ?? null,
    lastDays: lastDays ?? null,
    maxPages: maxPages ?? null,
  });
}

/**
 * Scrape InfoJobs Brazil for `query`, ingesting under `searchQueryId` so
 * run_search() scores the posts. `location` is an optional InfoJobs `poblacion`
 * id; `workModels`/`lastDays` map to the idw/Antiguedad facets.
 */
export async function runInfojobsSearch(
  profileId: string,
  searchQueryId: string | null,
  query: string,
  location?: string,
  workModels?: string[],
  lastDays?: number,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_infojobs_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    query,
    location: location ?? null,
    workModels: workModels ?? null,
    lastDays: lastDays ?? null,
    maxPages: maxPages ?? null,
  });
}

/**
 * Scrape the Gupy portal (portal.gupy.io/job-search) for `query`, ingesting
 * under `searchQueryId` so run_search() scores the posts. `remoteOnly` maps to
 * the `workplaceTypes[]=remote` filter.
 */
export async function runGupySearch(
  profileId: string,
  searchQueryId: string | null,
  query: string,
  remoteOnly?: boolean,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_gupy_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    query,
    remoteOnly: remoteOnly ?? null,
    maxPages: maxPages ?? null,
  });
}

/**
 * Scrape Upwork (/nx/search/jobs) for `query`, ingesting under `searchQueryId`
 * so run_search() scores the posts. View-only (no apply). `sort` defaults to
 * "recency" (newest first) in the backend when omitted.
 */
export async function runUpworkSearch(
  profileId: string,
  searchQueryId: string | null,
  query: string,
  sort?: string,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_upwork_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    query,
    sort: sort ?? null,
    maxPages: maxPages ?? null,
  });
}

/**
 * Scrape 99freelas (/projects) for `query`, ingesting under `searchQueryId` so
 * run_search() scores the posts. View-only (proposals cost connections).
 */
export async function runFreelas99Search(
  profileId: string,
  searchQueryId: string | null,
  query: string,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_freelas99_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    query,
    maxPages: maxPages ?? null,
  });
}

/** Result of applying to one Catho offer. */
export interface CathoApplyResult {
  offerId?: string;
  status: string;
  reason?: string;
}

/**
 * Apply to ONE Catho offer (explicit, per-offer). Opens a visible window and
 * clicks "Quero me candidatar" — this submits the CV, so it is only ever called
 * on a deliberate user action. Throws on failure for the caller to surface.
 */
export async function cathoApply(
  profileId: string,
  offerId: string,
  applyUrl: string,
): Promise<CathoApplyResult> {
  return invokeStrict<CathoApplyResult>("catho_apply", { profileId, offerId, applyUrl });
}

/**
 * Apply to ONE InfoJobs offer (explicit, per-offer). Opens a visible window and
 * clicks "CANDIDATAR-ME" — this submits the candidacy. Reuses CathoApplyResult
 * ({ offerId, status, reason? }). Throws on failure for the caller to surface.
 */
export async function infojobsApply(
  profileId: string,
  offerId: string,
  applyUrl: string,
): Promise<CathoApplyResult> {
  return invokeStrict<CathoApplyResult>("infojobs_apply", { profileId, offerId, applyUrl });
}

/**
 * Search Indeed and ingest the cards into job_posts (dedup by URL) so they
 * appear in the normal Job Search list and get scored. Runs under the shared
 * per-profile browser. Throws on failure for the caller to surface.
 */
export async function runIndeedSearch(
  profileId: string,
  searchQueryId: string | null,
  keywords: string,
  location?: string,
  remoteOnly?: boolean,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_indeed_search", {
    profileId,
    searchQueryId: searchQueryId ?? null,
    keywords,
    location: location ?? null,
    remoteOnly: remoteOnly ?? null,
    maxPages: maxPages ?? null,
  });
}

/**
 * Begin an Indeed SmartApply. Opens the shared per-profile browser, fills the
 * multi-step form (contact + desired salary from the profile, screening answers
 * drafted via the AI bridge), then PARKS before the final submit for review.
 * Never submits — the operator confirms or rejects afterward. Throws on failure.
 */
export async function startIndeedApply(jobUrl: string, profileId: string): Promise<void> {
  return invokeStrict<void>("automation_start_indeed", { jobUrl, profileId, answers: null });
}

/**
 * Open a visible Indeed window on the login page so the user can sign in. Uses
 * the shared per-profile browser (one cookie jar), so the session persists for
 * later search/apply. Throws on failure for the caller to surface.
 */
export async function loginIndeed(profileId: string): Promise<void> {
  return invokeStrict<void>("indeed_login", { profileId });
}

/**
 * Draft a tailored application for a scored job match → returns the draft id.
 * First half of the LinkedIn Easy Apply enqueue (draft → submit → engine).
 */
export async function draftApplication(jobMatchId: string): Promise<string> {
  return invokeStrict<string>("draft_application", { jobMatchId });
}

/**
 * Queue a drafted application into the automation engine (creates the apply_job
 * task `automation_start` drains). Returns the application_run id.
 */
export async function submitApplication(applicationDraftId: string): Promise<string> {
  return invokeStrict<string>("submit_application", { applicationDraftId });
}

/** Click "Enviar sua candidatura" in the parked SmartApply popup — this submits. */
export async function confirmIndeedSubmit(): Promise<void> {
  return invokeStrict<void>("automation_confirm_indeed_submit", {});
}

/** Close the parked SmartApply popup without submitting. */
export async function rejectIndeedSubmit(): Promise<void> {
  return invokeStrict<void>("automation_reject_indeed_submit", {});
}

/**
 * Scrape LinkedIn feed posts for hiring contact emails and ingest results.
 * Throws on failure so the caller can surface the message via UI state.
 */
export async function runLinkedInPostsSearch(
  profileId: string,
  searchQueryId: string,
  keywords: string,
  maxPages?: number,
): Promise<LinkedInSearchResult> {
  return invokeStrict<LinkedInSearchResult>("run_linkedin_posts_search", {
    profileId,
    searchQueryId,
    keywords,
    maxPages: maxPages ?? null,
  });
}

/**
 * Send a job application via the Gmail backend integration.
 * Throws on failure (e.g. "Not logged into Gmail") so the caller surfaces the
 * message via UI state rather than swallowing it silently.
 */
export async function runGmailApply(
  profileId: string,
  to: string,
  subject: string,
  body: string,
  cvDocumentId?: string | null,
): Promise<void> {
  return invokeStrict<void>("gmail_send_application", {
    profileId,
    to,
    subject,
    body,
    cvDocumentId: cvDocumentId ?? null,
  });
}
