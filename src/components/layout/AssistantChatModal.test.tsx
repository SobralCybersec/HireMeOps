/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantChatModal } from "./AssistantChatModal";

const chatMock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../lib/ai/useChat", () => ({
  useChat: () => ({
    messages: [],
    status: "ready",
    error: undefined,
    sendMessage: chatMock.sendMessage,
    stop: chatMock.stop,
  }),
}));

vi.mock("../../lib/ai/tauriChat", () => ({
  createTauriChatTransport: () => ({}),
}));

describe("AssistantChatModal", () => {
  beforeEach(() => {
    chatMock.sendMessage.mockReset();
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
});
