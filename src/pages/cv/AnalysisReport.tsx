import {
  Badge,
  Card,
  KpiCard,
  ScoreBar,
  matchScoreVariant,
  type KpiTone,
} from "../../components/ui";
import type { StatusVariant } from "../../components/ui/status";
import type { CvAnalysisReport } from ".";

function kpiTone(value: StatusVariant): KpiTone {
  if (value === "success") return "success";
  if (value === "review") return "review";
  if (value === "failed") return "danger";
  return "default";
}

function AnalysisScorecard({ report }: { report: CvAnalysisReport }) {
  if (report.score === null) return null;
  return (
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
  );
}

function AnalysisMetadata({ report }: { report: CvAnalysisReport }) {
  return (
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
  );
}

function FindingCard({
  title,
  items,
  variant,
  ordered = false,
  empty,
}: {
  title: string;
  items: string[];
  variant: "success" | "review" | "failed" | "neutral";
  ordered?: boolean;
  empty: string;
}) {
  return (
    <Card title={title} actions={<Badge variant={variant}>{items.length}</Badge>}>
      {items.length > 0 ? (
        ordered ? (
          <ol className="cvx-list cvx-list--ordered">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        ) : variant === "failed" ? (
          <div className="cvx-keywords">
            {items.map((item) => (
              <Badge key={item} variant="failed">
                {item}
              </Badge>
            ))}
          </div>
        ) : (
          <ul className="cvx-list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )
      ) : (
        <p className="cvx-empty-note">{empty}</p>
      )}
    </Card>
  );
}

function AnalysisFindings({ report }: { report: CvAnalysisReport }) {
  const cards = [
    {
      title: "Strengths",
      items: report.strengths,
      variant: "success" as const,
      empty: "None flagged.",
    },
    {
      title: "Weaknesses",
      items: report.weaknesses,
      variant: "review" as const,
      empty: "None flagged.",
    },
    {
      title: "Missing Keywords",
      items: report.missingKeywords,
      variant: "failed" as const,
      empty: "Nothing missing.",
    },
    {
      title: "Recommendations",
      items: report.recommendations,
      variant: "neutral" as const,
      ordered: true,
      empty: "None.",
    },
  ];
  return (
    <div className="cv-analysis-detail-grid">
      {cards.map((card) => (
        <FindingCard key={card.title} {...card} />
      ))}
    </div>
  );
}

function AnalysisReportHeader({
  report,
  scoreVariant,
}: {
  report: CvAnalysisReport;
  scoreVariant: StatusVariant;
}) {
  return (
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
  );
}

function AnalysisKpis({
  report,
  scoreVariant,
}: {
  report: CvAnalysisReport;
  scoreVariant: StatusVariant;
}) {
  return (
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
  );
}

function AnalysisSummary({ report }: { report: CvAnalysisReport }) {
  return (
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
  );
}

export function AnalysisReport({ report }: { report: CvAnalysisReport }) {
  const scoreVariant: StatusVariant =
    report.score !== null ? matchScoreVariant(report.score) : "neutral";
  return (
    <section className="cv-analysis-report" aria-label="Selected analysis report">
      <AnalysisReportHeader report={report} scoreVariant={scoreVariant} />
      <AnalysisKpis report={report} scoreVariant={scoreVariant} />
      <AnalysisScorecard report={report} />
      <AnalysisSummary report={report} />
      <AnalysisMetadata report={report} />
      <AnalysisFindings report={report} />
    </section>
  );
}
