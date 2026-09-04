import { createPortal } from "react-dom";
import { Badge, ScoreBar } from "../../components/ui";
import { matchScoreVariant } from "../../components/ui/status";
import { formatBytes, relativeTime } from "./mockData";
import type { CvLibraryDoc } from "./types";

interface CvCardDetailsProps {
  cv: CvLibraryDoc;
}

export function CvCardDetails({ cv }: CvCardDetailsProps) {
  return (
    <>
      <div className="cv-card__name" title={cv.fileName}>
        {cv.fileName}
      </div>
      <div className="cv-card__meta">
        <Badge variant="neutral">{cv.fileType.toUpperCase()}</Badge>
        {cv.isActive && <Badge variant="success">Active</Badge>}
      </div>
      {cv.assignedVariants.length > 0 && (
        <div className="cvx-variants" aria-label="Assigned variants">
          {cv.assignedVariants.map((variant) => (
            <span key={variant.id} className="tag cvx-variant">
              {variant.name}
            </span>
          ))}
        </div>
      )}
      {cv.lastAnalysisScore !== null && (
        <ScoreBar
          label="Score"
          value={cv.lastAnalysisScore}
          variant={matchScoreVariant(cv.lastAnalysisScore)}
        />
      )}
      <div className="cvx-card__foot">
        <span>{formatBytes(cv.sizeBytes)}</span>
        <span title={cv.lastUsedAt ?? "never used"}>used {relativeTime(cv.lastUsedAt)}</span>
      </div>
    </>
  );
}

interface CvCardPeekProps {
  peek: { left: number; top: number; src: string } | null;
  reduce: boolean;
}

export function CvCardPeek({ peek, reduce }: CvCardPeekProps) {
  if (!peek) return null;
  return createPortal(
    <div
      className="cvx-peek overlay-surface"
      style={{ left: peek.left, top: peek.top, width: 480, opacity: reduce ? 1 : undefined }}
      role="presentation"
    >
      <img className="cvx-peek__img" src={peek.src} alt="" />
    </div>,
    document.body,
  );
}
