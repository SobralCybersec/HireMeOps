// Minimal domain DTOs for Phase 1 (foundation shell only). These intentionally
// stay small - real fields will be expanded once each page grows real logic.

export interface Profile {
  id: string;
  name: string;
  isActive: boolean;
}

/** Result of the `docker_status` command — environment check for the optional
 *  containerized worker runtime. Mirrors the Rust `DockerStatus` (camelCase). */
export interface DockerStatus {
  installed: boolean;
  daemonRunning: boolean;
  serverVersion: string | null;
  imageBuilt: boolean;
  optIn: boolean;
  summary: string;
}

export interface CvDocument {
  id: string;
  profileId: string;
  fileName: string;
  fileType: "pdf" | "docx";
  isActive: boolean;
  lastAnalysisScore: number | null;
}

export type JobStatus =
  | "discovered"
  | "matched"
  | "rejected"
  | "queued"
  | "applied"
  | "failed"
  | "needs_review"
  | "saved"
  | "ignored"
  | "skipped_duplicate_url";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  platform: string;
  status: JobStatus;
  matchScore: number | null;
}

export type ApplicationStatus =
  "queued" | "needs_review" | "submitted" | "failed" | "skipped_duplicate";

export interface Application {
  id: string;
  jobId: string;
  profileId: string;
  status: ApplicationStatus;
  retryAttemptCount: number;
}

// Mirrors the automation state machine from the frontend spec.
export type AutomationState =
  | "Queued"
  | "PreparingBrowser"
  | "CheckingSession"
  | "Searching"
  | "ExtractingJob"
  | "ScoringJob"
  | "SelectingCV"
  | "GeneratingAnswers"
  | "FillingForm"
  | "Submitting"
  | "VerifyingSubmission"
  | "Completed"
  | "NeedsReview"
  | "PausedForCaptcha"
  | "PausedByUser"
  | "SkippedDuplicateUrl"
  | "RetryScheduled"
  | "Failed"
  | "Stopped";

export interface JobFilters {
  targetRoles: string[];
  seniority: string[];
  locations: string[];
  remoteModes: string[];
  minSalary: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  excludedKeywords: string[];
  blockedCompanies: string[];
}

// Full DTO returned by `list_job_preferences`. The array/set columns are stored
// as JSON strings in SQLite (`*Json`), so callers parse them into string[].
// Backend serialises camelCase (see `JobPreferenceDto` in commands/jobs.rs).
export interface JobPreferenceDto {
  id: string;
  profileId: string;
  name: string;
  targetRolesJson: string;
  seniorityJson: string | null;
  locationsJson: string | null;
  remoteModesJson: string | null;
  minSalary: number | null;
  salaryCurrency: string | null;
  requiredSkillsJson: string | null;
  preferredSkillsJson: string | null;
  excludedKeywordsJson: string | null;
  blockedCompaniesJson: string | null;
  autoApplyEnabled: boolean;
  autoSubmitEnabled: boolean;
  autoSubmitMinScore: number;
  needsReviewConfidenceThreshold: number;
  retryFailedEnabled: boolean;
  retryLimit: number;
  dailyApplicationLimit: number | null;
  dailyConnectionLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

// Argument shape for `create_job_preference` (passed as `{ input }`). Optional
// fields fall back to backend defaults (auto-submit/retry rules). Mirrors the
// `CreateJobPreferenceInput` struct (camelCase) in commands/jobs.rs.
export interface CreateJobPreferenceInput {
  profileId: string;
  name: string;
  targetRolesJson: string;
  seniorityJson?: string | null;
  locationsJson?: string | null;
  remoteModesJson?: string | null;
  minSalary?: number | null;
  salaryCurrency?: string | null;
  requiredSkillsJson?: string | null;
  preferredSkillsJson?: string | null;
  excludedKeywordsJson?: string | null;
  blockedCompaniesJson?: string | null;
  autoApplyEnabled?: boolean;
  autoSubmitEnabled?: boolean;
  autoSubmitMinScore?: number;
  needsReviewConfidenceThreshold?: number;
  retryFailedEnabled?: boolean;
  retryLimit?: number;
  dailyApplicationLimit?: number | null;
  dailyConnectionLimit?: number | null;
}

// Full DTO returned by `list_job_posts`. Fields serialized camelCase by backend.
export interface JobPostDto {
  id: string;
  profileId: string;
  platform: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  remoteMode: string | null;
  summary: string | null;
  seniority: string | null;
  employmentType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  postedAt: string | null;
  discoveredAt: string;
  status: JobStatus;
  searchQueryId: string | null;
  discoverySource: string | null;
  description?: string | null;
  contactEmail?: string | null;
}

// Full DTO returned by `list_job_matches` / `score_job_match`.
export interface JobMatchDto {
  id: string;
  jobId: string;
  profileId: string;
  preferenceId: string | null;
  score: number;
  roleScore: number;
  skillScore: number;
  seniorityScore: number;
  locationScore: number;
  salaryScore: number;
  matchedSkillsJson: string;
  missingSkillsJson: string;
  riskFlagsJson: string;
  recommendation: string;
  explanation: string | null;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string;
}

// Full DTO returned by `list_search_queries` / `generate_search_queries`.
export interface SearchQueryDto {
  id: string;
  profileId: string;
  preferenceId: string | null;
  platform: string;
  query: string;
  queryType: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

// Result returned by `run_linkedin_search` after scrape+ingest.
export interface LinkedInSearchResult {
  ingested: number;
  skippedDuplicates: number;
  hasNextPage: boolean;
  pagesScraped: number;
}

// Result returned by `run_google_search` after scrape+ingest.
export interface GoogleSearchResult {
  ingested: number;
  skippedDuplicates: number;
  pagesScraped: number;
  blocked: boolean;
}

// Input for `generate_search_queries`. Backend deserializes camelCase.
export interface SearchQueryInput {
  profileId: string;
  preferenceId?: string | null;
  titles: string[];
  requiredSkills: string[];
  location?: string | null;
  remoteMode?: string | null;
  seniority: string[];
}

// ── Profile Variants (role-targeted CV specializations) ──────────────────
// All fields camelCase: backend DTOs derive serde(rename_all = "camelCase").

export interface ContactInfo {
  name: string;
  location: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}

export interface CvSkillGroup {
  category: string;
  skills: string;
}

export interface CvExperienceEntry {
  title: string;
  organization: string;
  location: string;
  dates: string;
  bullets: string[];
}

export interface CvEducationEntry {
  degree: string;
  institution: string;
  location: string;
  dates: string;
  bullets: string[];
}

// Persisted, role-targeted variant built from a stored CV rewrite.
export interface ProfileVariantDto {
  id: string;
  profileId: string;
  name: string;
  targetTitle: string;
  headline: string;
  summary: string;
  aboutText: string;
  keywords: string[];
  positions: string[];
  skills: CvSkillGroup[];
  experience: CvExperienceEntry[];
  education: CvEducationEntry[];
  contact: ContactInfo;
  sourceCvDocumentId?: string | null;
  sourceRewriteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── LinkedIn draft-and-review sync plan ──────────────────────────────────
// Inert, copy-ready payloads. NOTHING is written to LinkedIn by the backend;
// the user pastes each section manually after reviewing it.

export type SyncSectionKind = "headline" | "about" | "skills" | "experience";

export interface SyncSection {
  id: string;
  kind: SyncSectionKind;
  label: string;
  editUrl: string;
  copyText: string;
  charLimit?: number | null;
  overLimit: boolean;
}

export interface ProfileSyncPlan {
  variantId: string;
  profileId: string;
  variantName: string;
  targetTitle: string;
  sections: SyncSection[];
  disclaimer: string;
  generatedAt: string;
}

/** Result of pushing one section to a profile board (LinkedIn / Catho). The
 *  `copyText`/`editUrl` fields are only populated by the LinkedIn copy-paste
 *  flow; Catho leaves them unset. Mirrors the Rust `SyncSectionResult`. */
export interface SyncSectionResult {
  kind: string;
  status: "ok" | "manual" | "error";
  label?: string;
  reason?: string;
  copyText?: string;
  editUrl?: string;
}
