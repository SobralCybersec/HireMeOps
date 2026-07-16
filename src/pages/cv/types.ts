// View-model types for the CV Library / Analysis surface.
//
// `src/types/domain.ts` is the canonical (backend-shaped) DTO and stays
// deliberately minimal. These are *presentation* extensions that the two CV
// pages need but the Phase-1 backend does not yet emit - kept here, co-located
// with the only pages that consume them, instead of bloating the shared domain.

import type { CvDocument } from "../../types/domain";

export interface CvVariantRef {
  id: string;
  name: string;
}

/** A CV document enriched with the metadata the library UI renders. */
export interface CvLibraryDoc extends CvDocument {
  /** Raw file size in bytes (formatted for display via `formatBytes`). */
  sizeBytes: number;
  /** Page count from the parsed document. */
  pageCount: number;
  /** ISO timestamp the document was added. */
  createdAt: string;
  /** ISO timestamp it was last selected by the automation, or null if never. */
  lastUsedAt: string | null;
  /** Short content hash shown in the inspector (identity / dedupe aid). */
  fileHash: string;
  /** Profile variants this CV is assigned to. */
  assignedVariants: CvVariantRef[];
  /** Detected section headings, in document order. */
  sections: string[];
}

/**
 * One persisted CV analysis run, exactly as the backend emits it
 * (`src-tauri/.../domain/cv.rs::CvAnalysisReport`, serialized `camelCase`).
 * Listed newest-first. Unlike the types above this is a faithful DTO, not a
 * presentation extension - the Analysis page renders it directly.
 */
export interface CvAnalysisReport {
  id: string;
  /** Source document id, or null if that document row was since deleted. */
  cvDocumentId: string | null;
  /** Joined file name of the analysed document; kept even after deletion. */
  cvFileName: string;
  /** Targeted role variant id, or null for a general (untargeted) run. */
  roleVariantId: string | null;
  /** Joined variant name when the run targeted a specific variant. */
  variantName: string | null;
  modelProvider: string;
  modelName: string;
  /** Overall 0-100 match score, or null when the model returned none. */
  score: number | null;
  summary: string;
  /** Whether the model flagged the CV as needing optimization for the role. */
  optimizationNeeded: boolean;
  missingKeywords: string[];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  /** ISO timestamp the analysis was persisted. */
  createdAt: string;
}

/**
 * SEAM - the one function that turns a CV id into raw document bytes.
 *
 * The renderer (pdf.js) is wired entirely against this type so the day a real
 * Tauri command lands, only the loader implementation changes - no component
 * touches `invoke`. Returning `null` means "bytes not available yet" and every
 * consumer degrades to a calm skeleton / glyph fallback rather than an error.
 */
export type CvBytesLoader = (cvId: string) => Promise<Uint8Array | null>;
