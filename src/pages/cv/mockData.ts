// Placeholder library data — the single seam to replace once the CV backend is
// wired. Shapes match `CvLibraryDoc`; ids line up with the analysis mock so the
// two pages tell one coherent story.

import type { CvLibraryDoc } from "./types";

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
