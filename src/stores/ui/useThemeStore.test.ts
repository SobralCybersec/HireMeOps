// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeStore } from "./useThemeStore";

function setMedia({ reduced = false, dark = false } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") ? reduced : dark,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  setMedia();
  useThemeStore.setState({ theme: "dark", reducedEffects: "auto" });
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
});

describe("useThemeStore", () => {
  it("applies explicit light/dark themes and reduced-effects modes", () => {
    useThemeStore.getState().setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    useThemeStore.getState().setReducedEffects("on");
    expect(document.documentElement.classList.contains("reduced-effects")).toBe(true);
    useThemeStore.getState().setReducedEffects("off");
    expect(document.documentElement.classList.contains("reduced-effects")).toBe(false);

    useThemeStore.getState().setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows system preferences and handles missing browser media APIs", () => {
    setMedia({ reduced: true, dark: false });
    useThemeStore.getState().setTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    useThemeStore.getState().setReducedEffects("auto");
    expect(document.documentElement.classList.contains("reduced-effects")).toBe(true);

    vi.stubGlobal("matchMedia", undefined);
    useThemeStore.getState().setTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    useThemeStore.getState().setReducedEffects("auto");
    expect(document.documentElement.classList.contains("reduced-effects")).toBe(false);
  });
});
