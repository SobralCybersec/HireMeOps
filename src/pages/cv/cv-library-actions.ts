import { open } from "@tauri-apps/plugin-dialog";
import { errMessage, invokeStrict } from "../../lib/tauriInvoke";
import {
  importCvDocument,
  loadCvRewrite,
  runCvAnalysis,
  runCvRewrite,
  runFirstTimeCvRewrite,
} from "../cv";
import type { CvLanguage, CvLibraryDoc, CvRewriteReport } from "./types";

type Bump = (update: (value: number) => number) => void;

export async function uploadCv(options: {
  kind: "pdf" | "docx";
  importing: boolean;
  profileId: string | null;
  setImporting: (value: boolean) => void;
  setImportError: (value: string | null) => void;
  bumpReload: Bump;
}) {
  if (options.importing) return;
  const selected = await open({
    multiple: false,
    directory: false,
    filters:
      options.kind === "pdf"
        ? [{ name: "PDF", extensions: ["pdf"] }]
        : [{ name: "Word document", extensions: ["docx"] }],
  });
  if (typeof selected !== "string") return;
  options.setImporting(true);
  options.setImportError(null);
  try {
    await importCvDocument(options.profileId ?? "", selected);
    options.bumpReload((value) => value + 1);
  } catch (error) {
    options.setImportError(errMessage(error));
  } finally {
    options.setImporting(false);
  }
}

export async function analyzeCv(options: {
  analyzing: boolean;
  selected: CvLibraryDoc | null;
  language: CvLanguage;
  setAnalyzing: (value: boolean) => void;
  setError: (value: string | null) => void;
  bumpReload: Bump;
}) {
  if (options.analyzing || options.selected === null) return;
  options.setAnalyzing(true);
  options.setError(null);
  try {
    await runCvAnalysis(options.selected.id, options.language);
    options.bumpReload((value) => value + 1);
  } catch (error) {
    options.setError(errMessage(error));
  } finally {
    options.setAnalyzing(false);
  }
}

export async function deleteCv(options: {
  deleting: boolean;
  selected: CvLibraryDoc | null;
  setDeleting: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSelectedId: (value: string | null) => void;
  bumpReload: Bump;
}) {
  if (options.deleting || options.selected === null) return;
  if (!window.confirm(`Delete "${options.selected.fileName}"? This cannot be undone.`)) return;
  options.setDeleting(true);
  options.setError(null);
  try {
    await invokeStrict<void>("delete_cv_document", { cvDocumentId: options.selected.id });
    options.setSelectedId(null);
    options.bumpReload((value) => value + 1);
  } catch (error) {
    options.setError(errMessage(error));
  } finally {
    options.setDeleting(false);
  }
}

export async function rewriteCv(options: {
  rewriting: boolean;
  selected: CvLibraryDoc | null;
  language: CvLanguage;
  extraInfo: string;
  setRewriting: (value: boolean) => void;
  setError: (value: string | null) => void;
  bumpReload: Bump;
}) {
  if (options.rewriting || options.selected === null) return;
  options.setRewriting(true);
  options.setError(null);
  try {
    await runCvRewrite(options.selected.id, undefined, options.language, options.extraInfo);
    options.bumpReload((value) => value + 1);
  } catch (error) {
    options.setError(errMessage(error));
  } finally {
    options.setRewriting(false);
  }
}

export async function rewriteFirstCv(options: {
  rewriting: boolean;
  ready: boolean;
  profileId: string | null;
  target: string;
  language: CvLanguage;
  info: string;
  setRewriting: (value: boolean) => void;
  setError: (value: string | null) => void;
  setOpen: (value: boolean) => void;
  bumpReload: Bump;
}) {
  if (options.rewriting || !options.ready || options.profileId === null) return;
  options.setRewriting(true);
  options.setError(null);
  try {
    await runFirstTimeCvRewrite(options.profileId, options.target, options.language, options.info);
    options.setOpen(true);
    options.bumpReload((value) => value + 1);
  } catch (error) {
    options.setError(errMessage(error));
  } finally {
    options.setRewriting(false);
  }
}

export async function loadRewriteDetailAction(options: {
  profileId: string | null;
  rewriteId: string;
  details: Record<string, CvRewriteReport>;
  loadingId: string | null;
  setLoadingId: (value: string | null) => void;
  setDetails: (
    update: (current: Record<string, CvRewriteReport>) => Record<string, CvRewriteReport>,
  ) => void;
}) {
  if (
    !options.profileId ||
    options.details[options.rewriteId] ||
    options.loadingId === options.rewriteId
  )
    return;
  options.setLoadingId(options.rewriteId);
  try {
    const report = await loadCvRewrite(options.profileId, options.rewriteId);
    options.setDetails((current) => ({ ...current, [options.rewriteId]: report }));
  } catch {
    // Export/compare buttons remain hidden until detail can be loaded.
  } finally {
    options.setLoadingId(null);
  }
}
