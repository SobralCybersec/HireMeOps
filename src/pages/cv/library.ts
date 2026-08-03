// Data seam for the CV Library list. The page renders against this function so
// the real Tauri command and the dev/off-Tauri mock are the only things that
// differ between environments.
//
// The backend command `list_cv_documents({ profileId })` returns rows already
// shaped as `CvLibraryDoc` (see `src-tauri/.../domain/cv.rs::CvDocumentSummary`,
// serialized `camelCase`), so no field mapping is needed here.

import { invokeStrict } from "../../lib/tauriInvoke";
import { MOCK_LIBRARY } from "./mockData";
import type { CvLibraryDoc } from "./types";

/**
 * Load a profile's CV documents. Resolves to the (possibly empty) list, or
 * **rejects** if the backend errors - the caller must distinguish "no
 * documents" (`[]`) from "failed to load" (throw) so a backend failure never
 * masquerades as an empty library. Off-Tauri, the dev mock is returned.
 */
export async function loadCvLibrary(profileId: string): Promise<CvLibraryDoc[]> {
  return invokeStrict<CvLibraryDoc[]>("list_cv_documents", { profileId });
}

/**
 * Import a CV file from an absolute filesystem `path` into the given profile's
 * document library. Resolves to the new document id, or **rejects** with the
 * backend `DomainError` message (bad file, parse failure, unsupported type...) so
 * the caller can surface it. The backend copies/parses the file; the caller
 * should reload the library on success. Mirrors `import_cv_document`.
 */
export async function importCvDocument(profileId: string, path: string): Promise<string> {
  return invokeStrict<string>("import_cv_document", { profileId, path });
}

/** Dev/off-Tauri fallback rows (screenshot + preview builds). */
export const MOCK_CV_LIBRARY = MOCK_LIBRARY;
