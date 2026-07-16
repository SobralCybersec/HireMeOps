// Shared status vocabulary. Every domain status maps to ONE visual variant
// so the same color/label logic is used by the shell, badges, dots and tables.
// Variants correspond 1:1 to the `--status-*` tokens and `.badge--*` / `.dot--*`
// modifier classes in src/styles/theme.css.

import type { ApplicationStatus, AutomationState, JobStatus } from "../../types/domain";

export type StatusVariant =
  "queued" | "running" | "success" | "failed" | "review" | "stopped" | "paused" | "neutral";

/* ---- Automation state machine --------------------------------- */
export function automationVariant(state: AutomationState): StatusVariant {
  switch (state) {
    case "Queued":
    case "RetryScheduled":
      return "queued";
    case "Completed":
      return "success";
    case "Failed":
      return "failed";
    case "NeedsReview":
    case "PausedForCaptcha":
      return "review";
    case "Stopped":
      return "stopped";
    case "PausedByUser":
      return "paused";
    case "SkippedDuplicateUrl":
      return "neutral";
    default:
      // All the "in-flight" states (PreparingBrowser, Searching, ...)
      return "running";
  }
}

/* ---- Job status ----------------------------------------------- */
const JOB_STATUS_VARIANT: Record<JobStatus, StatusVariant> = {
  discovered: "neutral",
  matched: "running",
  rejected: "stopped",
  queued: "queued",
  applied: "success",
  failed: "failed",
  needs_review: "review",
  saved: "neutral",
  ignored: "neutral",
  skipped_duplicate_url: "neutral",
};

export function jobStatusVariant(status: JobStatus): StatusVariant {
  return JOB_STATUS_VARIANT[status] ?? "neutral";
}

/* ---- Application status ---------------------------------------- */
const APPLICATION_STATUS_VARIANT: Record<ApplicationStatus, StatusVariant> = {
  queued: "queued",
  needs_review: "review",
  submitted: "success",
  failed: "failed",
  skipped_duplicate: "neutral",
};

export function applicationStatusVariant(status: ApplicationStatus): StatusVariant {
  return APPLICATION_STATUS_VARIANT[status] ?? "neutral";
}

/* ---- Match score ---------------------------------------------- */
// Thresholds are intentionally coarse: strong / moderate / weak / poor.
export function matchScoreVariant(score: number): StatusVariant {
  if (score >= 80) return "success";
  if (score >= 60) return "running";
  if (score >= 40) return "review";
  return "failed";
}

/* ---- Labels ---------------------------------------------------- */
// "PreparingBrowser" -> "Preparing Browser"; "needs_review" -> "Needs Review".
export function humanizeStatus(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
