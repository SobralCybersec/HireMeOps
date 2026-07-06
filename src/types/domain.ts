// Minimal domain DTOs for Phase 1 (foundation shell only). These intentionally
// stay small — real fields will be expanded once each page grows real logic.

export interface Profile {
  id: string;
  name: string;
  isActive: boolean;
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
  | "queued"
  | "needs_review"
  | "submitted"
  | "failed"
  | "skipped_duplicate";

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
