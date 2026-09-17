import type { BrowserSessionMetadata } from "../../types/domain";

export function assertCloudSessionMetadata(
  metadata: BrowserSessionMetadata,
  profileId: string,
): BrowserSessionMetadata {
  if (metadata.profileId !== profileId) {
    throw new Error("Cloud session profile mismatch.");
  }
  if (!Number.isFinite(metadata.encryptedStateBytes) || metadata.encryptedStateBytes <= 0) {
    throw new Error("Cloud session has no encrypted state.");
  }
  return metadata;
}
