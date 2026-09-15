import { create } from "zustand";
import type { AutomationState } from "../types/domain";
import { errMessage, invokeStrict } from "../lib/tauriInvoke";

interface AutomationStoreState {
  state: AutomationState;
  currentTaskId: string | null;
  /**
   * URL the automation is currently on, for the live browser preview in the
   * cockpit. Null until the automation engine actually drives a real browser
   * page (P2 - automation → ChromiumDriver) and emits its target here. While
   * null the Evidence Viewer shows its static placeholder.
   */
  watchUrl: string | null;
  /** Last command error, surfaced to the user. Null when the last call succeeded. */
  error: string | null;
  /**
   * Informational detail attached to the latest backend state (e.g. "No
   * applications are queued" on a Completed, or why a run Failed). Not an error
   * on its own - shown as context alongside the state.
   */
  detail: string | null;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  clearError: () => void;
  /**
   * Apply an authoritative `automation.state` event from the backend engine.
   * This is the ONLY path that advances the cockpit past the optimistic
   * "PreparingBrowser" ack - the backend drives the real lifecycle so the UI
   * can never lie about (or hang on) a state the engine isn't actually in.
   */
  applyServerState: (
    state: AutomationState,
    taskId: string | null,
    detail: string | null,
    watchUrl?: string | null,
  ) => void;
  /** Confirm a parked form submission (human-in-the-loop review). */
  confirmSubmit: () => Promise<void>;
  /** Reject and skip the parked form submission. */
  rejectSubmit: () => Promise<void>;
}

export const useAutomationStore = create<AutomationStoreState>((set) => ({
  state: "Queued",
  currentTaskId: null,
  watchUrl: null,
  error: null,
  detail: null,

  start: async () => {
    set({
      state: "PreparingBrowser",
      error: null,
      detail: null,
    });
    try {
      await invokeStrict<void>("automation_start");
    } catch (e) {
      set({ error: `Failed to start automation: ${errMessage(e)}` });
    }
  },

  pause: async () => {
    try {
      await invokeStrict<void>("automation_pause");
      set({ state: "PausedByUser", error: null });
    } catch (e) {
      set({ error: `Failed to pause automation: ${errMessage(e)}` });
    }
  },

  resume: async () => {
    try {
      await invokeStrict<void>("automation_resume");
      set({ state: "Searching", error: null });
    } catch (e) {
      set({ error: `Failed to resume automation: ${errMessage(e)}` });
    }
  },

  stop: async () => {
    try {
      await invokeStrict<void>("automation_stop");
      set({ state: "Stopped", error: null });
    } catch (e) {
      set({ error: `Failed to stop automation: ${errMessage(e)}` });
    }
  },

  applyServerState: (state, taskId, detail, watchUrl) =>
    set((prev) => {
      const isTerminal = state === "Completed" || state === "Failed" || state === "Stopped";
      return {
        state,
        detail,
        currentTaskId: taskId ?? (isTerminal ? null : prev.currentTaskId),
        watchUrl: watchUrl !== undefined ? watchUrl : prev.watchUrl,
      };
    }),

  clearError: () => set({ error: null }),

  confirmSubmit: async () => {
    try {
      await invokeStrict<void>("automation_confirm_submit");
    } catch (e) {
      set({ error: `Failed to confirm submission: ${errMessage(e)}` });
    }
  },

  rejectSubmit: async () => {
    try {
      await invokeStrict<void>("automation_reject_submit");
    } catch (e) {
      set({ error: `Failed to reject submission: ${errMessage(e)}` });
    }
  },
}));
