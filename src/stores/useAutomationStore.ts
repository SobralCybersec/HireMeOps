import { create } from "zustand";
import type { AutomationState } from "../types/domain";
import { errMessage, invokeStrict } from "../lib/tauriInvoke";

interface AutomationStoreState {
  state: AutomationState;
  currentTaskId: string | null;
  isEmergencyStopped: boolean;
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
  emergencyStop: () => Promise<void>;
  clearError: () => void;
  /**
   * Apply an authoritative `automation.state` event from the backend engine.
   * This is the ONLY path that advances the cockpit past the optimistic
   * "PreparingBrowser" ack - the backend drives the real lifecycle so the UI
   * can never lie about (or hang on) a state the engine isn't actually in.
   */
  applyServerState: (state: AutomationState, taskId: string | null, detail: string | null, watchUrl?: string | null) => void;
  /** Confirm a parked form submission (human-in-the-loop review). */
  confirmSubmit: () => Promise<void>;
  /** Reject and skip the parked form submission. */
  rejectSubmit: () => Promise<void>;
}

export const useAutomationStore = create<AutomationStoreState>((set) => ({
  state: "Queued",
  currentTaskId: null,
  isEmergencyStopped: false,
  watchUrl: null,
  error: null,
  detail: null,

  // NOTE: the command handlers below only ever set the OPTIMISTIC ack state
  // (e.g. "PreparingBrowser") once the backend accepts the command. The real
  // lifecycle - PreparingBrowser → Searching → ... → Completed/Failed/Stopped -
  // is driven exclusively by `applyServerState`, fed from the backend's
  // `automation.state` events. This split is the whole fix for the stuck
  // "Preparing Browser" bug: the UI acks the click, then follows the engine.
  start: async () => {
    // Paint the optimistic ack BEFORE awaiting the command. The backend emits
    // its authoritative `automation.state` events (PreparingBrowser →...→
    // Completed/Failed) while this invoke is in flight, and the feature-off
    // engine reaches a terminal state in microseconds. If we set the optimistic
    // ack *after* the await, that late set clobbers the terminal state the
    // events already applied - wedging the cockpit at "PreparingBrowser" with a
    // null detail forever. Setting it first lets every backend event win.
    set({
      state: "PreparingBrowser",
      isEmergencyStopped: false,
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

  // Always wins over any other in-flight transition. Bound to
  // EmergencyStopButton's click handler AND its global hotkey.
  //
  // SAFETY-CRITICAL: we must NOT paint the UI "Stopped" unless the backend
  // confirms the stop. A failed emergency stop that showed "Stopped" would be
  // a dangerous lie (automation still running). On failure we keep the prior
  // state and raise a loud error so the operator knows to intervene.
  emergencyStop: async () => {
    try {
      await invokeStrict<void>("automation_emergency_stop");
      set({
        state: "Stopped",
        isEmergencyStopped: true,
        currentTaskId: null,
        error: null,
        detail: null,
      });
    } catch (e) {
      set({
        error: `EMERGENCY STOP FAILED - automation may still be running. ${errMessage(e)}`,
      });
    }
  },

  // Authoritative lifecycle transition, driven by the backend engine's
  // `automation.state` events. Unlike the command handlers this NEVER guesses -
  // it reflects exactly what the engine reports. A terminal state
  // (Completed/Failed/Stopped) clears the task binding; an emergency-stopped
  // run is left latched so the cockpit stays disabled until the operator acts.
  applyServerState: (state, taskId, detail, watchUrl) =>
    set((prev) => {
      const isTerminal = state === "Completed" || state === "Failed" || state === "Stopped";
      return {
        state,
        detail,
        currentTaskId: taskId ?? (isTerminal ? null : prev.currentTaskId),
        isEmergencyStopped: state === "Stopped" ? false : prev.isEmergencyStopped,
        // Keep the last live URL so the Cockpit shows where the run ended.
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
