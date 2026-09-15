import { useEffect, useRef } from "react";
import { useApplicationDraftStore } from "../stores/useApplicationDraftStore";
import { ApplicationDraftModalView } from "./ApplicationDraftModalView";
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

  return (
    <ApplicationDraftModalView
      dialogRef={dialogRef}
      open={open}
      isDrafting={isDrafting}
      isSubmitting={isSubmitting}
      error={error}
      draftId={draftId}
      runId={runId}
      onRetry={handleRetry}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}
