// Full-document viewer: a modal over the instrument panel with a thumbnail
// rail, a virtualised main column (pages render only when scrolled near view),
// zoom + page controls, and a metadata side panel. Keyboard-driven and focus
// trapped. When document bytes aren't available (backend seam), it shows the
// file facts and a calm "preview unavailable" state instead of failing.
//
// Layout note: each main-column page frame carries an inline `width/height`
// pulled from `page.getViewport({ scale: 1 })` - resolved before any canvas
// mounts. Without that, the frame collapses to the browser's 300×150 canvas
// default during the async `getPage → render` handoff and the "big view" reads
// as blank. The zoom multiplier is applied on top of the dimensions the PDF
// itself declares, so non-Letter documents render at their real proportions.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Cancel01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  MaximizeScreenIcon,
  MenuSquareIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Badge, Button, Icon } from "../../components/ui";
import { PdfPageCanvas } from "./PdfPageCanvas";
import { loadCvDocument } from "./pdf";
import { formatBytes, relativeTime } from "./mockData";
import type { CvBytesLoader, CvLibraryDoc } from "./types";

interface CvViewerProps {
  cv: CvLibraryDoc;
  loader: CvBytesLoader;
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; doc: PDFDocumentProxy; numPages: number }
  | { kind: "unavailable" };

// Resolved document, tagged with the cv id it belongs to. The "loading" state
// is derived (not stored) whenever no resolved result matches the current cv.
type Resolved =
  | { id: string; kind: "ready"; doc: PDFDocumentProxy; numPages: number }
  | { id: string; kind: "unavailable" };

// Zoom ladder for explicit user steps. "fit" is a virtual step that reads the
// main-column width at render time - kept OUT of this array so numeric arith
// stays clean.
const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2, 3];
const ZOOM_FIT = -1;
type ZoomMode = number; // index into ZOOM_STEPS, or ZOOM_FIT

// Magnifier loupe: a circular lens that follows the cursor over a rendered page
// and shows that spot magnified, sampled straight from the page's own canvas so
// it's as sharp as the page render itself.
const LENS = 220;
const LENS_ZOOM = 2.4;

// One page frame in the main column. Prefetches the page's PDF-declared
// dimensions BEFORE mounting the canvas, then locks the frame to those dims so
// the layout never depends on the canvas's transient 300×150 default.
function ViewerPage({
  doc,
  pageNumber,
  scale,
  onEnter,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onEnter: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [render, setRender] = useState(false);
  // Native page dimensions from `getViewport({ scale: 1 })`. `null` until the
  // page metadata resolves - the skeleton uses a Letter-shaped placeholder in
  // the meantime.
  const [pageDims, setPageDims] = useState<{ w: number; h: number } | null>(null);

  // Stabilise onEnter so the IO effect below doesn't reconnect on every parent
  // re-render (which happens each time the active page changes).
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  // Prefetch the page's natural dimensions. Cheap: pdfjs caches `getPage`, and
  // `getViewport` is synchronous arithmetic on the cached page.
  useEffect(() => {
    let alive = true;
    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (!alive) return;
        const vp = page.getViewport({ scale: 1 });
        setPageDims({ w: vp.width, h: vp.height });
      })
      .catch(() => {
        // Metadata failed - the Letter-shaped skeleton stays. Rendering below
        // is gated on `pageDims` too, so we simply degrade to the placeholder.
      });
    return () => {
      alive = false;
    };
  }, [doc, pageNumber]);

  // Visibility gate - only mount the (expensive) canvas once the frame is near
  // the viewport. rootMargin is generous vertically so scrolling doesn't chase
  // the reader with a spinner, but 0 horizontally so off-axis pages don't
  // prewarm during rail navigation.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRender(true);
            if (entry.intersectionRatio >= 0.5) onEnterRef.current(pageNumber);
          }
        }
      },
      { rootMargin: "600px 0px", threshold: [0.05, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber]);

  // Fallback while metadata loads: Letter proportions at the requested scale
  // so the frame reserves a plausible amount of space. Once real dims arrive
  // the frame snaps to them - one lightweight reflow, no visual pop-in.
  const frameW = Math.floor((pageDims?.w ?? 612) * scale);
  const frameH = Math.floor((pageDims?.h ?? 792) * scale);

  return (
    <div
      ref={ref}
      className="cvx-page"
      data-page={pageNumber}
      id={`cvx-page-${pageNumber}`}
      style={{ width: frameW, height: frameH }}
    >
      {render && pageDims ? (
        <PdfPageCanvas
          doc={doc}
          pageNumber={pageNumber}
          scale={scale}
          cssWidth={pageDims.w}
          cssHeight={pageDims.h}
          className="cvx-page__canvas"
        />
      ) : (
        <div className="cvx-page__skel" aria-hidden="true" />
      )}
      <span className="cvx-page__num" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

export function CvViewer({ cv, loader, onClose }: CvViewerProps) {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [current, setCurrent] = useState(1);
  // Zoom starts in fit-width mode: the main column measures itself and picks a
  // scale that makes the PDF's real page-1 width fill the available room.
  // Users bump into ZOOM_STEPS with the +/- controls; that flips them out of
  // fit-width and into explicit steps.
  const [zoomMode, setZoomMode] = useState<ZoomMode>(ZOOM_FIT);
  const [showMeta, setShowMeta] = useState(true);
  // Page-1 dims (from getViewport at scale 1) - drive the fit-width formula.
  const [nativePage1, setNativePage1] = useState<{ w: number; h: number } | null>(null);
  // Live width of `.cvx-main` (after its padding). Recomputed on modal resize
  // via ResizeObserver so fit-width tracks the reader's window.
  const [mainInnerW, setMainInnerW] = useState<number>(0);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Magnifier loupe. Re-rendering the page from pdf.js on every mouse-move is
  // vector-crisp but re-parses the whole page each frame → lag. Instead each
  // page is rendered ONCE to a hi-res offscreen canvas (cached), and every move
  // just samples that cache with a synchronous drawImage — crisp real pixels,
  // zero per-frame pdf.js work, and no flicker (drawImage overwrites the lens
  // whole each move). Until a page's hi-res source is built, we sample the
  // displayed canvas (soft for an instant, but never laggy).
  const [magnifier, setMagnifier] = useState(true);
  const [lensPos, setLensPos] = useState<{ x: number; y: number } | null>(null);
  const lensRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const scaleRef = useRef(1);
  // Cache of hi-res page renders (key = `page:scaleBucket`) plus the set of
  // builds in flight, so a page is only rasterized once per zoom level.
  const srcCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const srcBuildingRef = useRef<Set<string>>(new Set());

  const buildHiResSource = useCallback((pageNum: number, key: string) => {
    const doc = docRef.current;
    if (!doc || srcCacheRef.current.has(key) || srcBuildingRef.current.has(key)) return;
    srcBuildingRef.current.add(key);
    const dpr = window.devicePixelRatio || 1;
    // Render at display-scale × lens-zoom × dpr so a magnified point maps ~1:1
    // to real source pixels — no upscaling blur in the lens.
    const hiScale = scaleRef.current * LENS_ZOOM * dpr;
    void doc
      .getPage(pageNum)
      .then((page) => {
        const vp = page.getViewport({ scale: hiScale });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        // No canvasContext — let pdfjs own it (alpha:false → white ground).
        return page.render({ canvas: c, viewport: vp }).promise.then(() => {
          srcCacheRef.current.set(key, c);
          srcBuildingRef.current.delete(key);
        });
      })
      .catch(() => {
        srcBuildingRef.current.delete(key);
      });
  }, []);

  const drawLens = useCallback(
    (e: React.MouseEvent) => {
      if (!magnifier) return;
      const main = mainRef.current;
      const lensEl = lensRef.current;
      if (!main || !lensEl) return;
      let canvasEl: HTMLCanvasElement | null = null;
      let rect: DOMRect | null = null;
      for (const c of main.querySelectorAll<HTMLCanvasElement>(".cvx-page__canvas")) {
        const r = c.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          canvasEl = c;
          rect = r;
          break;
        }
      }
      if (!canvasEl || !rect || rect.width === 0) {
        setLensPos(null);
        return;
      }
      const pageEl = canvasEl.closest<HTMLElement>(".cvx-page");
      const pageNum = pageEl ? Number(pageEl.dataset.page) : NaN;
      if (!Number.isFinite(pageNum)) {
        setLensPos(null);
        return;
      }

      const key = `${pageNum}:${scaleRef.current.toFixed(2)}`;
      const hiRes = srcCacheRef.current.get(key);
      if (!hiRes) buildHiResSource(pageNum, key);
      // Sample from the hi-res cache when ready, else the displayed canvas.
      const src = hiRes ?? canvasEl;

      const dpr = window.devicePixelRatio || 1;
      const back = Math.round(LENS * dpr);
      if (lensEl.width !== back) {
        lensEl.width = back;
        lensEl.height = back;
      }
      const lctx = lensEl.getContext("2d");
      if (lctx) {
        // Cursor position as a fraction of the displayed page, mapped onto the
        // source canvas — scale-independent, so one cache entry serves any zoom.
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        const winW = ((LENS / LENS_ZOOM) / rect.width) * src.width;
        const winH = ((LENS / LENS_ZOOM) / rect.height) * src.height;
        lctx.imageSmoothingEnabled = true;
        lctx.imageSmoothingQuality = "high";
        lctx.drawImage(
          src,
          fx * src.width - winW / 2,
          fy * src.height - winH / 2,
          winW,
          winH,
          0,
          0,
          back,
          back,
        );
      }
      setLensPos({ x: e.clientX, y: e.clientY });
    },
    [magnifier, buildHiResSource],
  );

  const hideLens = useCallback(() => setLensPos(null), []);

  // Load the document (or resolve "unavailable"). State is written only from
  // the async callback, so there is no synchronous setState inside the effect
  // body.
  useEffect(() => {
    let alive = true;
    void loadCvDocument(cv.id, loader).then((doc) => {
      if (!alive) return;
      setResolved(
        doc
          ? { id: cv.id, kind: "ready", doc, numPages: doc.numPages }
          : { id: cv.id, kind: "unavailable" },
      );
    });
    return () => {
      alive = false;
    };
  }, [cv.id, loader]);

  // Effective load state, derived so a cv change shows "loading" immediately
  // (until the new fetch resolves) without a synchronous setState-in-effect.
  const load: LoadState =
    resolved && resolved.id === cv.id
      ? resolved.kind === "ready"
        ? { kind: "ready", doc: resolved.doc, numPages: resolved.numPages }
        : { kind: "unavailable" }
      : { kind: "loading" };
  const pageCount = load.kind === "ready" ? load.numPages : 1;

  // Prefetch page-1 native dimensions once the document is ready. Only page 1
  // is needed for fit-width; ViewerPage prefetches per-page dims independently.
  useEffect(() => {
    if (load.kind !== "ready") {
      setNativePage1(null);
      return;
    }
    let alive = true;
    void load.doc.getPage(1).then((page) => {
      if (!alive) return;
      const vp = page.getViewport({ scale: 1 });
      setNativePage1({ w: vp.width, h: vp.height });
    });
    return () => {
      alive = false;
    };
  }, [load.kind === "ready" ? load.doc : null]);

  // Measure the main column - fit-width needs the real inner width, which
  // depends on modal size (min(1200px, 100%)) minus rail + meta + padding.
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => {
      const cs = window.getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft || "0") + parseFloat(cs.paddingRight || "0");
      setMainInnerW(Math.max(0, el.clientWidth - padX));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showMeta, load.kind]);

  // Resolve the effective scale. Fit-width picks the largest ZOOM_STEPS entry
  // that fits in the column (fallback to a computed ratio when nothing does),
  // clamped so we never render at absurd sizes on very wide monitors.
  const scale = useMemo(() => {
    if (zoomMode !== ZOOM_FIT) return ZOOM_STEPS[zoomMode];
    if (!nativePage1 || mainInnerW <= 0) return 1;
    const raw = mainInnerW / nativePage1.w;
    // Clamp: don't go below smallest step, don't exceed 2× (readable ceiling).
    return Math.min(2, Math.max(ZOOM_STEPS[0], raw));
  }, [zoomMode, nativePage1, mainInnerW]);

  // Keep the loupe's refs fresh, and drop cached hi-res page renders when the
  // document changes so a new CV doesn't sample the old one's pixels.
  const readyDoc = load.kind === "ready" ? load.doc : null;
  useEffect(() => {
    docRef.current = readyDoc;
    srcCacheRef.current.clear();
    srcBuildingRef.current.clear();
  }, [readyDoc]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const goToPage = useCallback((page: number, total: number) => {
    const clamped = Math.max(1, Math.min(total, page));
    setCurrent(clamped);
    document.getElementById(`cvx-page-${clamped}`)?.scrollIntoView({ block: "start" });
  }, []);

  // Explicit zoom step - snap to the nearest ZOOM_STEPS index around the
  // current effective scale, then step. Keeps +/- feeling native after a
  // fit-width start.
  const stepZoom = useCallback(
    (delta: 1 | -1) => {
      setZoomMode((prev) => {
        const currentIdx =
          prev === ZOOM_FIT
            ? // Find nearest step to the currently-rendered scale.
              ZOOM_STEPS.reduce(
                (best, step, i) =>
                  Math.abs(step - scale) < Math.abs(ZOOM_STEPS[best] - scale) ? i : best,
                0,
              )
            : prev;
        const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, currentIdx + delta));
        return next;
      });
    },
    [scale],
  );

  // Focus management: trap focus in the panel, restore on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, []);

  // Keyboard controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          goToPage(current + 1, pageCount);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          goToPage(current - 1, pageCount);
          break;
        case "Home":
          e.preventDefault();
          goToPage(1, pageCount);
          break;
        case "End":
          e.preventDefault();
          goToPage(pageCount, pageCount);
          break;
        case "+":
        case "=":
          e.preventDefault();
          stepZoom(1);
          break;
        case "-":
          e.preventDefault();
          stepZoom(-1);
          break;
        case "0":
          // Reset to fit-width (matches "0 = actual size" convention adjusted
          // for a modal viewer where "actual" isn't meaningful - fit-width is
          // the useful home).
          e.preventDefault();
          setZoomMode(ZOOM_FIT);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pageCount, goToPage, onClose, stepZoom]);

  const total = load.kind === "ready" ? load.numPages : cv.pageCount;
  const pages = load.kind === "ready" ? Array.from({ length: load.numPages }, (_, i) => i + 1) : [];

  const onPageEnter = useCallback((page: number) => setCurrent(page), []);

  return createPortal(
    <div
      className="cvx-viewer-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className="overlay-surface cvx-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Viewer: ${cv.fileName}`}
        tabIndex={-1}
      >
        {/* Toolbar */}
        <div className="toolbar toolbar--border cvx-viewer__bar">
          <span className="cvx-viewer__title" title={cv.fileName}>
            {cv.fileName}
          </span>
          <Badge variant="neutral">{cv.fileType.toUpperCase()}</Badge>
          {cv.isActive && <Badge variant="success">Active</Badge>}

          <div className="toolbar-spacer" />

          <div className="cvx-viewer__pager" role="group" aria-label="Page navigation">
            <Button
              size="sm"
              aria-label="Previous page"
              disabled={load.kind !== "ready" || current <= 1}
              onClick={() => goToPage(current - 1, total)}
            >
              ‹
            </Button>
            <span className="cvx-viewer__pagenum">
              {current} / {total}
            </span>
            <Button
              size="sm"
              aria-label="Next page"
              disabled={load.kind !== "ready" || current >= total}
              onClick={() => goToPage(current + 1, total)}
            >
              ›
            </Button>
          </div>

          <div className="toolbar-sep" />

          <div className="cvx-viewer__zoom" role="group" aria-label="Zoom">
            <Button size="sm" aria-label="Zoom out" onClick={() => stepZoom(-1)}>
              <Icon icon={ZoomOutAreaIcon} size={16} />
            </Button>
            <span className="cvx-viewer__pagenum" aria-live="polite">
              {Math.round(scale * 100)}%
            </span>
            <Button size="sm" aria-label="Zoom in" onClick={() => stepZoom(1)}>
              <Icon icon={ZoomInAreaIcon} size={16} />
            </Button>
            <Button
              size="sm"
              aria-label="Fit page width"
              aria-pressed={zoomMode === ZOOM_FIT}
              onClick={() => setZoomMode(ZOOM_FIT)}
            >
              <Icon icon={MaximizeScreenIcon} size={16} />
            </Button>
            <Button
              size="sm"
              aria-label="Magnifier — hover the page to read up close"
              aria-pressed={magnifier}
              title={magnifier ? "Magnifier on (hover the page)" : "Magnifier off"}
              onClick={() => {
                setMagnifier((v) => !v);
                setLensPos(null);
              }}
            >
              <Icon icon={Search01Icon} size={16} />
            </Button>
          </div>

          <div className="toolbar-sep" />

          <Button
            size="sm"
            aria-pressed={showMeta}
            aria-label="Toggle details panel"
            onClick={() => setShowMeta((v) => !v)}
            icon={<Icon icon={MenuSquareIcon} size={14} />}
          >
            Details
          </Button>
          <Button size="sm" aria-label="Close viewer" onClick={onClose}>
            <Icon icon={Cancel01Icon} size={16} />
          </Button>
        </div>

        {/* Body */}
        <div className="cvx-viewer__body">
          {load.kind === "ready" && (
            <nav className="cvx-rail" aria-label="Page thumbnails">
              {pages.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={
                    p === current ? "cvx-rail__item cvx-rail__item--active" : "cvx-rail__item"
                  }
                  aria-current={p === current}
                  aria-label={`Go to page ${p}`}
                  onClick={() => goToPage(p, total)}
                >
                  <PdfPageCanvas
                    doc={load.doc}
                    pageNumber={p}
                    scale={0.18}
                    className="cvx-rail__canvas"
                  />
                  <span className="cvx-rail__num">{p}</span>
                </button>
              ))}
            </nav>
          )}

          <div
            ref={mainRef}
            className="cvx-main"
            onMouseMove={drawLens}
            onMouseLeave={hideLens}
            style={lensPos ? { cursor: "none" } : undefined}
          >
            {load.kind === "loading" && (
              <div className="cvx-main__skel cvx-skel" aria-label="Loading document" />
            )}

            {load.kind === "unavailable" && (
              <div className="empty-state cvx-unavailable">
                <div className="empty-state__label">Preview unavailable</div>
                <p className="empty-state__title">Document bytes not loaded</p>
                <p className="empty-state__body">
                  The renderer is ready, but this build has no CV file backend wired yet. Metadata
                  is shown on the right; the full page render appears here once documents are
                  readable.
                </p>
              </div>
            )}

            {load.kind === "ready" &&
              pages.map((p) => (
                <ViewerPage
                  key={p}
                  doc={load.doc}
                  pageNumber={p}
                  scale={scale}
                  onEnter={onPageEnter}
                />
              ))}
          </div>

          {showMeta && (
            <aside className="cvx-meta" aria-label="Document details">
              <h3 className="cvx-meta__title">Document</h3>
              <dl className="cvx-meta__list">
                <MetaRow label="File" value={cv.fileName} mono />
                <MetaRow label="Type" value={cv.fileType.toUpperCase()} mono />
                <MetaRow label="Pages" value={String(total)} mono />
                <MetaRow label="Size" value={formatBytes(cv.sizeBytes)} mono />
                <MetaRow label="Hash" value={cv.fileHash} mono />
                <MetaRow label="Added" value={relativeTime(cv.createdAt)} />
                <MetaRow label="Last used" value={relativeTime(cv.lastUsedAt)} />
                <MetaRow
                  label="Score"
                  value={cv.lastAnalysisScore !== null ? `${cv.lastAnalysisScore}%` : "-"}
                  mono
                />
              </dl>

              <h3 className="cvx-meta__title">Variants</h3>
              <div className="cvx-variants">
                {cv.assignedVariants.length > 0 ? (
                  cv.assignedVariants.map((v) => (
                    <span key={v.id} className="tag">
                      {v.name}
                    </span>
                  ))
                ) : (
                  <span className="cvx-meta__empty">none assigned</span>
                )}
              </div>

              <h3 className="cvx-meta__title">Sections</h3>
              <ul className="cvx-meta__sections">
                {cv.sections.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>

      {/* Magnifier lens — sits above the panel, follows the cursor, ignores
          pointer events so it never blocks scrolling or clicks. */}
      <canvas
        ref={lensRef}
        className="cvx-viewer-loupe"
        aria-hidden="true"
        style={{
          display: lensPos ? "block" : "none",
          left: lensPos ? lensPos.x - LENS / 2 : 0,
          top: lensPos ? lensPos.y - LENS / 2 : 0,
          width: LENS,
          height: LENS,
        }}
      />
    </div>,
    document.body,
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="cvx-meta__row">
      <dt>{label}</dt>
      <dd className={mono ? "cvx-meta__mono" : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}
