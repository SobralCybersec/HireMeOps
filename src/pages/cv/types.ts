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

/** Contact block extracted verbatim from the source CV (mirrors `ai::prompt::CvContact`). */
export interface CvContact {
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
}

/** One skill group of a rewritten CV: category → comma-separated skills. */
export interface CvSkillGroup {
  category: string;
  skills: string;
}

/** One experience entry of a rewritten CV (maps to the .tex experience table). */
export interface CvExperienceEntry {
  title: string;
  organization: string;
  location: string;
  dates: string;
  bullets: string[];
}

/** One education entry of a rewritten CV (maps to the .tex education table). */
export interface CvEducationEntry {
  degree: string;
  institution: string;
  location: string;
  dates: string;
  bullets: string[];
}

/**
 * A fully REWRITTEN CV tailored to a target role - real rewritten content, not
 * a critique. Mirrors `ai::prompt::CvRewrite`. Structured to round-trip through
 * the Java CV Generator's `.tex` model.
 */
export interface CvRewrite {
  name: string;
  /** Contact details + links (email, phone, LinkedIn, GitHub, portfolio). Absent on old rows. */
  contact?: CvContact;
  positions: string[];
  summary: string;
  skills: CvSkillGroup[];
  experience: CvExperienceEntry[];
  education: CvEducationEntry[];
  /** Output language stamped by the domain layer — "pt" or "en". Defaults to "pt" when absent (old rows). */
  language?: CvLanguage;
}

/**
 * PDF metadata derived from a `CvRewrite`, matching `ResumeService.addPDFMetadata`
 * field-for-field so the CV Generator consumes it directly. Mirrors
 * `ai::prompt::CvMetadata` (serialized `camelCase`).
 */
export interface CvMetadata {
  title: string;
  subject: string;
  keywords: string;
  author: string;
  description: string;
  category: string;
}

/**
 * One persisted CV rewrite run, exactly as the backend emits it
 * (`domain/cv.rs::CvRewriteReport`, serialized `camelCase`). Listed newest-first.
 * Additive alongside `CvAnalysisReport` - a rewrite is the tailored CV itself.
 */
export interface CvRewriteReport {
  id: string;
  /** Source document id, or null if that document row was since deleted. */
  cvDocumentId: string | null;
  /** Joined file name of the source document; kept even after deletion. */
  cvFileName: string;
  /** Targeted role variant id, or null for a general (untargeted) run. */
  roleVariantId: string | null;
  /** Joined variant name when the run targeted a specific variant. */
  variantName: string | null;
  modelProvider: string;
  modelName: string;
  /** The full rewritten CV the model produced. */
  rewrite: CvRewrite;
  /** PDF metadata derived from `rewrite`. */
  metadata: CvMetadata;
  /** Original extracted CV text this rewrite was built from — the "before" of
   *  the CV Library comparison. Null for rewrites made before this was stored. */
  sourceText?: string | null;
  /** ISO timestamp the rewrite was persisted. */
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

/**
 * Output language for AI-generated CV analysis and rewrites. `"pt"` (Portuguese,
 * pt-BR) is the backend default; `"en"` is English. Mirrors the Rust
 * `crate::ai::prompt::Language` enum (`#[serde(rename_all = "lowercase")]`).
 */
export type CvLanguage = "pt" | "en";
