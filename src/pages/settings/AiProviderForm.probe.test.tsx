// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiProviderForm } from "./AiProviderForm";
import { invokeStrict } from "../../lib/tauriInvoke";
import type { AiProviderSettings } from "../../types/settings";

// Mock the Tauri IPC boundary - the "Test provider" button fires a real
// end-to-end reachability probe via invokeStrict("test_provider", ...). We never
// hit a backend; we assert the command + args and how the result is reflected.
vi.mock("../../lib/tauriInvoke", () => ({
  invokeStrict: vi.fn(),
  safeInvoke: vi.fn(),
  errMessage: (e: unknown): string =>
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e),
}));

const mockInvokeStrict = vi.mocked(invokeStrict);

// The browser-only form fires a single end-to-end reachability probe via
// invokeStrict("test_provider", ...). Each test installs just the outcome it
// cares about (a resolved ProbeResult or a rejection).
type ProbeResult = { ok: boolean; message: string; errorKind?: string | null };
function installProbe(probe: ProbeResult | { throws: unknown }) {
  mockInvokeStrict.mockImplementation(() => {
    if ("throws" in probe) return Promise.reject(probe.throws);
    return Promise.resolve(probe);
  });
}

function makeProvider(over: Partial<AiProviderSettings> = {}): AiProviderSettings {
  return {
    kind: "browser",
    label: "Browser (free)",
    endpointUrl: "",
    apiKeyStored: false,
    defaultModel: "chatgpt/gpt-5",
    authKind: "api_key",
    ...over,
  };
}

function renderForm(over: Partial<AiProviderSettings> = {}) {
  return render(
    <AiProviderForm
      kind={makeProvider(over).kind}
      value={makeProvider(over)}
      isDefault
      onUpdate={vi.fn()}
      onSetDefault={vi.fn()}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AiProviderForm - test_provider probe (invoke boundary)", () => {
  it("invokes test_provider with the provider's connection fields", async () => {
    installProbe({ ok: true, message: "Reachable" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /test provider/i }));

    await waitFor(() =>
      expect(mockInvokeStrict).toHaveBeenCalledWith("test_provider", {
        kind: "browser",
        endpointUrl: "",
        defaultModel: "chatgpt/gpt-5",
        authKind: "api_key",
      }),
    );
  });

  it("passes authKind 'oauth' through for subscription-login providers", async () => {
    // The only real OAuth surface in the FE: authKind rides the probe payload.
    installProbe({ ok: true, message: "ok" });
    renderForm({ authKind: "oauth" });

    fireEvent.click(screen.getByRole("button", { name: /test provider/i }));

    await waitFor(() =>
      expect(mockInvokeStrict).toHaveBeenCalledWith(
        "test_provider",
        expect.objectContaining({ authKind: "oauth" }),
      ),
    );
  });

  it("reflects a reachable result as a success message", async () => {
    installProbe({ ok: true, message: "Connected OK" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /test provider/i }));

    expect(await screen.findByText("Connected OK")).toBeTruthy();
  });

  it("reflects an ok=false result as an error message", async () => {
    installProbe({ ok: false, message: "401 Unauthorized", errorKind: "auth" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /test provider/i }));

    const msg = await screen.findByText("401 Unauthorized");
    expect(msg).toBeTruthy();
    expect(msg.className).toContain("is-error");
  });

  it("surfaces a thrown backend error instead of swallowing it", async () => {
    installProbe({ throws: "backend exploded" });
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: /test provider/i }));

    expect(await screen.findByText(/backend exploded/)).toBeTruthy();
  });
});
