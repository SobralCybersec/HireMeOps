// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CloudSessionPanel } from "./CloudSessionPanel";
import { invokeStrict, safeInvoke } from "../../lib/tauri/tauriInvoke";
import { useProfileStore } from "../../stores/profiles/useProfileStore";
import type { BrowserSessionMetadata } from "../../types/domain";

vi.mock("../../lib/tauri/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (error: unknown) => String(error),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeInvoke.mockResolvedValue(null);
  useProfileStore.setState({ profiles: [], activeProfileId: "default", isLoading: false });
});

afterEach(cleanup);

describe("CloudSessionPanel profile bridge", () => {
  it("syncs and confirms metadata for active profile", async () => {
    mockInvokeStrict.mockImplementation(async (command: string) => {
      if (command === "sync_browser_session") return metadata;
      if (command === "browser_session_status") return metadata;
      throw new Error(`unexpected command: ${command}`);
    });

    render(<CloudSessionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Sync to cloud" }));

    await waitFor(() => expect(mockInvokeStrict).toHaveBeenCalledTimes(2));
    expect(mockInvokeStrict).toHaveBeenNthCalledWith(1, "sync_browser_session", {
      profileId: "default",
    });
    expect(mockInvokeStrict).toHaveBeenNthCalledWith(2, "browser_session_status", {
      profileId: "default",
    });
    expect(screen.getByText(/profile default/)).toBeTruthy();
    expect(screen.getByText(/encrypted state .* bytes/)).toBeTruthy();
  });

  it("disables profile-bound actions when no active profile exists", () => {
    useProfileStore.setState({ activeProfileId: null });
    render(<CloudSessionPanel />);

    expect(screen.getByRole("button", { name: "Check sessions" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Sync to cloud" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Validate cloud" })).toHaveProperty("disabled", true);
  });
});
