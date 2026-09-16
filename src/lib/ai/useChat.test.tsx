/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { loadChatMessages, saveChatMessages, useChat } from "./useChat";

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

function emptyStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

const userMessage: UIMessage = {
  id: "saved-1",
  role: "user",
  parts: [{ type: "text", text: "saved", state: "done" }],
};

function installStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
}

beforeEach(installStorage);

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useChat", () => {
  it("loads only valid persisted messages and tolerates storage failures", () => {
    window.localStorage.setItem("history", JSON.stringify([userMessage, { id: 2 }, null]));
    expect(loadChatMessages("history")).toEqual([userMessage]);

    window.localStorage.setItem("history", "not-json");
    expect(loadChatMessages("history")).toEqual([]);

    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveChatMessages("history", [userMessage])).not.toThrow();
    setItem.mockRestore();
  });

  it("uses initial messages, ignores blank input, and clears an error", async () => {
    const transport = {
      sendMessages: vi.fn(async () => emptyStream()),
      reconnectToStream: () => Promise.resolve(null),
    } as ChatTransport<UIMessage>;
    const { result } = renderHook(() =>
      useChat({ chatId: "test-chat", transport, initialMessages: [userMessage] }),
    );

    await act(async () => {
      await result.current.sendMessage({ text: "  " });
    });
    expect(result.current.messages).toEqual([userMessage]);
    expect(transport.sendMessages).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.sendMessage({ text: "request" });
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("AI provider returned no assistant message");
    act(() => result.current.clearError());
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeUndefined();
  });
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

  it("maps transport errors and supports aborting an in-flight request", async () => {
    const rejected = {
      sendMessages: vi.fn(async () => {
        throw { reason: "offline" };
      }),
      reconnectToStream: () => Promise.resolve(null),
    } as ChatTransport<UIMessage>;
    const failed = renderHook(() => useChat({ chatId: "failed", transport: rejected }));
    await act(async () => {
      await failed.result.current.sendMessage({ text: "hello" });
    });
    await waitFor(() => expect(failed.result.current.status).toBe("error"));
    expect(failed.result.current.error?.message).toBe("AI chat request failed");

    let release!: (stream: ReadableStream<UIMessageChunk>) => void;
    const pending = {
      sendMessages: vi.fn(
        () =>
          new Promise<ReadableStream<UIMessageChunk>>((resolve) => {
            release = resolve;
          }),
      ),
      reconnectToStream: () => Promise.resolve(null),
    } as ChatTransport<UIMessage>;
    const running = renderHook(() => useChat({ chatId: "pending", transport: pending }));
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = running.result.current.sendMessage({ text: "stop me" });
    });
    await waitFor(() => expect(pending.sendMessages).toHaveBeenCalled());
    act(() => running.result.current.stop());
    release(assistantStream());
    await act(async () => {
      await sendPromise;
    });
    expect(running.result.current.status).toBe("ready");
    expect(running.result.current.error).toBeUndefined();
  });
});
