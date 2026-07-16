// A single rendered PDF page. Renders at device-pixel resolution and cancels
// its in-flight render task on unmount / prop change so re-scrolling the viewer
// never triggers "canvas in use" errors or setState-after-unmount.
//
// Why the width/height HTML attributes are on the JSX (not just set imperatively
// after render begins): a bare <canvas> mounts with a browser-intrinsic 300×150
// backing store. Under `display: block` with no CSS width/height, its layout
// box is that same 300×150 until the async render effect (which awaits both
// `doc.getPage` and pdfjs's operator-list stream) finishes setting inline
// styles. In the main CV viewer, that window collapses the enclosing `.cvx-page`
// to a 300×150 tile in the middle of a flex column with `align-items: center` -
// what the user reads as "the big view is blank". Passing width/height on the
// JSX (matched to the parent-supplied `pixel*` dims) gives the pixel buffer a
// correct size at mount, so the visual box never collapses, and the render
// effect only has to draw into it.

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** CSS-pixel scale (device pixel ratio is applied on top for crispness). */
  scale: number;
  /**
   * Expected CSS width in unscaled PDF points. When provided (viewer path), the
   * canvas mounts with a correctly-sized backing buffer immediately so the
   * enclosing frame does not collapse to the 300×150 canvas default while the
   * async render is in flight. When omitted (rail-thumb path), the effect sizes
   * the canvas after `getPage` resolves - the intrinsic 300×150 default is
   * masked by rail-thumb CSS (`max-width: 100%`) so the flash is invisible.
   */
  cssWidth?: number;
  /** Expected CSS height in unscaled PDF points. Pair with `cssWidth`. */
  cssHeight?: number;
  className?: string;
}

export function PdfPageCanvas({
  doc,
  pageNumber,
  scale,
  cssWidth,
  cssHeight,
  className,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Cache the dpr snapshot the JSX uses so the pixel buffer, the CSS box, and
  // the render transform all agree even if the user drags the window to a
  // different-DPI monitor between renders.
  const dprRef = useRef<number>(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const dpr = dprRef.current;

  const hasHint = cssWidth != null && cssHeight != null;
  const initialCssW = hasHint ? Math.floor(cssWidth! * scale) : undefined;
  const initialCssH = hasHint ? Math.floor(cssHeight! * scale) : undefined;
  const initialPxW = hasHint ? Math.floor(cssWidth! * scale * dpr) : undefined;
  const initialPxH = hasHint ? Math.floor(cssHeight! * scale * dpr) : undefined;

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const viewport = page.getViewport({ scale });
      const localDpr = window.devicePixelRatio || 1;
      dprRef.current = localDpr;

      const pxW = Math.floor(viewport.width * localDpr);
      const pxH = Math.floor(viewport.height * localDpr);
      // Setting width/height resets the 2D context state; do it BEFORE grabbing
      // the context to render into.
      if (canvas.width !== pxW) canvas.width = pxW;
      if (canvas.height !== pxH) canvas.height = pxH;
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      // Only pass `canvas` - pdfjs 6.x prefers it and creates the context
      // internally with the correct options (`alpha: false`, `willReadFrequently`
      // paired to hardware-acceleration). Passing a pre-made canvasContext with
      // default `alpha: true` produces a transparent backing that renders text
      // without a white ground plane - subtle on light themes, near-invisible
      // on dark ones. Letting pdfjs own the context avoids that trap.
      task = page.render({
        canvas,
        viewport,
        transform: localDpr !== 1 ? [localDpr, 0, 0, localDpr, 0, 0] : undefined,
      });
      await task.promise;
    })().catch(() => {
      // RenderingCancelledException (expected on unmount / dep change) and
      // load failures are both non-fatal - the placeholder frame remains.
    });

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* already settled */
      }
    };
  }, [doc, pageNumber, scale]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Backing-buffer size: pixel-perfect at the current dpr when the hint is
      // provided. Without a hint we let the effect resize; the canvas mounts at
      // 300×150 (browser default) until then.
      width={initialPxW}
      height={initialPxH}
      // CSS box size: mirrors the eventual `page.getViewport({ scale }).width`
      // so the enclosing `.cvx-page` frame is stable across the mount →
      // getPage → render transition.
      style={hasHint ? { width: `${initialCssW}px`, height: `${initialCssH}px` } : undefined}
    />
  );
}
