import { useState } from "react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import type { CvLanguage, CvLibraryDoc, CvRewriteReport, CvRewriteSummary } from "./types";

function useCvDocumentState() {
  const activeProfileId = useSettingsStore((s) => s.settings?.activeProfileId ?? null);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadingKey, setLoadingKey] = useState("");
  return {
    activeProfileId,
    docs,
    setDocs,
    loading,
    setLoading,
    error,
    setError,
    selectedId,
    setSelectedId,
    openId,
    setOpenId,
    query,
    setQuery,
    reloadNonce,
    setReloadNonce,
    loadingKey,
    setLoadingKey,
  };
}

function useCvWorkflowState() {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewrites, setRewrites] = useState<CvRewriteSummary[]>([]);
  const [rewriteDetails, setRewriteDetails] = useState<Record<string, CvRewriteReport>>({});
  const [rewriteDetailLoading, setRewriteDetailLoading] = useState<string | null>(null);
  const [language, setLanguage] = useState<CvLanguage>("pt");
  const [extraInfo, setExtraInfo] = useState("");
  const [firstCvOpen, setFirstCvOpen] = useState(false);
  const [firstCvTarget, setFirstCvTarget] = useState("");
  const [firstCvInfo, setFirstCvInfo] = useState("");
  const [comparing, setComparing] = useState<CvRewriteReport | null>(null);
  return {
    importing,
    setImporting,
    importError,
    setImportError,
    isAnalyzing,
    setIsAnalyzing,
    analyzeError,
    setAnalyzeError,
    isDeleting,
    setIsDeleting,
    deleteError,
    setDeleteError,
    isRewriting,
    setIsRewriting,
    rewriteError,
    setRewriteError,
    rewrites,
    setRewrites,
    rewriteDetails,
    setRewriteDetails,
    rewriteDetailLoading,
    setRewriteDetailLoading,
    language,
    setLanguage,
    extraInfo,
    setExtraInfo,
    firstCvOpen,
    setFirstCvOpen,
    firstCvTarget,
    setFirstCvTarget,
    firstCvInfo,
    setFirstCvInfo,
    comparing,
    setComparing,
  };
}

export function useCvLibraryState() {
  return { ...useCvDocumentState(), ...useCvWorkflowState() };
}

export type CvLibraryState = ReturnType<typeof useCvLibraryState>;
