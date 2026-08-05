import { invoke } from "@tauri-apps/api/core";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Open the dedicated Settings window (its own Tauri webview, `settings.html`).
 * In browser-preview (no Tauri) there is no separate window, so callers should
 * fall back to the in-app `/settings` route instead of calling this.
 */
export async function openSettingsWindow(tab?: string): Promise<void> {
  if (!IS_TAURI) return;
  await invoke("open_settings_window", { tab: tab ?? null });
}

export { IS_TAURI };
