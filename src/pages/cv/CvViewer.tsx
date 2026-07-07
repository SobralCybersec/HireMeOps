// Full-document viewer: a modal over the instrument panel with a thumbnail
// rail, a virtualised main column (pages render only when scrolled near view),
// zoom + page controls, and a metadata side panel. Keyboard-driven and focus
// trapped. When document bytes aren't available (backend seam), it shows the
// file facts and a calm "preview unavailable" state instead of failing.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Badge, Button } from "../../components/ui";
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

const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM_INDEX = 3;

// One page frame in the main column: mounts its canvas only once near-visible.
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRender(true);
            if (entry.intersectionRatio >= 0.5) onEnter(pageNumber);
          }
        }
      },
      { rootMargin: "300px 0px", threshold: [0.1, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber, onEnter]);

  return (
    <div ref={ref} className="cvx-page" data-page={pageNumber} id={`cvx-page-${pageNumber}`}>
      {render ? (
        <PdfPageCanvas doc={doc} pageNumber={pageNumber} scale={scale} className="cvx-page__canvas" />
      ) : (
        <div className="cvx-page__skel" style={{ width: 612 * scale }} aria-hidden="true" />
      )}
      <span className="cvx-page__num" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

export function CvViewer({ cv, loader, onClose }: CvViewerProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [current, setCurrent] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_INDEX);
  const [showMeta, setShowMeta] = useState(true);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const scale = ZOOM_STEPS[zoomIdx];

  // Load the document (or resolve "unavailable").
  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    void loadCvDocument(cv.id, loader).then((doc) => {
      if (!alive) return;
      setLoad(doc ? { kind: "ready", doc, numPages: doc.numPages } : { kind: "unavailable" });
    });
    return () => {
      alive = false;
    };
  }, [cv.id, loader]);

  const goToPage = useCallback((page: number, total: number) => {
    const clamped = Math.max(1, Math.min(total, page));
    setCurrent(clamped);
    document.getElementById(`cvx-page-${clamped}`)?.scrollIntoView({ block: "start" });
  }, []);

  // Focus management: trap focus in the panel, restore on close.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, []);

  // Keyboard controls.
  useEffect(() => {
    const total = load.kind === "ready" ? load.numPages : 1;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          goToPage(current + 1, total);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          goToPage(current - 1, total);
          break;
        case "Home":
          e.preventDefault();
          goToPage(1, total);
          break;
        case "End":
          e.preventDefault();
          goToPage(total, total);
          break;
        case "+":
        case "=":
          e.preventDefault();
          setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
          break;
        case "-":
          e.preventDefault();
          setZoomIdx((i) => Math.max(0, i - 1));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, load, goToPage, onClose]);

  const total = load.kind === "ready" ? load.numPages : cv.pageCount;
  const pages = load.kind === "ready" ? Array.from({ length: load.numPages }, (_, i) => i + 1) : [];

  return createPortal(
    <div className="cvx-viewer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
            <Button
              size="sm"
              aria-label="Zoom out"
              disabled={zoomIdx <= 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            >
              −
            </Button>
            <span className="cvx-viewer__pagenum">{Math.round(scale * 100)}%</span>
            <Button
              size="sm"
              aria-label="Zoom in"
              disabled={zoomIdx >= ZOOM_STEPS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            >
              +
            </Button>
          </div>

          <div className="toolbar-sep" />

          <Button
            size="sm"
            aria-pressed={showMeta}
            onClick={() => setShowMeta((v) => !v)}
          >
            Details
          </Button>
          <Button size="sm" aria-label="Close viewer" onClick={onClose}>
            ✕
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
                  className={p === current ? "cvx-rail__item cvx-rail__item--active" : "cvx-rail__item"}
                  aria-current={p === current}
                  aria-label={`Go to page ${p}`}
                  onClick={() => goToPage(p, total)}
                >
                  <PdfPageCanvas doc={load.doc} pageNumber={p} scale={0.18} className="cvx-rail__canvas" />
                  <span className="cvx-rail__num">{p}</span>
                </button>
              ))}
            </nav>
          )}

          <div ref={mainRef} className="cvx-main">
            {load.kind === "loading" && <div className="cvx-main__skel cvx-skel" aria-label="Loading document" />}

            {load.kind === "unavailable" && (
              <div className="empty-state cvx-unavailable">
                <div className="empty-state__label">Preview unavailable</div>
                <p className="empty-state__title">Document bytes not loaded</p>
                <p className="empty-state__body">
                  The renderer is ready, but this build has no CV file backend wired yet. Metadata is
                  shown on the right; the full page render appears here once documents are readable.
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
                  onEnter={(page) => setCurrent(page)}
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
                  value={cv.lastAnalysisScore !== null ? `${cv.lastAnalysisScore}%` : "–"}
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
