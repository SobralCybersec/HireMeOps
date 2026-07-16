import { create } from "zustand";
import type { ReducedEffectsMode, ThemeMode } from "../types/settings";

interface ThemeStoreState {
  theme: ThemeMode;
  reducedEffects: ReducedEffectsMode;
  setTheme: (theme: ThemeMode) => void;
  setReducedEffects: (mode: ReducedEffectsMode) => void;
}

/** The concrete `[data-theme]` values that have a token block in theme.css. */
type ResolvedTheme = "dark" | "light" | "red" | "solo-leveling";

/**
 * Map the stored preference to the concrete `[data-theme]` value.
 * Named themes ("dark", "light", "red", "solo-leveling") pass through as-is;
 * only "system" resolves live against the OS color-scheme. color-scheme itself
 * is declared per token block in theme.css (all themes are dark-based except
 * "light"), so nothing to set here beyond the attribute.
 */
function resolveThemeAttr(theme: ThemeMode): ResolvedTheme {
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
  document.documentElement.setAttribute("data-theme", resolveThemeAttr(theme));
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
