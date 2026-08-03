// Animated number roll-up for KPI / stat values.
//
// Uses anime.js to tween a plain JS object from 0 → target, updating
// React state on each frame. Respects reduced-effects: when disabled,
// returns the target value immediately (no animation, no extra renders).
//
// ponytail: one hook, no abstraction. Upgrade path: add easing/format
// options if needed.

import { useState, useEffect, useRef } from "react";
import { animate } from "animejs";
import { useReducedEffects } from "./effects";

/**
 * Animate a number from 0 to `target` on mount / when `target` changes.
 * Returns the current displayed value (integer).
 */
export function useCountUp(target: number, duration = 600): number {
  const reduced = useReducedEffects();
  const [display, setDisplay] = useState(reduced ? target : 0);
  const prevTarget = useRef(target);

  useEffect(() => {
    if (reduced) {
      setDisplay(target);
      return;
    }

    // Only animate when target actually changes
    const from = prevTarget.current === target ? 0 : prevTarget.current;
    prevTarget.current = target;

    const obj = { val: from };
    const anim = animate(obj, {
      val: target,
      duration,
      ease: "outExpo",
      onUpdate: () => setDisplay(Math.round(obj.val)),
    });

    return () => {
      anim.revert();
    };
  }, [target, duration, reduced]);

  return display;
}
