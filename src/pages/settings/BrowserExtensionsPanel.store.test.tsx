// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserExtensionsPanel } from "./BrowserExtensionsPanel";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { invokeStrict } from "../../lib/tauriInvoke";
import type { AppSettings } from "../../types/settings";

// Existing BrowserExtensionsPanel.test.tsx covers the controlled value/onChange
// path. This file covers the *store-backed* branch: with no props the panel
// reads browserExtensions from useSettingsStore and persists via updateSettings
// -> invokeStrict("update_settings", ...). Mock only the IPC boundary; the real
// settings store runs.
vi.mock("../../lib/tauriInvoke", () => ({
  invokeStrict: vi.fn(),
  safeInvoke: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockInvokeStrict = vi.mocked(invokeStrict);

function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    activeProfileId: "prof-1",
    appLanguage: "en",
    startupBehavior: "normal",
    portableMode: false,
    theme: "dark",
    reducedEffects: "auto",
    aiProviders: [],
    defaultAiProviderIndex: 0,
    browserProfileRootPath: "/tmp/profile",
    databasePath: "/tmp/db.sqlite",
    auditLogRetentionDays: 30,
    automationEvidenceRetentionDays: 30,
    browserExtensions: [],
    automationHeadless: true,
    automationHeadlessOverrides: {},
    aiAutoInit: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvokeStrict.mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: makeSettings({ browserExtensions: ["/ext/existing"] }),
    isLoading: false,
    error: null,
  });
});
afterEach(cleanup);

describe("BrowserExtensionsPanel - store-backed (no value/onChange)", () => {
  it("renders extension paths read from the settings store", () => {
    render(<BrowserExtensionsPanel />);
    expect(screen.getByText("/ext/existing")).toBeTruthy();
  });

  it("persists an added path via update_settings and re-renders the list", async () => {
    render(<BrowserExtensionsPanel />);

    fireEvent.change(screen.getByLabelText(/add extension path/i), {
      target: { value: "/ext/new" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(mockInvokeStrict).toHaveBeenCalledTimes(1));
    expect(mockInvokeStrict).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({
        browserExtensions: ["/ext/existing", "/ext/new"],
      }),
    });
    // Optimistic store write re-renders the panel with the new path.
    expect(await screen.findByText("/ext/new")).toBeTruthy();
  });

  it("persists a removal via update_settings with the filtered array", async () => {
    render(<BrowserExtensionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /remove \/ext\/existing/i }));

    await waitFor(() => expect(mockInvokeStrict).toHaveBeenCalledTimes(1));
    expect(mockInvokeStrict).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({ browserExtensions: [] }),
    });
  });

  it("does not write when the store has no settings loaded yet", () => {
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    render(<BrowserExtensionsPanel />);

    // Empty-state placeholder, and adding a path is a no-op (updateSettings bails
    // when settings is null).
    expect(screen.getByText(/no extensions configured/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/add extension path/i), {
      target: { value: "/ext/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(mockInvokeStrict).not.toHaveBeenCalled();
  });
});
