import { create } from "zustand";
import type { AppSettings } from "../types/settings";
import { errMessage, invokeStrict, safeInvoke } from "../lib/tauriInvoke";

interface SettingsStoreState {
  settings: AppSettings | null;
  isLoading: boolean;
  error: string | null;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: null,
  isLoading: false,
  error: null,

  loadSettings: async () => {
    set({ isLoading: true, error: null });
    const settings = await safeInvoke<AppSettings>("get_settings");
    if (settings) {
      set({ settings, isLoading: false });
    } else {
      set({
        isLoading: false,
        error: "Could not load settings (backend command not available yet).",
      });
    }
  },

  updateSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next: AppSettings = { ...current, ...patch };
    // Optimistic: reflect immediately, but roll back if the write fails so the
    // in-memory store never silently diverges from what was actually persisted.
    set({ settings: next, error: null });
    try {
      await invokeStrict<void>("update_settings", { settings: next });
    } catch (e) {
      set({ settings: current, error: `Failed to save settings: ${errMessage(e)}` });
    }
  },
}));
