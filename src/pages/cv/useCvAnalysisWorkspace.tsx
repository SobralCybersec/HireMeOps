import { useEffect, useState } from "react";
import { matchScoreVariant, type Column } from "../../components/ui";
import { errMessage } from "../../lib/tauriInvoke";
import { loadCvAnalysisReports, loadCvLibrary, runCvAnalysis } from "../cv";
import type { CvAnalysisReport, CvLibraryDoc } from "./types";

const HISTORY_COLUMNS: Column<CvAnalysisReport>[] = [
  { key: "cvFileName", header: "CV", primary: true, render: (report) => report.cvFileName },
  {
    key: "variantName",
    header: "Variant",
    render: (report) => report.variantName ?? "General",
  },
  {
    key: "score",
    header: "Score",
    mono: true,
    align: "right",
    render: (report) =>
      report.score !== null ? (
        <span style={{ color: `var(--status-${matchScoreVariant(report.score)}-text)` }}>
          {report.score}%
        </span>
      ) : (
        "-"
      ),
  },
  {
    key: "modelProvider",
    header: "Provider",
    mono: true,
    render: (report) => report.modelProvider,
  },
  {
    key: "createdAt",
    header: "Date",
    mono: true,
    align: "right",
    render: (report) => new Date(report.createdAt).toLocaleDateString(),
  },
];

interface LoadStateSetters {
  setReports: (value: CvAnalysisReport[]) => void;
  setDocs: (value: CvLibraryDoc[]) => void;
  setLoadError: (value: string | null) => void;
  setLoading: (value: boolean) => void;
}

function applyLoadedData(
  reportResult: PromiseSettledResult<CvAnalysisReport[]>,
  libraryResult: PromiseSettledResult<CvLibraryDoc[]>,
  setters: LoadStateSetters,
) {
  if (reportResult.status === "fulfilled") {
    setters.setReports(reportResult.value);
    setters.setLoadError(null);
  } else {
    setters.setReports([]);
    setters.setLoadError(errMessage(reportResult.reason));
  }
  setters.setDocs(libraryResult.status === "fulfilled" ? libraryResult.value : []);
  setters.setLoading(false);
}

export function useCvAnalysisWorkspace(activeProfileId: string | null) {
  const [reports, setReports] = useState<CvAnalysisReport[]>([]);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedCvId, setSelectedCvId] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const requestKey = `${activeProfileId ?? ""}:${reloadNonce}`;
  const [loadingKey, setLoadingKey] = useState(requestKey);
  if (loadingKey !== requestKey) {
    setLoadingKey(requestKey);
    setLoading(true);
    setLoadError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const profileId = activeProfileId ?? "";
    Promise.allSettled([loadCvAnalysisReports(profileId), loadCvLibrary(profileId)]).then(
      ([reportResult, libraryResult]) => {
        if (!cancelled) {
          applyLoadedData(reportResult, libraryResult, {
            setReports,
            setDocs,
            setLoadError,
            setLoading,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce]);

  const selectedReport =
    reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null;
  const cvValue = docs.some((doc) => doc.id === selectedCvId) ? selectedCvId : (docs[0]?.id ?? "");

  async function handleRun() {
    if (running || cvValue === "") return;
    setRunning(true);
    setRunError(null);
    try {
      await runCvAnalysis(cvValue);
      setSelectedReportId(null);
      setReloadNonce((value) => value + 1);
    } catch (error) {
      setRunError(errMessage(error));
    } finally {
      setRunning(false);
    }
  }

  return {
    reports,
    docs,
    loading,
    loadError,
    selectedReport,
    cvValue,
    running,
    runError,
    historyCols: HISTORY_COLUMNS,
    setSelectedCvId,
    retry: () => setReloadNonce((value) => value + 1),
    handleRun,
    setSelectedReportId,
  };
}
