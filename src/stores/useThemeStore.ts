import { create } from "zustand";
import type { ReducedEffectsMode, ThemeMode } from "../types/settings";

interface ThemeStoreState {
  theme: ThemeMode;
  reducedEffects: ReducedEffectsMode;
  setTheme: (theme: ThemeMode) => void;
  setReducedEffects: (mode: ReducedEffectsMode) => void;
}

function wantsReducedEffects(mode: ReducedEffectsMode): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Resolve the stored ThemeMode to the concrete attribute value "dark" | "light".
 *  "system" follows prefers-color-scheme; exotic variants ("red", "solo-leveling")
 *  stay dark. */
function resolveTheme(theme: ThemeMode): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "system") {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

/** Applies [data-theme] + the `.reduced-effects` guard class to <html>.
 *  No-ops in SSR / test environments where document is unavailable. */
function applyThemeToDocument(theme: ThemeMode, reducedEffects: ReducedEffectsMode): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  document.documentElement.setAttribute("data-theme", resolved);
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
