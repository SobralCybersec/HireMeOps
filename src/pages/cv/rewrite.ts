// Data seam for the CV rewrite flow: listing persisted rewrites and running a
// new rewrite. Mirrors `analysis.ts` - the page renders against these two
// functions so the real Tauri commands and the off-Tauri dev mocks are the only
// things that differ between environments.
//
// A rewrite is the tailored CV *itself* (structured content + derived PDF
// metadata), NOT a critique - it is additive alongside `analysis.ts`.

import { invokeStrict } from "../../lib/tauriInvoke";
import type { CvLanguage, CvRewriteReport, CvRewriteSummary } from "./types";

const rewriteListRequests = new Map<string, Promise<CvRewriteSummary[]>>();

/**
 * List lightweight metadata for a profile's persisted CV rewrites, newest first.
 * Resolves to the (possibly empty) list, or **rejects** if the backend errors - the caller must
 * distinguish "no rewrites yet" (`[]`) from "failed to load" (throw) so a
 * backend failure never masquerades as an empty history. Passing "" when there
 * is no active profile yields an empty list. Mirrors
 * `list_cv_rewrites({ profileId })`. Full JSON/source text uses `loadCvRewrite`.
 */
export function loadCvRewrites(profileId: string): Promise<CvRewriteSummary[]> {
  const existing = rewriteListRequests.get(profileId);
  if (existing) return existing;
  const request = invokeStrict<CvRewriteSummary[]>("list_cv_rewrites", { profileId }).finally(
    () => {
      rewriteListRequests.delete(profileId);
    },
  );
  rewriteListRequests.set(profileId, request);
  return request;
}

export function loadCvRewrite(profileId: string, rewriteId: string): Promise<CvRewriteReport> {
  return invokeStrict<CvRewriteReport>("get_cv_rewrite", { profileId, rewriteId });
}

/**
 * Produce a REWRITTEN CV tailored to `targetTitle` (optional) for a stored CV
 * document. Resolves to the new `cv_rewrites.id`, or **rejects** with the
 * backend `DomainError` message (missing document, no configured AI provider,
 * model failure...) so the caller can surface it. The caller should reload the
 * rewrite list on success. `language` selects the output language (content +
 * LaTeX section titles); omitted defaults to Portuguese backend-side. Mirrors
 * `rewrite_cv_document({ cvDocumentId, targetTitle, language })`.
 */
export async function runCvRewrite(
  cvDocumentId: string,
  targetTitle?: string,
  language?: CvLanguage,
  extraContext?: string,
): Promise<string> {
  return invokeStrict<string>("rewrite_cv_document", {
    cvDocumentId,
    targetTitle,
    language,
    // Optional candidate-supplied context (links, GitHub, notes) fed to the AI
    // for this run only. Trimmed to null so an empty box sends nothing.
    extraContext: extraContext?.trim() ? extraContext.trim() : null,
  });
}

/**
 * Create a first-time CV rewrite without an uploaded source document. The user
 * supplies the full source facts in `candidateContext`; backend persists it as a
 * documentless `cv_rewrites` row so the same PDF export path can render it.
 */
export async function runFirstTimeCvRewrite(
  profileId: string,
  targetTitle: string,
  language: CvLanguage,
  candidateContext: string,
): Promise<string> {
  return invokeStrict<string>("create_first_time_cv_rewrite", {
    profileId,
    targetTitle: targetTitle.trim() ? targetTitle.trim() : null,
    language,
    candidateContext: candidateContext.trim(),
  });
}

/**
 * How a rewrite is turned into a PDF:
 *  - `"new"`    - render a fresh single-column PDF from the structured rewrite.
 *  - `"modify"` - take the *source* document's existing PDF and stamp the
 *    derived metadata onto it (the `ResumeService.addPDFMetadata` path). The
 *    backend gracefully falls back to `"new"` when the source is missing or is
 *    not a PDF, so `"modify"` is always safe to request.
 */
export type CvExportMode = "new" | "modify";

/**
 * Produce PDF bytes for a persisted rewrite. Resolves to the raw file bytes, or
 * **rejects** with the backend `DomainError` message (unknown rewrite, render
 * failure...). Mirrors `export_cv_rewrite({ rewriteId, mode })`, which returns a
 * `Vec<u8>` - Tauri hands that to JS as a `number[]`, so we normalise it to a
 * `Uint8Array` here for the caller.
 */
export async function exportCvRewrite(rewriteId: string, mode: CvExportMode): Promise<Uint8Array> {
  const bytes = await invokeStrict<number[]>("export_cv_rewrite", { rewriteId, mode });
  return Uint8Array.from(bytes);
}

export async function exportCoverLetter(rewriteId: string): Promise<Uint8Array> {
  const bytes = await invokeStrict<number[]>("export_cover_letter", { rewriteId });
  return Uint8Array.from(bytes);
}

/**
 * Render a persisted rewrite to a PDF and save it via a **native save dialog**,
 * suggesting `suggestedName` as the filename. Resolves to the saved absolute
 * path, or `null` if the user cancelled the dialog. Rejects with the backend
 * `DomainError` message on render/write failure.
 *
 * The whole render → dialog → write runs in Rust (`save_cv_rewrite_pdf`) on
 * purpose: the WebKitGTK webview (Tauri on Linux) silently drops blob
 * `<a download>` saves, so a browser-style download here would never land a
 * file. The native dialog is the only reliable save path.
 */
export async function saveCvRewritePdf(
  rewriteId: string,
  mode: CvExportMode,
  suggestedName: string,
): Promise<string | null> {
  return invokeStrict<string | null>("save_cv_rewrite_pdf", {
    rewriteId,
    mode,
    suggestedName,
  });
}

/** Render a persisted rewrite's generated cover letter and save it via native dialog. */
export async function saveCoverLetterPdf(
  rewriteId: string,
  suggestedName: string,
): Promise<string | null> {
  return invokeStrict<string | null>("save_cover_letter_pdf", {
    rewriteId,
    suggestedName,
  });
}
