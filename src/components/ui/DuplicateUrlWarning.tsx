interface DuplicateUrlWarningProps {
  url: string;
  /** Optional explanatory lead-in. */
  message?: string;
  onDismiss?: () => void;
}

/**
 * Inline notice shown when a job/application URL was already seen and skipped.
 * Uses the "review" warning treatment from theme.css.
 */
export function DuplicateUrlWarning({
  url,
  message = "This URL was already processed and skipped as a duplicate.",
  onDismiss,
}: DuplicateUrlWarningProps) {
  return (
    <div className="inline-warning" role="status">
      <div className="inline-warning__body">
        <div>{message}</div>
        <div className="inline-warning__url">{url}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          className="inline-warning__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss duplicate URL notice"
        >
          ✕
        </button>
      )}
    </div>
  );
}
