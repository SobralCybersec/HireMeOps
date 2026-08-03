// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BrowserProviderPanel } from "./BrowserProviderPanel";
import { invokeStrict, safeInvoke } from "../../lib/tauriInvoke";
import type { AiProviderSettings } from "../../types/settings";

// Replace the Tauri IPC boundary before the panel is imported. safeInvoke is
// graceful (returns null on failure); invokeStrict throws. errMessage keeps its
// real logic so error-string assertions stay stable.
vi.mock("../../lib/tauriInvoke", () => ({
  safeInvoke: vi.fn(),
  invokeStrict: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockSafeInvoke = vi.mocked(safeInvoke);
const mockInvokeStrict = vi.mocked(invokeStrict);

const VALUE: AiProviderSettings = {
  kind: "browser",
  label: "Browser (free)",
  endpointUrl: "",
  apiKeyStored: false,
  defaultModel: "chatgpt",
  authKind: "api_key",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: status read returns nothing (every site logged-out).
  mockSafeInvoke.mockResolvedValue(null);
});
afterEach(cleanup);

describe("BrowserProviderPanel", () => {
  it("loads and renders a site's websession models when its Load models button is clicked", async () => {
    // status read → null; models read → a known list for chatgpt.
    mockSafeInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "browser_provider_models") return ["gpt-5", "gpt-4o", "o3"];
      return null;
    });

    render(<BrowserProviderPanel value={VALUE} onUpdate={vi.fn()} />);

    // Click the first "Load models" button (ChatGPT's row).
    const loadButtons = screen.getAllByText("Load models");
    fireEvent.click(loadButtons[0]);

    expect(await screen.findByText("gpt-5")).toBeTruthy();
    expect(screen.getByText("gpt-4o")).toBeTruthy();
    expect(screen.getByText("o3")).toBeTruthy();
    expect(mockSafeInvoke).toHaveBeenCalledWith("browser_provider_models", {
      site: "chatgpt",
    });
  });

  it("loads models automatically after a successful login", async () => {
    mockInvokeStrict.mockResolvedValueOnce(undefined);
    mockSafeInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "browser_provider_models") return ["gpt-5"];
      return null;
    });

    render(<BrowserProviderPanel value={VALUE} onUpdate={vi.fn()} />);

    // ChatGPT is the only site; click its "Log in".
    const loginButtons = screen.getAllByText("Log in");
    fireEvent.click(loginButtons[0]);

    expect(await screen.findByText("gpt-5")).toBeTruthy();
    expect(mockInvokeStrict).toHaveBeenCalledWith("browser_provider_login", {
      site: "chatgpt",
    });
    expect(mockSafeInvoke).toHaveBeenCalledWith("browser_provider_models", {
      site: "chatgpt",
    });
  });
});
