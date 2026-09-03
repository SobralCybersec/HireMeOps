// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

it("automatically loads models for a persisted logged-in session", async () => {
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_status") {
      return [{ site: "chatgpt", initialized: true, running: true, loggedIn: true }];
    }
    if (cmd === "browser_provider_models") return ["gpt-5", "o3"];
    return null;
  });

  render(<BrowserProviderPanel value={VALUE} onUpdate={vi.fn()} />);

  expect(await screen.findByText("gpt-5")).toBeTruthy();
  expect(screen.getByText("o3")).toBeTruthy();
  expect(mockSafeInvoke).toHaveBeenCalledWith("browser_provider_models", {
    site: "chatgpt",
  });
});

it("loads models automatically after a successful login", async () => {
  mockInvokeStrict.mockResolvedValueOnce(undefined);
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_models") return ["gpt-5"];
    if (cmd === "browser_provider_status") {
      return [{ site: "chatgpt", initialized: false, running: false, loggedIn: false }];
    }
    return null;
  });

  render(<BrowserProviderPanel value={VALUE} onUpdate={vi.fn()} />);

  // ChatGPT is the only site; click its "Log in".
  fireEvent.click(await screen.findByRole("button", { name: "Log in" }));

  expect(await screen.findByText("gpt-5")).toBeTruthy();
  expect(mockInvokeStrict).toHaveBeenCalledWith("browser_provider_login", {
    site: "chatgpt",
  });
  expect(mockSafeInvoke).toHaveBeenCalledWith("browser_provider_models", {
    site: "chatgpt",
  });
});

it("selects newest thinking model when automatic model is active", async () => {
  const onUpdate = vi.fn();
  const value = { ...VALUE, defaultModel: "chatgpt/chatgpt-web-session" };
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_models") {
      return ["chatgpt-web-session", "gpt-5.5", "gpt-5-5-thinking", "gpt-5-6", "gpt-5-6-thinking"];
    }
    return null;
  });

  render(<BrowserProviderPanel value={value} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));

  expect(await screen.findByText("gpt-5-6-thinking")).toBeTruthy();
  expect(onUpdate).toHaveBeenCalledWith({ defaultModel: "chatgpt/gpt-5-6-thinking" });
});

it("falls back to chatgpt-web-session when no stronger model is listed", async () => {
  const onUpdate = vi.fn();
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_models") return ["chatgpt-web-session"];
    return null;
  });

  render(<BrowserProviderPanel value={VALUE} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));

  expect(await screen.findByText("chatgpt-web-session")).toBeTruthy();
  expect(onUpdate).toHaveBeenCalledWith({ defaultModel: "chatgpt/chatgpt-web-session" });
});

it("keeps an explicitly selected model when models refresh", async () => {
  const onUpdate = vi.fn();
  const value = { ...VALUE, defaultModel: "chatgpt/gpt-5-5" };
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_models") return ["gpt-5-6-thinking", "gpt-5-5"];
    return null;
  });

  render(<BrowserProviderPanel value={value} onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole("button", { name: "Load models" }));

  expect(await screen.findByText("gpt-5-6-thinking")).toBeTruthy();
  expect(onUpdate).not.toHaveBeenCalled();
});

it("logs out of ChatGPT from the provider row", async () => {
  mockSafeInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "browser_provider_status") {
      return [{ site: "chatgpt", initialized: true, running: true, loggedIn: true }];
    }
    return null;
  });
  mockInvokeStrict.mockResolvedValue(undefined);

  render(<BrowserProviderPanel value={VALUE} onUpdate={vi.fn()} />);

  const logoutButton = await screen.findByRole("button", { name: "Log out" });
  fireEvent.click(logoutButton);

  expect(mockInvokeStrict).toHaveBeenCalledWith("browser_provider_logout", {
    site: "chatgpt",
  });
});
