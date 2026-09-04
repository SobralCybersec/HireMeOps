import { formatBytes, relativeTime } from "../cv";
import type { CvLibraryDoc, CvRewriteReport, CvRewriteSummary } from "./types";
import type { CvLibraryState } from "./useCvLibraryState";

function documentRewrite(rewrites: CvRewriteSummary[], documentId: string | null) {
  return rewrites.find((rewrite) => rewrite.cvDocumentId === documentId) ?? null;
}

function rewriteDetail(details: Record<string, CvRewriteReport>, rewrite: CvRewriteSummary | null) {
  return rewrite ? (details[rewrite.id] ?? null) : null;
}

function inspectorRows(selected: CvLibraryDoc | null) {
  if (selected === null) return [];
  return [
    { label: "File", value: selected.fileName },
    { label: "Type", value: selected.fileType.toUpperCase() },
    { label: "Pages", value: String(selected.pageCount) },
    { label: "Size", value: formatBytes(selected.sizeBytes) },
    { label: "Hash", value: selected.fileHash },
    { label: "Profile ID", value: selected.profileId },
    { label: "Added", value: relativeTime(selected.createdAt) },
    { label: "Last used", value: relativeTime(selected.lastUsedAt) },
    { label: "Active", value: selected.isActive ? "Yes" : "No" },
    {
      label: "Last Score",
      value: selected.lastAnalysisScore !== null ? `${selected.lastAnalysisScore}%` : "-",
    },
  ];
}

export function useCvLibraryDerived(state: CvLibraryState) {
  const { docs, query, selectedId, openId, rewrites, rewriteDetails, firstCvTarget, firstCvInfo } =
    state;
  const visible = docs.filter((cv) => cv.fileName.toLowerCase().includes(query.toLowerCase()));
  const selected = docs.find((cv) => cv.id === selectedId) ?? null;
  const opened = docs.find((cv) => cv.id === openId) ?? null;
  const latestFirstTimeRewrite = documentRewrite(rewrites, null);
  const latestRewrite = documentRewrite(rewrites, selected?.id ?? "__none__");
  return {
    visible,
    selected,
    opened,
    latestFirstTimeRewrite,
    latestFirstTimeDetail: rewriteDetail(rewriteDetails, latestFirstTimeRewrite),
    latestRewrite,
    latestDetail: rewriteDetail(rewriteDetails, latestRewrite),
    firstCvReady: firstCvTarget.trim().length > 0 && firstCvInfo.trim().length >= 80,
    inspectorRows: inspectorRows(selected),
  };
}
