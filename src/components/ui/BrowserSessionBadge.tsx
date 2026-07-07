import { StatusDot } from "./StatusDot";
import type { StatusVariant } from "./status";

export type SessionStatus = "connected" | "disconnected" | "launching" | "unknown";

interface BrowserSessionBadgeProps {
  /** Session state. Defaults to "unknown" until the backend reports one. */
  status?: SessionStatus;
  /** Chip label, e.g. "Browser" or "LinkedIn". */
  label: string;
  /** Optional detail appended after the status word (profile name, account). */
  detail?: string;
}

const VARIANT: Record<SessionStatus, StatusVariant> = {
  connected: "success",
  launching: "running",
  disconnected: "failed",
  unknown: "neutral",
};

const WORD: Record<SessionStatus, string> = {
  connected: "connected",
  launching: "launching",
  disconnected: "offline",
  unknown: "—",
};

/**
 * Read-only session indicator for the command bar (browser / LinkedIn).
 * Presentational: pass `status` from the relevant store once wired.
 */
export function BrowserSessionBadge({ status = "unknown", label, detail }: BrowserSessionBadgeProps) {
  const text = detail ?? WORD[status];
  return (
    <span className="topbar-chip" title={`${label}: ${WORD[status]}${detail ? ` (${detail})` : ""}`}>
      <StatusDot variant={VARIANT[status]} size={6} />
      <span className="topbar-chip__key">{label}</span>
      <span className="topbar-chip__val">{text}</span>
    </span>
  );
}
