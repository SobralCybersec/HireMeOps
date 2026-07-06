import { invoke } from "@tauri-apps/api/core";

/**
 * Thin wrapper around Tauri's `invoke` that never throws. Phase 1 pages call
 * backend commands that may not exist yet, so every call site should get a
 * typed `T | null` back instead of an unhandled rejection.
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[tauri] invoke "${command}" failed`, error);
    return null;
  }
}
