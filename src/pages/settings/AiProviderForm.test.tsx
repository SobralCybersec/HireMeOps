// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AiProviderForm } from "./AiProviderForm";
import { isProviderConfigured } from "./providerMeta";
import type { AiProviderSettings } from "../../types/settings";

afterEach(cleanup);

function makeProvider(over: Partial<AiProviderSettings> = {}): AiProviderSettings {
  return {
    kind: "browser",
    label: "Browser (free)",
    endpointUrl: "",
    apiKeyStored: false,
    defaultModel: "",
    authKind: "api_key",
    ...over,
  };
}

describe("AiProviderForm", () => {
  it("renders the browser provider card with its labelled header", () => {
    render(
      <AiProviderForm
        kind="browser"
        value={makeProvider()}
        isDefault={false}
        onUpdate={vi.fn()}
        onSetDefault={vi.fn()}
      />,
    );
    expect(screen.getByText("Browser (free)")).toBeTruthy();
    // With no target site chosen yet the card reports "Not configured".
    expect(screen.getAllByText(/not configured/i).length).toBeGreaterThan(0);
  });

  it("fires onSetDefault when 'Set as default' is clicked", () => {
    const onSetDefault = vi.fn();
    render(
      <AiProviderForm
        kind="browser"
        value={makeProvider()}
        isDefault={false}
        onUpdate={vi.fn()}
        onSetDefault={onSetDefault}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /set as default/i }));
    expect(onSetDefault).toHaveBeenCalledTimes(1);
  });

  it("hides the selection button and shows a Default badge when active", () => {
    render(
      <AiProviderForm
        kind="browser"
        value={makeProvider()}
        isDefault
        onUpdate={vi.fn()}
        onSetDefault={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /set as default/i })).toBeNull();
    expect(screen.getByText("Default")).toBeTruthy();
  });

  it("marks the browser provider configured once a target site is chosen", () => {
    // The browser provider has no endpoint or API key — it is "configured" as
    // soon as a target site is encoded in defaultModel ("<site>/<model>").
    expect(isProviderConfigured(makeProvider())).toBe(false);
    expect(isProviderConfigured(makeProvider({ defaultModel: "   " }))).toBe(false);
    expect(isProviderConfigured(makeProvider({ defaultModel: "chatgpt/gpt-5" }))).toBe(true);
    // Endpoint/key are irrelevant to browser configuration.
    expect(isProviderConfigured(makeProvider({ endpointUrl: "x", apiKeyStored: true }))).toBe(
      false,
    );
  });
});
