import type { AutomationState } from "../../types/domain";
import { Badge } from "./Badge";
import { StatusDot } from "./StatusDot";
import { automationVariant, humanizeStatus } from "./status";

interface AutomationStatusBadgeProps {
  state: AutomationState;
  /** Show the leading status dot. Default true. */
  showDot?: boolean;
  /** Render as a bare dot + label (no badge chip). */
  bare?: boolean;
}

/** Dot + labelled pill for the automation state machine. */
export function AutomationStatusBadge({ state, showDot = true, bare }: AutomationStatusBadgeProps) {
  const variant = automationVariant(state);
  const label = humanizeStatus(state);

  if (bare) {
    return (
      <span className="status-inline">
        {showDot && <StatusDot variant={variant} />}
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="status-inline">
      {showDot && <StatusDot variant={variant} />}
      <Badge variant={variant}>{label}</Badge>
    </span>
  );
}
