/**
 * Pure helpers for the applications / draft flow.
 *
 * Kept free of React and Tauri so they can be unit-tested in the node test
 * environment (mirrors the store-test convention).
 */
import type { JobMatchDto } from "../types/domain";

/**
 * Resolve the `job_matches.id` to draft against, given a job post id.
 *
 * The ApplicationsQueue / JobSearch rows are keyed by job post id, but the
 * `draft_application` command operates on a scored `job_matches` row. A job
 * that hasn't been scored yet has no match, so this returns `null` and the
 * caller must treat the draft action as a no-op.
 */
export function resolveMatchIdForJob(matches: JobMatchDto[], jobId: string): string | null {
  return matches.find((m) => m.jobId === jobId)?.id ?? null;
}
