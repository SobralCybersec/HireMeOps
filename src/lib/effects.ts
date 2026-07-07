// Reduced-effects abstraction.
//
// Two layers cooperate:
//   1. CSS  — useThemeStore toggles the `.reduced-effects` class on <html>,
//             which neutralises all transitions/animations globally.
//   2. JS   — this hook lets components branch in logic (skip a JS-driven
//             animation, render a static value, avoid scroll-jank work).
//
// Both resolve the same way: mode "on"/"off" wins; "auto" follows the OS
// `prefers-reduced-motion` setting (live, via matchMedia subscription).

import { useSyncExternalStore } from "react";
import { useThemeStore } from "../stores/useThemeStore";
import type { ReducedEffectsMode } from "../types/settings";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

/** Pure resolver — handy outside React (e.g. one-off imperative code). */
export function resolveReducedEffects(mode: ReducedEffectsMode): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return prefersReducedMotion();
}

function subscribeMedia(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(MEDIA_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * `true` when motion should be suppressed. Re-renders on both the user's
 * setting (zustand) and live OS `prefers-reduced-motion` changes.
 */
export function useReducedEffects(): boolean {
  const mode = useThemeStore((s) => s.reducedEffects);
  const osReduced = useSyncExternalStore(subscribeMedia, prefersReducedMotion, () => false);
  if (mode === "on") return true;
  if (mode === "off") return false;
  return osReduced;
}

/**
 * Pick between an animated value and a static fallback based on the current
 * reduced-effects state. Keeps call sites terse:
 *
 *   const reduce = useReducedEffects();
 *   style={{ transition: motionSafe(reduce, "opacity 200ms", "none") }}
 */
export function motionSafe<T>(reduced: boolean, animated: T, fallback: T): T {
  return reduced ? fallback : animated;
}
