// A single rendered PDF page. Renders at device-pixel resolution and cancels
// its in-flight render task on unmount / prop change so re-scrolling the viewer
// never triggers "canvas in use" errors or setState-after-unmount.

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** CSS-pixel scale (device pixel ratio is applied on top for crispness). */
  scale: number;
  className?: string;
}

export function PdfPageCanvas({ doc, pageNumber, scale, className }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      task = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await task.promise;
    })().catch(() => {
      // RenderingCancelledException (expected on unmount) and load failures are
      // both non-fatal — the placeholder frame remains.
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

  return <canvas ref={canvasRef} className={className} />;
}
