import { create } from "zustand";
import type { AutomationState } from "../types/domain";
import { safeInvoke } from "../lib/tauriInvoke";

interface AutomationStoreState {
  state: AutomationState;
  currentTaskId: string | null;
  isEmergencyStopped: boolean;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  emergencyStop: () => Promise<void>;
}

export const useAutomationStore = create<AutomationStoreState>((set) => ({
  state: "Queued",
  currentTaskId: null,
  isEmergencyStopped: false,

  start: async () => {
    await safeInvoke<void>("automation_start");
    set({ state: "PreparingBrowser", isEmergencyStopped: false });
  },

  pause: async () => {
    await safeInvoke<void>("automation_pause");
    set({ state: "PausedByUser" });
  },

  resume: async () => {
    await safeInvoke<void>("automation_resume");
    set({ state: "Searching" });
  },

  stop: async () => {
    await safeInvoke<void>("automation_stop");
    set({ state: "Stopped" });
  },

  // Always wins over any other in-flight transition. Bound to
  // EmergencyStopButton's click handler AND its global hotkey.
  emergencyStop: async () => {
    await safeInvoke<void>("automation_emergency_stop");
    set({ state: "Stopped", isEmergencyStopped: true, currentTaskId: null });
  },
}));
