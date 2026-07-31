// pdf.js integration - worker config, a document cache, and a page-1 thumbnail
// cache. Everything renders against the `CvBytesLoader` seam (see types.ts).
//
// The worker is imported with Vite's `?url` suffix so it is fingerprinted and
// bundled into the app - no network / CDN fetch, which matters for an offline
// Tauri desktop build.

import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { safeInvoke } from "../../lib/tauriInvoke";
import type { CvBytesLoader } from "./types";

GlobalWorkerOptions.workerSrc = PdfWorkerUrl;

/**
 * SEAM - proposed backend command name. NOT yet implemented on the Rust side;
 * `safeInvoke` swallows the "command not found" rejection and returns null, so
 * the UI degrades gracefully until this command exists. When wiring the
 * backend, implement a `#[tauri::command] cv_read_bytes(cv_id) -> Vec<u8>` (or
 * point `defaultCvBytesLoader` at whatever the real command ends up being).
 */
export const PROPOSED_CV_BYTES_COMMAND = "cv_read_bytes";

/** Default loader: asks the (not-yet-existing) backend command for bytes. */
export const defaultCvBytesLoader: CvBytesLoader = async (cvId) => {
  const res = await safeInvoke<number[] | Uint8Array>(PROPOSED_CV_BYTES_COMMAND, { cvId });
  if (res == null) return null;
  return res instanceof Uint8Array ? res : Uint8Array.from(res);
};

// ---- Document cache ---------------------------------------------------------
// Keyed by cv id. Successful loads are memoised for the session; failed /
// unavailable loads are evicted so they can be retried once the backend lands.

const docCache = new Map<string, Promise<PDFDocumentProxy | null>>();

export function loadCvDocument(
  cvId: string,
  loader: CvBytesLoader,
): Promise<PDFDocumentProxy | null> {
  const existing = docCache.get(cvId);
  if (existing) return existing;

  const pending = (async (): Promise<PDFDocumentProxy | null> => {
    const bytes = await loader(cvId);
    if (!bytes) return null;
    // getDocument transfers/consumes the buffer - hand it a private copy so the
    // cached array (and any re-load) stays valid.
    const data = bytes.slice(0);
    return await getDocument({ data }).promise;
  })();

  docCache.set(cvId, pending);
  // Evict on failure/unavailable so a later attempt can succeed.
  void pending
    .then((doc) => {
      if (!doc) docCache.delete(cvId);
    })
    .catch(() => docCache.delete(cvId));

  return pending;
}

export function clearCvDocumentCache(): void {
  for (const pending of docCache.values()) {
    void pending.then((doc) => doc?.cleanup()).catch(() => {});
  }
  docCache.clear();
  thumbCache.clear();
}

// ---- Page-1 raster caches ---------------------------------------------------
// Two independent caches keyed by cvId: the small grid tile and the larger,
// higher-resolution hover peek. Keeping them separate lets the peek render at a
// genuinely higher resolution than the tile without either overwriting the other.
const thumbCache = new Map<string, string>();
const thumbInflight = new Map<string, Promise<string | null>>();
const peekCache = new Map<string, string>();
const peekInflight = new Map<string, Promise<string | null>>();

/** Synchronous cache read for the grid tile - instant render on re-mount. */
export function getCachedThumb(cvId: string): string | null {
  return thumbCache.get(cvId) ?? null;
}

/** Synchronous read for the hover peek; falls back to the tile so the peek can
 *  show something the instant the pointer arrives, before the hi-res render lands. */
export function getCachedPeek(cvId: string): string | null {
  return peekCache.get(cvId) ?? thumbCache.get(cvId) ?? null;
}

/** Render page 1 to a PNG data URL at `targetWidth` CSS px (deduped + cached in
 *  the supplied cache). Null when the document bytes aren't available. */
function renderPage1(
  cvId: string,
  loader: CvBytesLoader,
  targetWidth: number,
  cache: Map<string, string>,
  inflight: Map<string, Promise<string | null>>,
): Promise<string | null> {
  const cached = cache.get(cvId);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(cvId);
  if (running) return running;

  const pending = (async (): Promise<string | null> => {
    const doc = await loadCvDocument(cvId, loader);
    if (!doc) return null;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Oversample the backing store (≥2×, rising with DPR) so the image stays
    // crisp when laid out at its CSS width, including on retina panels.
    const dpr = Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const oversample = Math.max(2, dpr);
    const viewport = page.getViewport({ scale: (targetWidth / base.width) * oversample });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // White ground: PDFs render text without their own background, so on a
    // transparent canvas the glyphs would sit on nothing and read faint over the
    // dark card. Paint white first, then draw the page over it.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL("image/png");
    cache.set(cvId, url);
    return url;
  })()
    .catch(() => null)
    .finally(() => inflight.delete(cvId));

  inflight.set(cvId, pending);
  return pending;
}

/** Small grid-tile render — sized for the card thumbnail. */
export function renderCvThumbnail(
  cvId: string,
  loader: CvBytesLoader,
  targetWidth = 520,
): Promise<string | null> {
  return renderPage1(cvId, loader, targetWidth, thumbCache, thumbInflight);
}

/** Dedicated high-resolution render for the enlarged hover peek. Rendered lazily
 *  (only when the pointer actually reaches a card) so its extra pixels cost
 *  nothing for CVs the user never hovers. */
export function renderCvPeek(
  cvId: string,
  loader: CvBytesLoader,
  targetWidth = 760,
): Promise<string | null> {
  return renderPage1(cvId, loader, targetWidth, peekCache, peekInflight);
}
