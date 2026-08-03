// anime.js v4 React integration hook.
//
// Wraps createScope for automatic selector scoping + unmount cleanup.
// Respects the app's reduced-effects system (useReducedEffects) so all
// anime.js animations fully disable under prefers-reduced-motion or
// the manual FX:on toggle.
//
// Usage:
//   const root = useRef<HTMLDivElement>(null);
//   useAnime(root, (scope) => {
//     animate('.item', { opacity: [0, 1], translateY: [8, 0], delay: stagger(40) });
//   }, [deps]);

import { useRef, useEffect } from "react";
import { createScope } from "animejs";
import type { Scope } from "animejs";
import { useReducedEffects } from "./effects";

/**
 * Scoped anime.js animation hook with reduced-effects guard.
 *
 * - `rootRef`: ref to the DOM element that scopes CSS selectors.
 * - `setup`: callback that runs inside the scope. Call `animate()`,
 *   `createTimeline()`, etc. - CSS selectors resolve within `root`.
 * - `deps`: re-run the animation when these change (like useEffect deps).
 *
 * When reduced-effects is active, the setup callback never fires and
 * any existing scope is reverted immediately.
 */
export function useAnime(
  rootRef: React.RefObject<HTMLElement | null>,
  setup: () => void,
  deps: React.DependencyList = [],
): void {
  const reduced = useReducedEffects();
  const scopeRef = useRef<Scope | null>(null);

  useEffect(() => {
    if (reduced || !rootRef.current) {
      // Clean up any previous scope when effects become disabled
      scopeRef.current?.revert();
      scopeRef.current = null;
      return;
    }

    const scope = createScope({ root: rootRef.current }).add(setup);
    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, ...deps]);
}
