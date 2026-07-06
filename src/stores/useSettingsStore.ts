import { create } from "zustand";
import type { AppSettings } from "../types/settings";
import { safeInvoke } from "../lib/tauriInvoke";

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
    set({ settings: next });
    await safeInvoke<void>("update_settings", { settings: next });
  },
}));
