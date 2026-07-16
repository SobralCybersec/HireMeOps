// Placeholder library data - the single seam to replace once the CV backend is
// wired. Shapes match `CvLibraryDoc`; ids line up with the analysis mock so the
// two pages tell one coherent story.

import type { CvAnalysisReport, CvLibraryDoc } from "./types";

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

export const MOCK_LIBRARY: CvLibraryDoc[] = [
  {
    id: "cv1",
    profileId: "p1",
    fileName: "cv_rust_2025.pdf",
    fileType: "pdf",
    isActive: true,
    lastAnalysisScore: 88,
    sizeBytes: 184_320,
    pageCount: 2,
    createdAt: new Date(Date.now() - DAY * 12).toISOString(),
    lastUsedAt: new Date(Date.now() - HOUR * 3).toISOString(),
    fileHash: "bbf2b1f",
    assignedVariants: [
      { id: "v1", name: "Rust Systems" },
      { id: "v2", name: "Backend Platform" },
    ],
    sections: ["Summary", "Experience", "Open Source", "Skills", "Education"],
  },
  {
    id: "cv2",
    profileId: "p1",
    fileName: "cv_fullstack_general.docx",
    fileType: "docx",
    isActive: false,
    lastAnalysisScore: 74,
    sizeBytes: 96_112,
    pageCount: 3,
    createdAt: new Date(Date.now() - DAY * 40).toISOString(),
    lastUsedAt: new Date(Date.now() - DAY * 6).toISOString(),
    fileHash: "def0123",
    assignedVariants: [{ id: "v3", name: "Fullstack" }],
    sections: ["Profile", "Experience", "Projects", "Skills", "Education"],
  },
];

// Analysis history - `cvDocumentId` / `cvFileName` line up with `MOCK_LIBRARY`
// so the Library and Analysis pages tell one coherent story. Newest first, to
// match the backend's ordering.
export const MOCK_HISTORY: CvAnalysisReport[] = [
  {
    id: "rep-1",
    cvDocumentId: "cv1",
    cvFileName: "cv_rust_2025.pdf",
    roleVariantId: "v1",
    variantName: "Rust Systems",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-6",
    score: 88,
    summary:
      "Strong systems and open-source signal for a Rust-focused role. Closing the " +
      "cloud/orchestration gaps and leading with quantified impact would push this " +
      "into the top band.",
    optimizationNeeded: true,
    missingKeywords: ["Kubernetes", "gRPC", "distributed systems"],
    strengths: [
      "Strong systems programming background",
      "Open-source contributions",
      "Relevant project experience",
    ],
    weaknesses: ["Limited cloud infrastructure experience", "No formal CS degree listed"],
    recommendations: [
      "Add Kubernetes experience (even personal cluster projects)",
      "Mention distributed systems coursework or self-study",
      "Lead with quantified impact statements",
    ],
    createdAt: new Date(Date.now() - HOUR).toISOString(),
  },
  {
    id: "rep-2",
    cvDocumentId: "cv2",
    cvFileName: "cv_fullstack_general.docx",
    roleVariantId: "v3",
    variantName: "Fullstack",
    modelProvider: "openai",
    modelName: "gpt-4o",
    score: 74,
    summary:
      "Broad full-stack coverage with a clear project history. Reads as generalist; " +
      "tightening the summary around a target stack and adding measurable outcomes " +
      "would lift the match.",
    optimizationNeeded: true,
    missingKeywords: ["GraphQL", "CI/CD", "observability"],
    strengths: ["Broad full-stack coverage", "Clear project history"],
    weaknesses: ["Reads as generalist", "Few quantified outcomes"],
    recommendations: [
      "Tighten the summary around one target stack",
      "Quantify project outcomes (users, latency, revenue)",
    ],
    createdAt: new Date(Date.now() - DAY * 2).toISOString(),
  },
  {
    id: "rep-3",
    cvDocumentId: "cv1",
    cvFileName: "cv_rust_2025.pdf",
    roleVariantId: "v2",
    variantName: "Backend Platform",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-6",
    score: 79,
    summary:
      "Solid backend fundamentals for a platform role. The systems depth is there; " +
      "surfacing service-ownership and on-call experience would strengthen the " +
      "platform framing.",
    optimizationNeeded: false,
    missingKeywords: ["Terraform", "SLOs"],
    strengths: ["Solid backend fundamentals", "Systems depth"],
    weaknesses: ["Platform ownership signal is thin"],
    recommendations: [
      "Surface service-ownership and on-call experience",
      "Name the platforms and scale you operated",
    ],
    createdAt: new Date(Date.now() - DAY * 5).toISOString(),
  },
];

/** Human-readable file size. Kept here so both pages format identically. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact relative time ("3h ago", "6d ago", "just now"). */
export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < HOUR) return "just now";
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}
