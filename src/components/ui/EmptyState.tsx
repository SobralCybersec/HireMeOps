import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Short uppercase eyebrow (e.g. "Quiet", "Select"). */
  label?: string;
  title: ReactNode;
  body?: ReactNode;
  /** Optional call-to-action row (buttons). */
  action?: ReactNode;
}

/** Centered placeholder for empty panels/lists. Wraps `.empty-state`. */
export function EmptyState({ label, title, body, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {label && <div className="empty-state__label">{label}</div>}
      <p className="empty-state__title">{title}</p>
      {body != null && <p className="empty-state__body">{body}</p>}
      {action}
    </div>
  );
}
