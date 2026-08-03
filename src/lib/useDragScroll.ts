import { useEffect, type RefObject } from "react";

// Phone-like click-and-drag panning for the workspace subtree.
//
// Mounted once from AppLayout against the `.app-main` root. A pointerdown that
// lands on non-interactive content grabs the nearest scrollable ancestor and
// pans it 1:1 with pointer movement; a flick releases into a decaying glide
// (skipped entirely under reduced-motion). Native wheel, keyboard, and touch
// scrolling are untouched - we never preventDefault on wheel and bail on
// `pointerType === "touch"` so the browser keeps its own kinetic scroll.

// Elements (and their subtrees) that must keep their default click behaviour -
// a drag starting here would hijack a button press, link, text selection in a
// field, or a native <dialog> (the ApplicationDraftModal).
const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, label, [role="button"], [role="switch"], [contenteditable], .switch, dialog';

// Pixels the pointer must travel before a press becomes a pan. Below this a
// click is left completely alone.
const DRAG_THRESHOLD = 5;

// Momentum: per-frame velocity decay and the floor at which the glide stops.
const FRICTION = 0.94;
const MIN_VELOCITY = 0.05; // px/ms
const FRAME_MS = 16;

function isScrollable(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const scrollableY =
    el.scrollHeight > el.clientHeight &&
    (style.overflowY === "auto" || style.overflowY === "scroll");
  const scrollableX =
    el.scrollWidth > el.clientWidth && (style.overflowX === "auto" || style.overflowX === "scroll");
  return scrollableY || scrollableX;
}

function findScrollable(start: Element | null, root: Element): HTMLElement | null {
  let node: Element | null = start;
  while (node) {
    if (node instanceof HTMLElement && isScrollable(node)) return node;
    if (node === root) break;
    node = node.parentElement;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    document.documentElement.classList.contains("reduced-effects") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useDragScroll(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Live drag state, reset on every fresh pointerdown.
    let scroller: HTMLElement | null = null;
    let panning = false; // crossed the threshold - now stealing scroll
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    // Velocity sampling for the release glide.
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let vx = 0;
    let vy = 0;
    let momentumRaf = 0;
    let glideScroller: HTMLElement | null = null;

    function stopMomentum() {
      if (momentumRaf) {
        cancelAnimationFrame(momentumRaf);
        momentumRaf = 0;
      }
    }

    function glide() {
      momentumRaf = requestAnimationFrame(() => {
        if (!glideScroller) return;
        glideScroller.scrollLeft -= vx * FRAME_MS;
        glideScroller.scrollTop -= vy * FRAME_MS;
        vx *= FRICTION;
        vy *= FRICTION;
        if (Math.abs(vx) > MIN_VELOCITY || Math.abs(vy) > MIN_VELOCITY) {
          glide();
        } else {
          momentumRaf = 0;
        }
      });
    }

    function teardownDrag() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    }

    function onPointerDown(e: PointerEvent) {
      // Left button only; touch keeps native kinetic scroll; interactive
      // targets and dialogs are off-limits.
      if (e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as Element | null;
      if (!target || target.closest(INTERACTIVE_SELECTOR)) return;

      const hit = findScrollable(target, root!);
      if (!hit) return;

      stopMomentum();
      scroller = hit;
      panning = false;
      pointerId = e.pointerId;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      startScrollLeft = hit.scrollLeft;
      startScrollTop = hit.scrollTop;
      lastT = e.timeStamp;
      vx = vy = 0;

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(e: PointerEvent) {
      if (!scroller) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!panning) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        panning = true;
        try {
          root!.setPointerCapture(pointerId);
        } catch {
          /* capture is best-effort; window listeners still deliver moves */
        }
        document.documentElement.classList.add("is-dragscroll");
      }

      // Pan 1:1 with the pointer.
      e.preventDefault();
      scroller.scrollLeft = startScrollLeft - dx;
      scroller.scrollTop = startScrollTop - dy;

      // Sample instantaneous velocity for the release glide.
      const dt = e.timeStamp - lastT;
      if (dt > 0) {
        vx = (e.clientX - lastX) / dt;
        vy = (e.clientY - lastY) / dt;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = e.timeStamp;
    }

    function onPointerUp() {
      teardownDrag();
      try {
        root!.releasePointerCapture(pointerId);
      } catch {
        /* nothing captured */
      }

      if (panning) {
        // Swallow the click that a real mouseup synthesizes after a drag so a
        // pan that ends over a card/row doesn't also trigger its onClick.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener("click", swallow, true);
        };
        window.addEventListener("click", swallow, true);
        // If no click follows (drag ended over empty space), drop the guard.
        setTimeout(() => window.removeEventListener("click", swallow, true), 0);

        // Release into a glide unless the pointer stopped or motion is off.
        if (
          scroller &&
          !prefersReducedMotion() &&
          (Math.abs(vx) > MIN_VELOCITY || Math.abs(vy) > MIN_VELOCITY)
        ) {
          glideScroller = scroller;
          glide();
        }
      }

      document.documentElement.classList.remove("is-dragscroll");
      scroller = null;
      panning = false;
    }

    root.addEventListener("pointerdown", onPointerDown);

    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      teardownDrag();
      stopMomentum();
      document.documentElement.classList.remove("is-dragscroll");
    };
  }, [rootRef]);
}
