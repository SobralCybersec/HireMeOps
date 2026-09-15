import { session } from "./worker-context.js";

export const STORAGE_STATE_VERSION = 1;

function validateStorageState(storageState) {
  if (!storageState || typeof storageState !== "object") {
    throw new Error("storage state must be an object");
  }
  if (!Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) {
    throw new Error("storage state has unsupported format");
  }
}

export async function cmdExportStorageState({ handle }) {
  const { browser } = session(handle);
  const storageState = await browser.storageState({ indexedDB: true });
  return { version: STORAGE_STATE_VERSION, storageState };
}

export async function cmdImportStorageState({
  handle,
  version = STORAGE_STATE_VERSION,
  storageState,
}) {
  if (version !== STORAGE_STATE_VERSION) {
    throw new Error(`unsupported storage state version: ${version}`);
  }
  validateStorageState(storageState);
  const { browser } = session(handle);
  await browser.setStorageState(storageState);
  return { version: STORAGE_STATE_VERSION, imported: true };
}
