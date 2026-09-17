import { describe, expect, it } from "vitest";
import type { BrowserSessionMetadata } from "../../types/domain";
import { assertCloudSessionMetadata } from "./cloud-session-metadata";

const metadata: BrowserSessionMetadata = {
  id: "session-1",
  profileId: "default",
  encryptionVersion: 1,
  stateFormatVersion: 1,
  revision: 8,
  status: "valid",
  encryptedStateBytes: 201625,
  platformStatus: { linkedin: "valid" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastValidatedAt: null,
};

describe("assertCloudSessionMetadata", () => {
  it("accepts matching profile and encrypted state size", () => {
    expect(assertCloudSessionMetadata(metadata, "default")).toBe(metadata);
  });

  it("rejects profile mismatch or empty encrypted state", () => {
    expect(() => assertCloudSessionMetadata(metadata, "work")).toThrow(
      "Cloud session profile mismatch.",
    );
    expect(() =>
      assertCloudSessionMetadata({ ...metadata, encryptedStateBytes: 0 }, "default"),
    ).toThrow("Cloud session has no encrypted state.");
  });
});
