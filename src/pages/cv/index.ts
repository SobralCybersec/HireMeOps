// Barrel for the co-located CV surface module. Pages import from here.

export { CvCard } from "./CvCard";
export { CvViewer } from "./CvViewer";
export { CvPreviewThumb } from "./CvPreviewThumb";
export { CvExportButton } from "./CvExportButton";
export { MOCK_LIBRARY, MOCK_HISTORY, formatBytes, relativeTime } from "./mockData";
export { defaultCvBytesLoader, PROPOSED_CV_BYTES_COMMAND } from "./pdf";
export { loadCvLibrary, importCvDocument } from "./library";
export { loadCvAnalysisReports, runCvAnalysis } from "./analysis";
export { loadCvRewrites, runCvRewrite, exportCvRewrite, saveCvRewritePdf } from "./rewrite";
export type { CvExportMode } from "./rewrite";
export type {
  CvAnalysisReport,
  CvBytesLoader,
  CvEducationEntry,
  CvExperienceEntry,
  CvLanguage,
  CvLibraryDoc,
  CvMetadata,
  CvRewrite,
  CvRewriteReport,
  CvSkillGroup,
  CvVariantRef,
} from "./types";
