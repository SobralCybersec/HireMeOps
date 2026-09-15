import { create } from "zustand";

// ── Public state/action shape ─────────────────────────────────────────────────

export interface ApplicationDraftStoreState {
  /** UUID returned by `draft_application`; null until a draft succeeds. */
  draftId: string | null;
  /** True while the backend AI drafting call is in-flight. */
  isDrafting: boolean;
  /** True while the completed draft is being queued for automation. */
  isSubmitting: boolean;
  /** Application run created by `submit_application`; null until queued. */
  runId: string | null;
  /** Last command error; null when the last call succeeded or no call yet. */
  error: string | null;
  /**
   * Fire `draft_application` for the given `job_matches.id`.
   *
   * The backend composes a cover letter + form answers via the cached AI
   * provider and persists the result as an `application_drafts` row. This
   * action stores the returned draft UUID in `draftId`.
   *
   * Wire arg: `{ jobMatchId }` (camelCase - Tauri 2 default serialisation).
   */
  draft: (jobMatchId: string) => Promise<void>;
  /** Queue the current draft for the manual-assist automation flow. */
  submit: () => Promise<void>;
  /**
   * Reset `draftId`, `isDrafting`, and `error` to their initial values.
   * Called automatically when the modal closes; callers may also call it
   * explicitly to discard a previous result before re-opening.
   */
  clearDraft: () => void;
  /** Clear only the `error` field - keeps `draftId` in place. */
  clearError: () => void;
}

// ── Internal types ────────────────────────────────────────────────────────────

type InvokerFn = (command: string, args: Record<string, unknown>) => Promise<string>;

type ErrMsgFn = (error: unknown) => string;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Pure zustand factory - the only dependency is `zustand/create`.
 *
 * The production singleton wires this to Tauri's `invokeStrict`.
 * Tests should call `createApplicationDraftStore(mockFn, mockErrMsg)` directly;
 * this avoids importing the Tauri IPC stack (which requires a webview).
 */
export function createApplicationDraftStore(invoker: InvokerFn, errMsg: ErrMsgFn) {
  return create<ApplicationDraftStoreState>((set, get) => ({
    draftId: null,
    isDrafting: false,
    isSubmitting: false,
    runId: null,
    error: null,

    draft: async (jobMatchId) => {
      set({ isDrafting: true, error: null });
      try {
        const draftId = await invoker("draft_application", { jobMatchId });
        set({ draftId, isDrafting: false });
      } catch (e) {
        set({ error: errMsg(e), isDrafting: false });
      }
    },

    submit: async () => {
      const draftId = get().draftId;
      if (draftId === null) return;
      set({ isSubmitting: true, error: null });
      try {
        const runId = await invoker("submit_application", { applicationDraftId: draftId });
        set({ runId, isSubmitting: false });
      } catch (e) {
        set({ error: errMsg(e), isSubmitting: false });
      }
    },

    // Full reset - covers draftId, error, and any dangling isDrafting flag.
    clearDraft: () =>
      set({ draftId: null, isDrafting: false, isSubmitting: false, runId: null, error: null }),

    clearError: () => set({ error: null }),
  }));
}
