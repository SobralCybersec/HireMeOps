import {
  analyzeCv,
  deleteCv,
  loadRewriteDetailAction,
  rewriteCv,
  rewriteFirstCv,
  uploadCv,
} from "./cv-library-actions";
import type { CvLibraryState } from "./useCvLibraryState";
import type { useCvLibraryDerived } from "./useCvLibraryDerived";

type Derived = ReturnType<typeof useCvLibraryDerived>;

export function useCvLibraryActions(state: CvLibraryState, derived: Derived) {
  const { activeProfileId, setSelectedId } = state;
  const { selected, firstCvReady } = derived;
  const toggle = (id: string) => state.setSelectedId((previous) => (previous === id ? null : id));
  const handleUpload = (kind: "pdf" | "docx") =>
    uploadCv({
      kind,
      importing: state.importing,
      profileId: activeProfileId,
      setImporting: state.setImporting,
      setImportError: state.setImportError,
      bumpReload: state.setReloadNonce,
    });
  const handleAnalyze = () =>
    analyzeCv({
      analyzing: state.isAnalyzing,
      selected,
      language: state.language,
      setAnalyzing: state.setIsAnalyzing,
      setError: state.setAnalyzeError,
      bumpReload: state.setReloadNonce,
    });
  const handleDelete = () =>
    deleteCv({
      deleting: state.isDeleting,
      selected,
      setDeleting: state.setIsDeleting,
      setError: state.setDeleteError,
      setSelectedId,
      bumpReload: state.setReloadNonce,
    });
  const handleRewrite = () =>
    rewriteCv({
      rewriting: state.isRewriting,
      selected,
      language: state.language,
      extraInfo: state.extraInfo,
      setRewriting: state.setIsRewriting,
      setError: state.setRewriteError,
      bumpReload: state.setReloadNonce,
    });
  const handleFirstCvRewrite = () =>
    rewriteFirstCv({
      rewriting: state.isRewriting,
      ready: firstCvReady,
      profileId: activeProfileId,
      target: state.firstCvTarget,
      language: state.language,
      info: state.firstCvInfo,
      setRewriting: state.setIsRewriting,
      setError: state.setRewriteError,
      setOpen: state.setFirstCvOpen,
      bumpReload: state.setReloadNonce,
    });
  const loadRewriteDetail = (rewriteId: string) =>
    loadRewriteDetailAction({
      profileId: activeProfileId,
      rewriteId,
      details: state.rewriteDetails,
      loadingId: state.rewriteDetailLoading,
      setLoadingId: state.setRewriteDetailLoading,
      setDetails: state.setRewriteDetails,
    });
  return {
    toggle,
    handleUpload,
    handleAnalyze,
    handleDelete,
    handleRewrite,
    handleFirstCvRewrite,
    loadRewriteDetail,
  };
}
