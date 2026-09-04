import { PlayIcon } from "@hugeicons/core-free-icons";
import {
  Button,
  DataTable,
  Field,
  Icon,
  Select,
  ToolbarSep,
  type Column,
} from "../../components/ui";
import type { CvAnalysisReport, CvLibraryDoc } from "./types";
import { AnalysisReport } from "./AnalysisReport";

interface AnalysisPageBodyProps {
  loading: boolean;
  loadError: string | null;
  docs: CvLibraryDoc[];
  reports: CvAnalysisReport[];
  selectedReport: CvAnalysisReport | null;
  cvValue: string;
  running: boolean;
  runError: string | null;
  historyCols: Column<CvAnalysisReport>[];
  onRetry: () => void;
  onOpenLibrary: () => void;
  onCvChange: (value: string) => void;
  onRun: () => void;
  onSelectReport: (id: string) => void;
}

function AnalysisLoading() {
  return (
    <div className="cv-analysis-loading" role="status">
      <span className="cv-analysis-loading__bar" />
      <span>Reading analysis workspace…</span>
    </div>
  );
}

function AnalysisLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="cv-analysis-state cv-analysis-state--error" role="alert">
      <span className="cv-analysis-state__code">ERR / REPORT_STORE</span>
      <h2>Analysis history is unavailable</h2>
      <p>
        Saved reports are still safe. The report store returned: <strong>{message}</strong>
      </p>
      <Button variant="primary" onClick={onRetry}>
        Retry connection
      </Button>
    </div>
  );
}

function AnalysisEmpty({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div className="cv-analysis-state">
      <span className="cv-analysis-state__orb">+</span>
      <span className="cv-analysis-state__code">READY / AWAITING SOURCE</span>
      <h2>Start with a stored CV</h2>
      <p>Upload a document in CV Library first. Your analysis history will appear here.</p>
      <Button variant="primary" onClick={onOpenLibrary}>
        Open CV Library
      </Button>
    </div>
  );
}

function AnalysisRunbar(
  props: Pick<
    AnalysisPageBodyProps,
    "docs" | "cvValue" | "running" | "selectedReport" | "onCvChange" | "onRun"
  >,
) {
  const { docs, cvValue, running, selectedReport, onCvChange, onRun } = props;
  return (
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
            onChange={(event) => onCvChange(event.target.value)}
            options={docs.map((doc) => ({ value: doc.id, label: doc.fileName }))}
            placeholder={docs.length === 0 ? "No CVs available" : undefined}
          />
        </Field>
        <ToolbarSep />
        <Button
          variant="primary"
          disabled={running || cvValue === ""}
          icon={<Icon icon={PlayIcon} size={14} />}
          onClick={onRun}
        >
          {running ? "Analysing…" : selectedReport === null ? "Run analysis" : "Analyze again"}
        </Button>
      </div>
    </section>
  );
}

function AnalysisReady(props: AnalysisPageBodyProps) {
  const {
    docs,
    reports,
    selectedReport,
    cvValue,
    running,
    runError,
    historyCols,
    onCvChange,
    onRun,
    onSelectReport,
  } = props;
  return (
    <>
      <AnalysisRunbar
        docs={docs}
        cvValue={cvValue}
        running={running}
        selectedReport={selectedReport}
        onCvChange={onCvChange}
        onRun={onRun}
      />
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
          <p>Pick a CV above and press Run analysis. The result will be saved to your history.</p>
        </div>
      ) : (
        <AnalysisReport report={selectedReport} />
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
            getRowKey={(report) => report.id}
            onRowClick={(report) => onSelectReport(report.id)}
          />
        </section>
      )}
    </>
  );
}

export function AnalysisPageBody(props: AnalysisPageBodyProps) {
  if (props.loading) return <AnalysisLoading />;
  if (props.loadError !== null) {
    return <AnalysisLoadError message={props.loadError} onRetry={props.onRetry} />;
  }
  if (props.docs.length === 0 && props.reports.length === 0) {
    return <AnalysisEmpty onOpenLibrary={props.onOpenLibrary} />;
  }
  return <AnalysisReady {...props} />;
}
