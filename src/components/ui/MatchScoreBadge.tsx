import { Badge } from "./Badge";
import { matchScoreVariant } from "./status";

interface MatchScoreBadgeProps {
  /** 0–100, or null when a job hasn't been scored yet. */
  score: number | null;
}

/** Colour-graded match-score pill (strong / moderate / weak / poor). */
export function MatchScoreBadge({ score }: MatchScoreBadgeProps) {
  if (score === null) {
    return (
      <Badge variant="neutral" title="Not scored yet">
        —
      </Badge>
    );
  }
  return (
    <Badge variant={matchScoreVariant(score)} title={`Match score ${score}%`}>
      {score}%
    </Badge>
  );
}
