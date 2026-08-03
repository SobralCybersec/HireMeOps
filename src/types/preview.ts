/**
 * Live browser-preview contract - SINGLE SOURCE OF TRUTH.
 * ─────────────────────────────────────────────────────────────────────────
 * The frontend `BrowserPreview` component and the Rust `real-browser` command
 * layer (`src-tauri/src/browser/preview.rs`) MUST agree on the names and shapes
 * declared here. If either side changes, change this file first.
 *
 * Backend maps CDP `Page.startScreencast` → `Page.screencastFrame` events onto
 * the `PreviewFrame` stream below, acking each frame so Chromium keeps flowing.
 *
 * Commands (arg names match the Rust command signatures exactly):
 *
 *   preview_open({ url: string, headless: boolean, channel: Channel<PreviewFrame> })
 *       -> string                      // opaque session handle
 *
 *   preview_close({ handle: string })
 *       -> void                        // stops screencast, releases the page
 *
 * Off-Tauri (plain browser / screenshot builds) neither command exists; the
 * component degrades to a static placeholder instead of invoking.
 */

/** One screencast frame pushed over the `onFrame` Channel. */
export interface PreviewFrame {
  /** Monotonic sequence number; consumers drop frames older than the last drawn. */
  seq: number;
  /** Base64-encoded JPEG payload (no data-URL prefix). */
  data: string;
  /** Intrinsic frame width in device pixels. */
  width: number;
  /** Intrinsic frame height in device pixels. */
  height: number;
}

/** Tauri command names - referenced from exactly one call site each. */
export const PREVIEW_OPEN = "preview_open" as const;
export const PREVIEW_CLOSE = "preview_close" as const;

/**
 * LIVE variants — screencast the ACTIVE automation session (the worker's own page) rather than a
 * throwaway browser, so the Evidence Viewer shows the real bot at work.
 *
 *   preview_open_live({ handle: string | null, channel: Channel<PreviewFrame> })
 *       -> string   // handle attached (null → the driver's current session)
 *   preview_close_live({ handle: string }) -> void
 */
export const PREVIEW_OPEN_LIVE = "preview_open_live" as const;
export const PREVIEW_CLOSE_LIVE = "preview_close_live" as const;
