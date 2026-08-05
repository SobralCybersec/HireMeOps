/**
 * Platform detection for the settings window — without @tauri-apps/plugin-os.
 * Uses navigator.userAgent for Mac detection (synchronous, no plugin needed).
 */
export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Macintosh|MacIntel|Mac OS X/i.test(navigator.userAgent);

/**
 * True when we should render our own window controls (min/max/close).
 * The settings window is built with decorations=false on Linux/Windows,
 * so we always own the controls there. macOS uses its native traffic lights.
 */
export const USE_CUSTOM_WINDOW_CONTROLS = IS_TAURI && !IS_MAC;
