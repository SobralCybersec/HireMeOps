import { useState } from "react";

interface AnalysisResult {
  cvName: string;
  variantName: string;
  overallScore: number;
  atsScore: number;
  keywordMatch: number;
  strengths: string[];
  weaknesses: string[];
  missingKeywords: string[];
  recommendations: string[];
  provider: string;
  ranAt: string;
}

// Placeholder data – replace with real analysis store once wired
const MOCK_HISTORY: AnalysisResult[] = [
  {
    cvName:        "cv_rust_2025.pdf",
    variantName:   "Rust Systems",
    overallScore:  88,
    atsScore:      84,
    keywordMatch:  91,
    strengths:     ["Strong systems programming background", "Open-source contributions", "Relevant project experience"],
    weaknesses:    ["Limited cloud infrastructure experience", "No formal CS degree listed"],
    missingKeywords: ["Kubernetes", "gRPC", "distributed systems"],
    recommendations: [
      "Add Kubernetes experience (even personal cluster projects)",
      "Mention distributed systems coursework or self-study",
      "Lead with quantified impact statements",
    ],
    provider: "claude-sonnet-4-6",
    ranAt:    new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
];

const SCORE_COLORS: Record<string, string> = {
  high:   "var(--status-success-text)",
  mid:    "var(--status-review-text)",
  low:    "var(--status-failed-text)",
};

function scoreColor(n: number) {
  if (n >= 75) return SCORE_COLORS.high;
  if (n >= 50) return SCORE_COLORS.mid;
  return SCORE_COLORS.low;
}

export function CvAnalysis() {
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const result = MOCK_HISTORY[selectedIdx] ?? null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">CV Analysis</h1>
        <span className="page-subtitle">AI-powered match analysis</span>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="field" style={{ display: "inline-flex", flexDirection: "row", gap: "var(--sp-2)", alignItems: "center" }}>
          <label className="field__label" htmlFor="cv-sel" style={{ whiteSpace: "nowrap" }}>CV</label>
          <select id="cv-sel" className="field__select" style={{ width: 220 }}>
            <option>cv_rust_2025.pdf</option>
            <option>cv_fullstack_general.docx</option>
          </select>
        </div>
        <div className="field" style={{ display: "inline-flex", flexDirection: "row", gap: "var(--sp-2)", alignItems: "center" }}>
          <label className="field__label" htmlFor="var-sel" style={{ whiteSpace: "nowrap" }}>Variant</label>
          <select id="var-sel" className="field__select" style={{ width: 200 }}>
            <option>Rust Systems</option>
            <option>Java Backend</option>
            <option>Fullstack</option>
          </select>
        </div>
        <div className="toolbar-sep" />
        <button type="button" className="btn btn--primary" disabled>
          ▶ Run Analysis
        </button>
        <button type="button" className="btn btn--ghost" disabled>
          Compare
        </button>
        <button type="button" className="btn btn--ghost" disabled>
          Export JSON
        </button>
      </div>

      {result === null ? (
        <div className="empty-state">
          <div className="empty-state__label">No analysis</div>
          <p className="empty-state__title">Run your first analysis</p>
          <p className="empty-state__body">
            Select a CV and variant above, then press Run Analysis. Results will be stored in history.
          </p>
        </div>
      ) : (
        <>
          {/* Score tiles */}
          <div className="analysis-grid">
            {[
              { label: "Overall Score",  val: result.overallScore  },
              { label: "ATS Score",      val: result.atsScore      },
              { label: "Keyword Match",  val: result.keywordMatch  },
            ].map(({ label, val }) => (
              <div key={label} className="stat-tile">
                <span className="stat-tile__label">{label}</span>
                <span className="stat-tile__value" style={{ color: scoreColor(val) }}>
                  {val}
                  <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--fw-regular)" }}>%</span>
                </span>
                <div className="score-bar" style={{ marginTop: 4 }}>
                  <div
                    className="score-bar__fill"
                    style={{ width: `${val}%`, background: scoreColor(val) }}
                    role="progressbar"
                    aria-valuenow={val}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Meta */}
          <div style={{ display: "flex", gap: "var(--sp-4)", font: "var(--text-xs)/1.5 var(--font-mono)", color: "var(--color-text-muted)" }}>
            <span>CV: <strong style={{ color: "var(--color-text-2)" }}>{result.cvName}</strong></span>
            <span>Variant: <strong style={{ color: "var(--color-text-2)" }}>{result.variantName}</strong></span>
            <span>Provider: <strong style={{ color: "var(--color-text-2)" }}>{result.provider}</strong></span>
            <span>Run: <time dateTime={result.ranAt}>{new Date(result.ranAt).toLocaleString()}</time></span>
          </div>

          {/* Detail cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Strengths</h2>
                <span className="badge badge--success">{result.strengths.length}</span>
              </div>
              <div className="card__body">
                <ul style={{ margin: 0, paddingLeft: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                  {result.strengths.map((s) => (
                    <li key={s} style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)" }}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Weaknesses</h2>
                <span className="badge badge--review">{result.weaknesses.length}</span>
              </div>
              <div className="card__body">
                <ul style={{ margin: 0, paddingLeft: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                  {result.weaknesses.map((w) => (
                    <li key={w} style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)" }}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Missing Keywords</h2>
                <span className="badge badge--failed">{result.missingKeywords.length}</span>
              </div>
              <div className="card__body">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                  {result.missingKeywords.map((kw) => (
                    <span key={kw} className="badge badge--failed">{kw}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card__header">
                <h2 className="card__title">Recommendations</h2>
                <span className="badge badge--neutral">{result.recommendations.length}</span>
              </div>
              <div className="card__body">
                <ol style={{ margin: 0, paddingLeft: "var(--sp-5)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {result.recommendations.map((r) => (
                    <li key={r} style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)" }}>{r}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          {/* History */}
          {MOCK_HISTORY.length > 1 && (
            <div className="section-group">
              <h2 className="section-title">Analysis History</h2>
              <div className="table-wrapper">
                <table className="data-table" aria-label="Analysis history">
                  <thead>
                    <tr>
                      <th>CV</th>
                      <th>Variant</th>
                      <th>Score</th>
                      <th>Provider</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MOCK_HISTORY.map((h, i) => (
                      <tr
                        key={i}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelectedIdx(i)}
                        aria-selected={selectedIdx === i}
                      >
                        <td className="cell-primary">{h.cvName}</td>
                        <td>{h.variantName}</td>
                        <td className="cell-mono" style={{ color: scoreColor(h.overallScore) }}>
                          {h.overallScore}%
                        </td>
                        <td className="cell-mono">{h.provider}</td>
                        <td className="cell-mono">{new Date(h.ranAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
