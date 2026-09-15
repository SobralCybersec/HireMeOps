/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { useChat } from "./useChat";

function assistantStream(): ReadableStream<UIMessageChunk> {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: "assistant-1" },
    { type: "text-start", id: "assistant-1" },
    { type: "text-delta", id: "assistant-1", delta: "Ready." },
    { type: "text-end", id: "assistant-1" },
    { type: "finish" },
  ];
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

describe("useChat", () => {
  it("keeps user history and replaces streamed assistant message once", async () => {
    const sendMessages = vi.fn(async () => assistantStream());
    const transport = {
      sendMessages,
      reconnectToStream: () => Promise.resolve(null),
    } as ChatTransport<UIMessage>;
    const { result } = renderHook(() =>
      useChat({ chatId: "test-chat", transport, storageKey: "test-chat-history" }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: " hello " });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(sendMessages).toHaveBeenCalledOnce();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "hello",
    });
    expect(result.current.messages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "Ready.",
    });
  });
});
