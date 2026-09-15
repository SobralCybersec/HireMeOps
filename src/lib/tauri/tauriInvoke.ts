import { invoke } from "@tauri-apps/api/core";
import { getMockResponse, isMockEnabled } from "./devMocks";

/**
 * Thin wrapper around Tauri's `invoke` that never throws. Use ONLY for
 * *optional reads* - commands whose absence/failure should degrade to an empty
 * state (e.g. Phase-1 pages against a not-yet-wired backend). It collapses
 * "command missing" and "command errored" into the same `null`, so it MUST NOT
 * be used for writes/mutations where a real failure has to reach the user.
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  // Dev-only: off-Tauri (plain browser) serve mock data so screenshot/preview
  // builds render populated pages. Inert in production and in the real app.
  if (isMockEnabled()) {
    const mock = getMockResponse<T>(command, args);
    if (mock !== undefined) return mock;
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[tauri] invoke "${command}" failed`, error);
    return null;
  }
}

/**
 * `invoke` that **rethrows** on failure. Use for every mutation/write command
 * (`update_settings`, all `automation_*`, imports...) so a real `DomainError`
 * from the backend surfaces to the caller instead of being swallowed. Dev
 * mocks are still honoured off-Tauri so preview builds keep working.
 */
export async function invokeStrict<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isMockEnabled()) {
    const mock = getMockResponse<T>(command, args);
    if (mock !== undefined) return mock;
  }
  return await invoke<T>(command, args);
}

/** Normalise an unknown thrown value (Tauri passes strings) into a message. */
export function errMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
