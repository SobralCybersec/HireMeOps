import { useEffect, useRef } from "react";
import { useApplicationDraftStore } from "../stores/useApplicationDraftStore";
import { Button, EmptyState } from "./ui";
import "./ApplicationDraftModal.css";

// ── Props ─────────────────────────────────────────────────────────────────────

/**
 * Props for `ApplicationDraftModal`.
 *
 * Orchestrator wiring:
 *   - In JobSearch: pass the selected row's `job_matches.id` and toggle `open`
 *     from the "Draft" / "Queue" button on a scored match card.
 *   - In ApplicationsQueue: pass the row's `match_id` and toggle `open` from
 *     a "Re-draft" or "Prepare" action on a queued item.
 *
 * Example:
 *   <ApplicationDraftModal
 *     jobMatchId={selectedMatchId}
 *     open={draftModalOpen}
 *     onClose={() => setDraftModalOpen(false)}
 *   />
 */
export interface ApplicationDraftModalProps {
  /**
   * The `job_matches.id` to draft for.  The modal auto-fires `draft_application`
   * as soon as it opens with a non-null value.  Pass `null` to keep the modal
   * mounted but inert (e.g. before the user selects a row).
   */
  jobMatchId: string | null;
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Modal that triggers `draft_application` on the backend and reports the
 * resulting draft UUID.
 *
 * The backend persists a full `application_drafts` row (cover letter +
 * form answers + AI summary) - but there is no frontend read-back command, so
 * only the UUID is surfaced here.  Users proceed to Applications Queue to
 * review and submit.
 *
 * Renders a native `<dialog>` - no extra dependencies, keyboard/focus
 * management is handled by the browser.  CSS lives under `.application-draft-modal`.
 */
export function ApplicationDraftModal({ jobMatchId, open, onClose }: ApplicationDraftModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const draftId = useApplicationDraftStore((s) => s.draftId);
  const isDrafting = useApplicationDraftStore((s) => s.isDrafting);
  const isSubmitting = useApplicationDraftStore((s) => s.isSubmitting);
  const runId = useApplicationDraftStore((s) => s.runId);
  const error = useApplicationDraftStore((s) => s.error);
  const draft = useApplicationDraftStore((s) => s.draft);
  const submit = useApplicationDraftStore((s) => s.submit);
  const clearDraft = useApplicationDraftStore((s) => s.clearDraft);

  // Tracks which jobMatchId we have already fired a draft for in this open
  // session, so we never double-submit (e.g. on parent re-render).
  const lastDraftedRef = useRef<string | null>(null);

  // ── 1. Sync native <dialog> visibility with the `open` prop ──────────────
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  // ── 2. Clear store state (+ draft-trigger guard) when the modal closes ────
  useEffect(() => {
    if (!open) {
      lastDraftedRef.current = null;
      clearDraft();
    }
  }, [open, clearDraft]);

  // ── 3. Auto-fire the draft exactly once per (open + jobMatchId) pair ──────
  useEffect(() => {
    if (!open || !jobMatchId) return;
    if (lastDraftedRef.current === jobMatchId) return;
    lastDraftedRef.current = jobMatchId;
    void draft(jobMatchId);
  }, [open, jobMatchId, draft]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRetry = () => {
    if (draftId !== null) {
      void submit();
      return;
    }
    // Reset the guard so the next effect run re-triggers the draft.
    lastDraftedRef.current = null;
    // `draft()` opens with set({ isDrafting: true, error: null }), so no
    // explicit clearError() is needed before calling it.
    if (jobMatchId) void draft(jobMatchId);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // ponytail: inline token styles - theme.css has no .application-draft-modal
  // rules and this lane can't add any (co-located ApplicationDraftModal.css
  // carries only what inline styles can't do: keyframes + ::backdrop).
  // Sizing/padding/colour still route through design tokens (var(--...)); the
  // only raw values are the responsive clamps for width/height.
  const dialogStyle: React.CSSProperties = {
    width: "min(720px, 92vw)",
    maxWidth: "min(720px, 92vw)",
    maxHeight: "min(640px, 90dvh)",
    padding: 0,
    // Gate `display` on `open`. A native <dialog> is hidden by the UA rule
    // `dialog:not([open]) { display: none }`, but an author *inline* style has
    // higher origin/specificity and would override it - so an unconditional
    // `display: flex` leaves the CLOSED dialog rendered in normal page flow
    // (the "Draft Application" card leaks onto JobSearch/ApplicationsQueue).
    // Mirror the UA behaviour: flex column layout only while open, else none.
    display: open ? "flex" : "none",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    background: "var(--color-surface-2, var(--color-surface-1))",
    color: "var(--color-text-1)",
    boxShadow: "var(--shadow-1)",
  };
  const innerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    gap: "var(--sp-3)",
    padding: "var(--sp-4)",
  };
  const bodyStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--sp-3)",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  };

  return (
    // onClose fires on native dialog close (Escape key) - delegates to parent.
    <dialog
      ref={dialogRef}
      className="application-draft-modal"
      aria-labelledby="adm-title"
      onClose={() => onClose()}
      style={dialogStyle}
    >
      <div className="application-draft-modal__inner" style={innerStyle}>
        <h2
          id="adm-title"
          className="application-draft-modal__title"
          style={{ margin: 0, flexShrink: 0 }}
        >
          Draft Application
        </h2>

        <div className="application-draft-modal__body" style={bodyStyle}>
          {/* ── Loading ─────────────────────────────────────────────── */}
          {isDrafting && (
            <EmptyState
              label="Working"
              title="Generating your draft..."
              body="The AI is composing your cover letter and form answers. This may take a moment."
            />
          )}

          {/* ── Error ───────────────────────────────────────────────── */}
          {!isDrafting && error !== null && (
            <EmptyState
              label="Error"
              title="Application action failed"
              body={error}
              action={
                <div
                  className="application-draft-modal__actions"
                  style={{
                    display: "flex",
                    gap: "var(--sp-2)",
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <Button variant="primary" onClick={handleRetry}>
                    Retry
                  </Button>
                  <Button variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              }
            />
          )}

          {/* ── Success ─────────────────────────────────────────────── */}
          {!isDrafting && error === null && draftId !== null && (
            <>
              <EmptyState
                label={runId === null ? "Ready" : "Queued"}
                title={runId === null ? "Draft created" : "Automation task queued"}
                body={
                  runId === null
                    ? "Your draft is saved. Queue it to open the job in the manual-assist browser flow."
                    : "Start or resume Automation to process this application. Final submission still requires your review."
                }
              />
              <p
                className="application-draft-modal__id"
                aria-label="Draft ID"
                style={{
                  margin: 0,
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-2)",
                  wordBreak: "break-all",
                }}
              >
                Draft ID: <code>{draftId}</code>
              </p>
              {runId !== null && (
                <p
                  className="application-draft-modal__id"
                  aria-label="Run ID"
                  style={{ margin: 0 }}
                >
                  Run ID: <code>{runId}</code>
                </p>
              )}
            </>
          )}

          {/* ── Idle (guard for unexpected state) ───────────────────── */}
          {!isDrafting && error === null && draftId === null && (
            <EmptyState
              label="Idle"
              title="No draft in progress"
              body="Close this dialog and try again."
            />
          )}
        </div>

        {/* Footer - hidden in error state (error provides its own Cancel). */}
        {(isDrafting || error === null) && (
          <div
            className="application-draft-modal__footer"
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              flexShrink: 0,
              paddingTop: "var(--sp-2)",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            {draftId !== null && runId === null && (
              <Button variant="primary" onClick={() => void submit()} disabled={isSubmitting}>
                {isSubmitting ? "Queuing..." : "Queue for automation"}
              </Button>
            )}
            <Button
              variant={runId !== null ? "primary" : "ghost"}
              onClick={onClose}
              disabled={isDrafting || isSubmitting}
            >
              {draftId !== null ? "Close" : "Cancel"}
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}
