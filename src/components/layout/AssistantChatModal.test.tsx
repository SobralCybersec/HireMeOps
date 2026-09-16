/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantChatModal } from "./AssistantChatModal";

const chatMock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
  messages: [],
  status: "ready",
  error: undefined as Error | undefined,
}));

vi.mock("../../lib/ai/useChat", () => ({
  useChat: () => chatMock,
}));

vi.mock("../../lib/ai/tauriChat", () => ({
  createTauriChatTransport: () => ({}),
}));

describe("AssistantChatModal", () => {
  beforeEach(() => {
    chatMock.sendMessage.mockReset();
    chatMock.stop.mockReset();
    chatMock.messages = [];
    chatMock.status = "ready";
    chatMock.error = undefined;
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(cleanup);

  it("opens, submits text, and reports close", async () => {
    const onOpenChange = vi.fn();
    render(<AssistantChatModal open onOpenChange={onOpenChange} />);

    await waitFor(() => expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true));
    const input = screen.getByPlaceholderText(/Ask the assistant/);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Close AI assistant" }));

    expect(chatMock.sendMessage).toHaveBeenCalledWith({ text: "hello" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders assistant messages, tool details, errors, and stop action", async () => {
    chatMock.status = "streaming";
    chatMock.error = new Error("provider offline");
    chatMock.messages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Find jobs", state: "done" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Searching", state: "done" },
          {
            type: "tool-search",
            toolName: "search",
            state: "output-available",
            input: { query: "jobs" },
            output: { count: 1 },
          },
        ],
      },
    ] as unknown as typeof chatMock.messages;
    const onOpenChange = vi.fn();
    render(<AssistantChatModal open onOpenChange={onOpenChange} />);

    expect(await screen.findByText("Find jobs")).toBeTruthy();
    expect(screen.getByText("Searching")).toBeTruthy();
    expect(screen.getByText("output-available")).toBeTruthy();
    expect(screen.getByText(/provider offline/)).toBeTruthy();
    const input = screen.getByPlaceholderText(/Ask the assistant/) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
    expect(chatMock.stop).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Close AI assistant" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses open attribute fallback when dialog.showModal is unavailable", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: undefined,
    });
    const { rerender } = render(<AssistantChatModal open onOpenChange={vi.fn()} />);
    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(dialog?.hasAttribute("open")).toBe(true));
    rerender(<AssistantChatModal open={false} onOpenChange={vi.fn()} />);
    expect(dialog?.hasAttribute("open")).toBe(false);
  });
});
