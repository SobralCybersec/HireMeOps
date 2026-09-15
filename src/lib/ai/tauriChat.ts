import { Channel } from "@tauri-apps/api/core";
import {
  convertToModelMessages,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { invokeStrict } from "../tauri/tauriInvoke";

export type ChatStreamEvent =
  | { type: "start"; messageId: string }
  | { type: "textDelta"; messageId: string; delta: string }
  | { type: "toolCall"; toolCallId: string; toolName: string; input: unknown }
  | { type: "toolResult"; toolCallId: string; output: unknown }
  | { type: "finish"; messageId: string }
  | { type: "abort"; messageId: string };

type SendMessagesArgs = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];
type StreamController = ReadableStreamDefaultController<UIMessageChunk>;

interface StreamContext {
  runId: string;
  abortSignal?: AbortSignal;
  controller: StreamController;
  closed: boolean;
  textStarted: boolean;
  textEnded: boolean;
  onAbort?: () => void;
}

function newRunId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cancelRun(runId: string): void {
  void invokeStrict("chat_cancel", { runId }).catch(() => undefined);
}

function closeStream(context: StreamContext): void {
  if (context.closed) return;
  context.closed = true;
  if (context.onAbort) context.abortSignal?.removeEventListener("abort", context.onAbort);
  context.controller.close();
}

function abortStream(context: StreamContext): void {
  if (context.closed) return;
  cancelRun(context.runId);
  if (context.textStarted && !context.textEnded) {
    context.textEnded = true;
    context.controller.enqueue({ type: "text-end", id: context.runId });
  }
  context.controller.enqueue({ type: "abort" });
  closeStream(context);
}

function handleTextDelta(
  context: StreamContext,
  event: Extract<ChatStreamEvent, { type: "textDelta" }>,
): void {
  if (!context.textStarted) {
    context.textStarted = true;
    context.controller.enqueue({ type: "text-start", id: event.messageId });
  }
  context.controller.enqueue({ type: "text-delta", id: event.messageId, delta: event.delta });
}

function handleFinish(
  context: StreamContext,
  event: Extract<ChatStreamEvent, { type: "finish" }>,
): void {
  if (context.textStarted && !context.textEnded) {
    context.textEnded = true;
    context.controller.enqueue({ type: "text-end", id: event.messageId });
  }
  context.controller.enqueue({ type: "finish" });
  closeStream(context);
}

function handleStreamEvent(context: StreamContext, event: ChatStreamEvent): void {
  if (context.closed) return;
  switch (event.type) {
    case "start":
      context.controller.enqueue({ type: "start", messageId: event.messageId });
      return;
    case "textDelta":
      handleTextDelta(context, event);
      return;
    case "toolCall":
      context.controller.enqueue({
        type: "tool-input-available",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        input: event.input,
      });
      return;
    case "toolResult":
      context.controller.enqueue({
        type: "tool-output-available",
        toolCallId: event.toolCallId,
        output: event.output,
      });
      return;
    case "finish":
      handleFinish(context, event);
      return;
    case "abort":
      abortStream(context);
  }
}

function connectStream(
  context: StreamContext,
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>,
): void {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (event) => handleStreamEvent(context, event);
  context.onAbort = () => abortStream(context);
  if (context.abortSignal?.aborted) {
    context.onAbort();
    return;
  }
  context.abortSignal?.addEventListener("abort", context.onAbort, { once: true });
  void invokeStrict<void>("chat_stream", {
    request: { runId: context.runId, messages: modelMessages },
    channel,
  })
    .then(() => closeStream(context))
    .catch((error: unknown) => {
      if (context.closed) return;
      context.closed = true;
      if (context.onAbort) context.abortSignal?.removeEventListener("abort", context.onAbort);
      context.controller.error(error);
    });
}

function createTauriStream(
  runId: string,
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>,
  abortSignal?: AbortSignal,
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      connectStream(
        {
          runId,
          abortSignal,
          controller,
          closed: false,
          textStarted: false,
          textEnded: false,
        },
        modelMessages,
      );
    },
    cancel() {
      cancelRun(runId);
    },
  });
}

async function sendMessages({ messages, abortSignal }: SendMessagesArgs) {
  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
  });
  return createTauriStream(newRunId(), modelMessages, abortSignal);
}

/** AI SDK 7 transport backed by a Tauri Channel. */
export function createTauriChatTransport(): ChatTransport<UIMessage> {
  return { sendMessages, reconnectToStream: () => Promise.resolve(null) };
}
