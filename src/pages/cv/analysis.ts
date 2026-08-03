// Data seam for the CV Analysis page: listing persisted reports and running a
// new analysis. Mirrors `library.ts` - the page renders against these two
// functions so the real Tauri commands and the off-Tauri dev mocks are the
// only things that differ between environments.

import { invokeStrict } from "../../lib/tauriInvoke";
import type { CvAnalysisReport, CvLanguage } from "./types";

/**
 * List a profile's persisted analysis reports, newest first. Resolves to the
 * (possibly empty) list, or **rejects** if the backend errors - the caller must
 * distinguish "no analyses yet" (`[]`) from "failed to load" (throw) so a
 * backend failure never masquerades as an empty history. Passing "" when there
 * is no active profile yields an empty list. Off-Tauri, the dev mock is
 * returned. Mirrors `list_cv_analysis_reports({ profileId })`.
 */
export async function loadCvAnalysisReports(profileId: string): Promise<CvAnalysisReport[]> {
  return invokeStrict<CvAnalysisReport[]>("list_cv_analysis_reports", { profileId });
}

/**
 * Run gap/quality analysis for a stored CV document. Resolves to the new
 * `cv_analysis_reports.id`, or **rejects** with the backend `DomainError`
 * message (missing document, no configured AI provider, model failure...) so the
 * caller can surface it. The caller should reload the report list on success.
 * `language` selects the report language; omitted defaults to Portuguese
 * backend-side. Mirrors `analyze_cv_document({ cvDocumentId, language })`.
 */
export async function runCvAnalysis(
  cvDocumentId: string,
  language?: CvLanguage,
): Promise<string> {
  return invokeStrict<string>("analyze_cv_document", { cvDocumentId, language });
}
