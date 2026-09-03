// Barrel for the co-located CV surface module. Pages import from here.

export { CvCard } from "./CvCard";
export { CvViewer } from "./CvViewer";
export { CvPreviewThumb } from "./CvPreviewThumb";
export { CoverLetterExportButton, CvExportButton } from "./CvExportButton";
export { MOCK_LIBRARY, MOCK_HISTORY, formatBytes, relativeTime } from "./mockData";
export { defaultCvBytesLoader, PROPOSED_CV_BYTES_COMMAND } from "./pdf";
export { loadCvLibrary, importCvDocument } from "./library";
export { loadCvAnalysisReports, runCvAnalysis } from "./analysis";
export {
  loadCvRewrites,
  loadCvRewrite,
  runCvRewrite,
  runFirstTimeCvRewrite,
  exportCvRewrite,
  exportCoverLetter,
  saveCvRewritePdf,
  saveCoverLetterPdf,
} from "./rewrite";
export { renderInlineBold } from "./markdown";
export type { CvExportMode } from "./rewrite";
export type {
  CvAnalysisReport,
  CvBytesLoader,
  CvCertificate,
  CvEducationEntry,
  CvExperienceEntry,
  CvLanguage,
  CvLibraryDoc,
  CvMetadata,
  CvRewrite,
  CvRewriteReport,
  CvRewriteSummary,
  CvSkillGroup,
  CvVariantRef,
} from "./types";
