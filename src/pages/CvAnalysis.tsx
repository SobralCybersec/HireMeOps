import { useEffect, useState } from "react";
import { PlayIcon } from "@hugeicons/core-free-icons";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Icon,
  KpiCard,
  ScoreBar,
  Select,
  Toolbar,
  ToolbarSep,
  matchScoreVariant,
  type Column,
} from "../components/ui";
import type { KpiTone } from "../components/ui";
import type { StatusVariant } from "../components/ui/status";
import { loadCvAnalysisReports, loadCvLibrary, runCvAnalysis } from "./cv";
import type { CvAnalysisReport, CvLibraryDoc } from "./cv";
import { useSettingsStore } from "../stores/useSettingsStore";
import { errMessage } from "../lib/tauriInvoke";
import "./cv/cv.css";

// Match the KpiCard tone palette to the score-band variant so the tile border
// and the fill of the score bar under it read as one signal. `matchScoreVariant`
// only ever yields success / running / review / failed; "neutral" (no score)
// and "running" both fall through to the default tone.
function kpiTone(v: StatusVariant): KpiTone {
  if (v === "success") return "success";
  if (v === "review") return "review";
  if (v === "failed") return "danger";
  return "default";
}

export function CvAnalysis() {
  const activeProfileId = useSettingsStore((s) => s.settings?.activeProfileId ?? null);

  const [reports, setReports] = useState<CvAnalysisReport[]>([]);
  const [docs, setDocs] = useState<CvLibraryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which report is expanded. null => fall back to the newest (reports[0]).
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  // Which CV the Run picker targets. "" => fall back to the first document.
  const [selectedCvId, setSelectedCvId] = useState<string>("");

  // Bumped by the Retry button and after a successful run to re-run the load
  // effect even when the profile id is unchanged (a plain re-set is a no-op).
  const [reloadNonce, setReloadNonce] = useState(0);
  // Run flow: mirrors CvLibrary's import/analyse error pattern.
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  // Reset transient load state when the request identity changes (profile
  // switch or Retry). Done during render -- not synchronously inside the effect
  // -- so React folds it into the in-progress render instead of a second
  // commit->render pass. This is what satisfies react-hooks/set-state-in-effect;
  // see CvLibrary for the full rationale.
  const requestKey = `${activeProfileId ?? ""}:${reloadNonce}`;
  const [loadingKey, setLoadingKey] = useState(requestKey);
  if (loadingKey !== requestKey) {
    setLoadingKey(requestKey);
    setLoading(true);
    setLoadError(null);
  }

  // Load the active profile's persisted reports (the page content) and its CV
  // documents (the Run picker) together. A report-list failure gates the page
  // via `loadError` -- distinct from an empty `[]`, so a failed load never
  // masquerades as "no analyses yet". A document-list failure is tolerated: the
  // picker ends up empty (Run disabled) but existing reports still render.
  useEffect(() => {
    let cancelled = false;
    const pid = activeProfileId ?? "";
    Promise.allSettled([loadCvAnalysisReports(pid), loadCvLibrary(pid)]).then(([rep, lib]) => {
      if (cancelled) return;
      if (rep.status === "fulfilled") {
        setReports(rep.value);
        setLoadError(null);
      } else {
        setReports([]);
        setLoadError(errMessage(rep.reason));
      }
      setDocs(lib.status === "fulfilled" ? lib.value : []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, reloadNonce]);

  // Selected report with a newest-first fallback. After a run we reset the
  // selection to null; since the fresh report sorts first, null resolves to it.
  const selectedReport = reports.find((r) => r.id === selectedReportId) ?? reports[0] ?? null;

  // Controlled CV picker value, clamped to a real document so the <select>
  // never points at a stale id after the library reloads.
  const cvValue = docs.some((d) => d.id === selectedCvId) ? selectedCvId : (docs[0]?.id ?? "");

  // Run a fresh analysis for the picked CV, then reload. Resetting the report
  // selection to null surfaces the new (newest-first) report automatically.
  // A backend DomainError (missing document, no AI provider, model failure)
  // surfaces via `runError`; guarded so double-clicks can't overlap.
  async function handleRun() {
    if (running || cvValue === "") return;
    setRunning(true);
    setRunError(null);
    try {
      await runCvAnalysis(cvValue);
      setSelectedReportId(null);
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setRunError(errMessage(e));
    } finally {
      setRunning(false);
    }
  }

  const historyCols: Column<CvAnalysisReport>[] = [
    { key: "cvFileName", header: "CV", primary: true, render: (r) => r.cvFileName },
    {
      key: "variantName",
      header: "Variant",
      render: (r) => r.variantName ?? "General",
    },
    {
      key: "score",
      header: "Score",
      mono: true,
      align: "right",
      render: (r) =>
        r.score !== null ? (
          <span style={{ color: `var(--status-${matchScoreVariant(r.score)}-text)` }}>
            {r.score}%
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "modelProvider",
      header: "Provider",
      mono: true,
      render: (r) => r.modelProvider,
    },
    {
      key: "createdAt",
      header: "Date",
      mono: true,
      align: "right",
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">CV Analysis</h1>
        <span className="page-subtitle">AI-powered match analysis</span>
      </div>

      {loading ? (
        <EmptyState
          label="..."
          title="Loading analyses..."
          body="Reading this profile's saved analysis reports."
        />
      ) : loadError !== null ? (
        <EmptyState
          label="Error"
          title="Couldn't load your analysis history"
          body={`The report store returned an error, so your analyses aren't shown. This does not mean they were deleted. ${loadError}`}
          action={
            <Button variant="primary" onClick={() => setReloadNonce((n) => n + 1)}>
              Retry
            </Button>
          }
        />
      ) : docs.length === 0 && reports.length === 0 ? (
        <EmptyState
          label="Empty"
          title="No CVs to analyse yet"
          body="Upload a CV in the Library first. Analyses run against a stored document and appear here."
        />
      ) : (
        <>
          <Toolbar>
            <Field label="CV" htmlFor="cv-sel" className="cvx-picker">
              <Select
                id="cv-sel"
                value={cvValue}
                onChange={(e) => setSelectedCvId(e.target.value)}
                options={docs.map((d) => ({ value: d.id, label: d.fileName }))}
                placeholder={docs.length === 0 ? "No CVs available" : undefined}
              />
            </Field>
            <ToolbarSep />
            <Button
              variant="primary"
              disabled={running || cvValue === ""}
              icon={<Icon icon={PlayIcon} size={14} />}
              onClick={handleRun}
            >
              {running ? "Running..." : "Run Analysis"}
            </Button>
          </Toolbar>

          {runError !== null && (
            <div className="inline-warning inline-warning--danger" role="alert">
              <div className="inline-warning__body">
                <div>Analysis failed. Your history is unchanged.</div>
                <div className="inline-warning__url">{runError}</div>
              </div>
            </div>
          )}

          {selectedReport === null ? (
            <EmptyState
              label="No analysis"
              title="Run your first analysis"
              body="Pick a CV above and press Run Analysis. The result is saved to your history."
            />
          ) : (
            <ReportDetail report={selectedReport} />
          )}

          {reports.length > 1 && (
            <div className="section-group">
              <h2 className="section-title">Analysis History</h2>
              <DataTable
                columns={historyCols}
                rows={reports}
                getRowKey={(r) => r.id}
                onRowClick={(r) => setSelectedReportId(r.id)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The expanded view of a single report: score tiles, a match bar, the model's
 * summary, a run-metadata strip, and the four detail lists. Split out so the
 * page body stays a readable branch table.
 */
function ReportDetail({ report }: { report: CvAnalysisReport }) {
  const scoreVariant: StatusVariant =
    report.score !== null ? matchScoreVariant(report.score) : "neutral";

  return (
    <>
      {/* Score + count tiles. The score tile's tone flips with the match band
          so a red tile never sits next to a green ScoreBar. */}
      <div className="stat-grid">
        <KpiCard
          label="Match Score"
          tone={kpiTone(scoreVariant)}
          accessibleValue={report.score !== null ? `${report.score} percent` : "not scored"}
          value={
            report.score !== null ? (
              <>
                {report.score}
                <span
                  style={{
                    fontSize: "var(--text-md)",
                    fontWeight: "var(--fw-regular)",
                    marginLeft: 1,
                  }}
                >
                  %
                </span>
              </>
            ) : (
              "n/a"
            )
          }
        />
        <KpiCard
          label="Missing Keywords"
          value={report.missingKeywords.length}
          tone={report.missingKeywords.length > 0 ? "danger" : "success"}
        />
        <KpiCard label="Recommendations" value={report.recommendations.length} />
      </div>

      {report.score !== null && (
        <Card compact>
          <div className="cvx-scorebars">
            <ScoreBar
              label="Match"
              value={report.score}
              variant={matchScoreVariant(report.score)}
            />
          </div>
        </Card>
      )}

      <Card
        title="Summary"
        actions={
          report.optimizationNeeded ? (
            <Badge variant="review">Optimization needed</Badge>
          ) : (
            <Badge variant="success">Well matched</Badge>
          )
        }
      >
        <p className="cvx-summary-text">{report.summary}</p>
      </Card>

      {/* Run metadata strip -- monospace, wraps on narrow. */}
      <div className="cvx-runmeta" aria-label="Analysis metadata">
        <span>
          <span className="cvx-runmeta__k">CV</span>
          <strong>{report.cvFileName}</strong>
        </span>
        <span>
          <span className="cvx-runmeta__k">Variant</span>
          <strong>{report.variantName ?? "General"}</strong>
        </span>
        <span>
          <span className="cvx-runmeta__k">Model</span>
          <strong>
            {report.modelProvider} / {report.modelName}
          </strong>
        </span>
        <span>
          <span className="cvx-runmeta__k">Run</span>
          <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
        </span>
      </div>

      {/* Detail grid -- 2 columns on desktop, collapses to 1 on narrow. */}
      <div className="cvx-detail-grid">
        <Card
          title="Strengths"
          actions={<Badge variant="success">{report.strengths.length}</Badge>}
        >
          {report.strengths.length > 0 ? (
            <ul className="cvx-list">
              {report.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="cvx-empty-note">None flagged.</p>
          )}
        </Card>

        <Card
          title="Weaknesses"
          actions={<Badge variant="review">{report.weaknesses.length}</Badge>}
        >
          {report.weaknesses.length > 0 ? (
            <ul className="cvx-list">
              {report.weaknesses.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="cvx-empty-note">None flagged.</p>
          )}
        </Card>

        <Card
          title="Missing Keywords"
          actions={<Badge variant="failed">{report.missingKeywords.length}</Badge>}
        >
          {report.missingKeywords.length > 0 ? (
            <div className="cvx-keywords">
              {report.missingKeywords.map((kw) => (
                <Badge key={kw} variant="failed">
                  {kw}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="cvx-empty-note">Nothing missing.</p>
          )}
        </Card>

        <Card
          title="Recommendations"
          actions={<Badge variant="neutral">{report.recommendations.length}</Badge>}
        >
          {report.recommendations.length > 0 ? (
            <ol className="cvx-list cvx-list--ordered">
              {report.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          ) : (
            <p className="cvx-empty-note">None.</p>
          )}
        </Card>
      </div>
    </>
  );
}
