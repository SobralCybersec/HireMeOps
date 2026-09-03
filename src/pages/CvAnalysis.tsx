import { useNavigate } from "react-router-dom";
import { AnalysisPageBody } from "./cv/AnalysisPageBody";
import { useCvAnalysisWorkspace } from "./cv/useCvAnalysisWorkspace";
import { useSettingsStore } from "../stores/useSettingsStore";
import "./cv/cv.css";
import "./cv/analysis.css";

function AnalysisHero() {
  return (
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
          Turn your stored CV into a focused match report. See what lands, what is missing, and what
          to improve before you apply.
        </p>
      </div>
      <div className="cv-analysis-hero__mark" aria-hidden="true">
        <span className="cv-analysis-hero__mark-core">CV</span>
      </div>
    </header>
  );
}

export function CvAnalysis() {
  const navigate = useNavigate();
  const activeProfileId = useSettingsStore((s) => s.settings?.activeProfileId ?? null);
  const workspace = useCvAnalysisWorkspace(activeProfileId);
  return (
    <div className="page cv-analysis-page">
      <AnalysisHero />
      <AnalysisPageBody
        {...workspace}
        onRetry={workspace.retry}
        onOpenLibrary={() => navigate("/cv-library")}
        onCvChange={workspace.setSelectedCvId}
        onRun={() => void workspace.handleRun()}
        onSelectReport={workspace.setSelectedReportId}
      />
    </div>
  );
}
