import { create } from "zustand";
import type { ReducedEffectsMode, ThemeMode } from "../types/settings";

interface ThemeStoreState {
  theme: ThemeMode;
  reducedEffects: ReducedEffectsMode;
  setTheme: (theme: ThemeMode) => void;
  setReducedEffects: (mode: ReducedEffectsMode) => void;
}

function resolveDarkOrLight(theme: ThemeMode): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function wantsReducedEffects(mode: ReducedEffectsMode): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Applies [data-theme] + the `.reduced-effects` guard class to <html>. */
function applyThemeToDocument(theme: ThemeMode, reducedEffects: ReducedEffectsMode): void {
  document.documentElement.setAttribute("data-theme", resolveDarkOrLight(theme));
  document.documentElement.classList.toggle("reduced-effects", wantsReducedEffects(reducedEffects));
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  theme: "dark",
  reducedEffects: "auto",

  setTheme: (theme) => {
    set({ theme });
    applyThemeToDocument(theme, get().reducedEffects);
  },

  setReducedEffects: (reducedEffects) => {
    set({ reducedEffects });
    applyThemeToDocument(get().theme, reducedEffects);
  },
}));

// Apply the default (dark, auto-reduced-effects) immediately so there is no
// flash of unstyled/default browser theme before useSettingsStore resolves.
applyThemeToDocument(useThemeStore.getState().theme, useThemeStore.getState().reducedEffects);
