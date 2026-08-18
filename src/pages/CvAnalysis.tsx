import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlayIcon } from "@hugeicons/core-free-icons";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Icon,
  KpiCard,
  ScoreBar,
  Select,
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
import "./cv/analysis.css";

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
  const navigate = useNavigate();
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
    <div className="page cv-analysis-page">
      <header className="cv-analysis-hero">
        <div className="cv-analysis-hero__copy">
          <div className="cv-analysis-kicker">
            <span className="cv-analysis-kicker__signal" />
            <span>AI WORKBENCH</span>
            <span className="cv-analysis-kicker__slash">/</span>
            <span>CV ANALYSIS</span>
          </div>
          <h1>
            Make every line
            <em>earn its place.</em>
          </h1>
          <p>
            Turn your stored CV into a focused match report. See what lands, what is missing, and
            what to improve before you apply.
          </p>
        </div>
        <div className="cv-analysis-hero__mark" aria-hidden="true">
          <span className="cv-analysis-hero__mark-core">CV</span>
        </div>
      </header>

      {loading ? (
        <div className="cv-analysis-loading" role="status">
          <span className="cv-analysis-loading__bar" />
          <span>Reading analysis workspace…</span>
        </div>
      ) : loadError !== null ? (
        <div className="cv-analysis-state cv-analysis-state--error" role="alert">
          <span className="cv-analysis-state__code">ERR / REPORT_STORE</span>
          <h2>Analysis history is unavailable</h2>
          <p>
            Saved reports are still safe. The report store returned: <strong>{loadError}</strong>
          </p>
          <Button variant="primary" onClick={() => setReloadNonce((n) => n + 1)}>
            Retry connection
          </Button>
        </div>
      ) : docs.length === 0 && reports.length === 0 ? (
        <div className="cv-analysis-state">
          <span className="cv-analysis-state__orb">+</span>
          <span className="cv-analysis-state__code">READY / AWAITING SOURCE</span>
          <h2>Start with a stored CV</h2>
          <p>Upload a document in CV Library first. Your analysis history will appear here.</p>
          <Button variant="primary" onClick={() => navigate("/cv-library")}>
            Open CV Library
          </Button>
        </div>
      ) : (
        <>
          <section className="cv-analysis-runbar" aria-label="Run a new analysis">
            <div className="cv-analysis-runbar__copy">
              <span className="cv-analysis-section-label">NEW ANALYSIS</span>
              <h2>Choose a source CV</h2>
              <p>Run a fresh match report against your current application target.</p>
            </div>
            <div className="cv-analysis-runbar__form">
              <Field label="Source document" htmlFor="cv-sel" className="cv-analysis-picker">
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
                {running ? "Analysing…" : "Run analysis"}
              </Button>
            </div>
          </section>

          {runError !== null && (
            <div className="cv-analysis-alert" role="alert">
              <span className="cv-analysis-alert__icon">!</span>
              <div>
                <strong>Analysis failed. History is unchanged.</strong>
                <span>{runError}</span>
              </div>
            </div>
          )}

          {selectedReport === null ? (
            <div className="cv-analysis-state cv-analysis-state--inline">
              <span className="cv-analysis-state__code">NO REPORT / READY</span>
              <h2>Run your first analysis</h2>
              <p>
                Pick a CV above and press Run analysis. The result will be saved to your history.
              </p>
            </div>
          ) : (
            <ReportDetail report={selectedReport} />
          )}

          {reports.length > 1 && (
            <section className="cv-analysis-history">
              <div className="cv-analysis-section-head">
                <div>
                  <span className="cv-analysis-section-label">ARCHIVE</span>
                  <h2>Analysis history</h2>
                </div>
                <span className="cv-analysis-section-head__count">
                  {reports.length.toString().padStart(2, "0")} runs
                </span>
              </div>
              <DataTable
                columns={historyCols}
                rows={reports}
                getRowKey={(r) => r.id}
                onRowClick={(r) => setSelectedReportId(r.id)}
              />
            </section>
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
    <section className="cv-analysis-report" aria-label="Selected analysis report">
      <header className="cv-analysis-report__head">
        <div>
          <span className="cv-analysis-section-label">LATEST REPORT</span>
          <h2>{report.cvFileName}</h2>
          <p>
            {report.variantName ?? "General profile"} ·{" "}
            {new Date(report.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className={`cv-analysis-score cv-analysis-score--${scoreVariant}`}>
          <span>match score</span>
          <strong>{report.score !== null ? report.score : "—"}</strong>
          <small>{report.score !== null ? "/ 100" : "not scored"}</small>
        </div>
      </header>

      <div className="cv-analysis-kpis">
        <KpiCard
          label="Match score"
          tone={kpiTone(scoreVariant)}
          accessibleValue={report.score !== null ? `${report.score} percent` : "not scored"}
          value={report.score !== null ? `${report.score}%` : "n/a"}
          meta="overall signal"
        />
        <KpiCard
          label="Missing keywords"
          value={report.missingKeywords.length}
          tone={report.missingKeywords.length > 0 ? "danger" : "success"}
          meta={report.missingKeywords.length > 0 ? "worth adding" : "none flagged"}
        />
        <KpiCard
          label="Recommendations"
          value={report.recommendations.length}
          tone="accent"
          meta="next actions"
        />
      </div>

      {report.score !== null && (
        <div className="cv-analysis-scorecard">
          <div className="cv-analysis-scorecard__head">
            <div>
              <span className="cv-analysis-section-label">SIGNAL STRENGTH</span>
              <strong>
                {report.score >= 80
                  ? "Strong alignment"
                  : report.score >= 60
                    ? "Promising alignment"
                    : "Room to improve"}
              </strong>
            </div>
            <span>{report.score}%</span>
          </div>
          <ScoreBar label="Match" value={report.score} variant={matchScoreVariant(report.score)} />
        </div>
      )}

      <Card
        className="cv-analysis-summary"
        title="Executive read"
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

      <div className="cv-analysis-meta" aria-label="Analysis metadata">
        <span>
          <small>DOCUMENT</small>
          <strong>{report.cvFileName}</strong>
        </span>
        <span>
          <small>VARIANT</small>
          <strong>{report.variantName ?? "General"}</strong>
        </span>
        <span>
          <small>MODEL</small>
          <strong>
            {report.modelProvider} / {report.modelName}
          </strong>
        </span>
        <span>
          <small>RUN AT</small>
          <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleString()}</time>
        </span>
      </div>

      <div className="cv-analysis-detail-grid">
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
    </section>
  );
}
