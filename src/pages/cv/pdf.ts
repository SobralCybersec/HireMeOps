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

// ---- Page-1 thumbnail cache -------------------------------------------------

const thumbCache = new Map<string, string>();
const thumbInflight = new Map<string, Promise<string | null>>();

/** Synchronous cache peek - lets components render instantly on re-mount. */
export function getCachedThumb(cvId: string): string | null {
  return thumbCache.get(cvId) ?? null;
}

/** Render page 1 to a PNG data URL (deduped + cached). Null when unavailable. */
export function renderCvThumbnail(
  cvId: string,
  loader: CvBytesLoader,
  targetWidth = 240,
): Promise<string | null> {
  const cached = thumbCache.get(cvId);
  if (cached) return Promise.resolve(cached);
  const inflight = thumbInflight.get(cvId);
  if (inflight) return inflight;

  const pending = (async (): Promise<string | null> => {
    const doc = await loadCvDocument(cvId, loader);
    if (!doc) return null;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const url = canvas.toDataURL("image/png");
    thumbCache.set(cvId, url);
    return url;
  })()
    .catch(() => null)
    .finally(() => thumbInflight.delete(cvId));

  thumbInflight.set(cvId, pending);
  return pending;
}
