import { errMessage, invokeStrict } from "../lib/tauriInvoke";
import {
  createApplicationDraftStore,
  type ApplicationDraftStoreState,
} from "./applicationDraftCore";

// Re-export for consumers that need the factory (tests) or the type (components).
export type { ApplicationDraftStoreState };
export { createApplicationDraftStore };

/**
 * Singleton store - wired to Tauri's `invokeStrict`.
 *
 * Use this hook in all React components:
 *   const draftId = useApplicationDraftStore((s) => s.draftId);
 *
 * For unit tests, use `createApplicationDraftStore` directly (it avoids
 * pulling in the Tauri IPC + devMocks chain).
 */
export const useApplicationDraftStore = createApplicationDraftStore(
  (cmd, args) => invokeStrict<string>(cmd, args),
  errMessage,
);
