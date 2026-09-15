import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { readUIMessageStream, type ChatTransport, type UIMessage } from "ai";

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface UseChatOptions {
  chatId: string;
  transport: ChatTransport<UIMessage>;
  storageKey?: string;
  initialMessages?: UIMessage[];
}

type SetMessages = Dispatch<SetStateAction<UIMessage[]>>;

function isUiMessage(value: unknown): value is UIMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<UIMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant" || message.role === "system") &&
    Array.isArray(message.parts)
  );
}

export function loadChatMessages(storageKey: string): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return Array.isArray(value) ? value.filter(isUiMessage) : [];
  } catch {
    return [];
  }
}

export function saveChatMessages(storageKey: string, messages: UIMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(messages));
  } catch {
    // Private browsing and quota failures keep the live conversation usable.
  }
}

function newMessageId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorFrom(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "AI chat request failed");
}

interface StreamReplyArgs {
  chatId: string;
  history: UIMessage[];
  transport: ChatTransport<UIMessage>;
  controller: AbortController;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setMessages: SetMessages;
  messagesRef: MutableRefObject<UIMessage[]>;
}

async function streamReply(args: StreamReplyArgs): Promise<void> {
  const { chatId, history, transport, controller, setStatus, setMessages, messagesRef } = args;
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId,
    messageId: undefined,
    messages: history,
    abortSignal: controller.signal,
  });
  if (controller.signal.aborted) return;
  setStatus("streaming");
  let receivedAssistant = false;
  for await (const partial of readUIMessageStream({ stream })) {
    receivedAssistant = true;
    setMessages((current) => {
      const next = [...current.filter((message) => message.id !== partial.id), partial];
      messagesRef.current = next;
      return next;
    });
  }
  if (!receivedAssistant && !controller.signal.aborted) {
    throw new Error("AI provider returned no assistant message");
  }
}

interface SendMessageArgs {
  text: string;
  chatId: string;
  transport: ChatTransport<UIMessage>;
  setError: Dispatch<SetStateAction<Error | undefined>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setMessages: SetMessages;
  messagesRef: MutableRefObject<UIMessage[]>;
  abortRef: MutableRefObject<AbortController | null>;
}

async function sendChatMessage(args: SendMessageArgs): Promise<void> {
  const { text, chatId, transport, setError, setStatus, setMessages, messagesRef, abortRef } = args;
  const value = text.trim();
  if (!value || abortRef.current !== null) return;

  const userMessage: UIMessage = {
    id: newMessageId(),
    role: "user",
    parts: [{ type: "text", text: value, state: "done" }],
  };
  const history = [...messagesRef.current, userMessage];
  messagesRef.current = history;
  setMessages(history);
  setError(undefined);
  setStatus("submitted");

  const controller = new AbortController();
  abortRef.current = controller;
  try {
    await streamReply({
      chatId,
      history,
      transport,
      controller,
      setStatus,
      setMessages,
      messagesRef,
    });
    setStatus("ready");
  } catch (value) {
    if (controller.signal.aborted) setStatus("ready");
    else {
      setError(errorFrom(value));
      setStatus("error");
    }
  } finally {
    if (abortRef.current === controller) abortRef.current = null;
  }
}

function useMessagePersistence(storageKey: string, messages: UIMessage[]): void {
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    const timer = window.setTimeout(() => saveChatMessages(storageKey, messages), 200);
    return () => window.clearTimeout(timer);
  }, [messages, storageKey]);
  useEffect(() => () => saveChatMessages(storageKey, messagesRef.current), [storageKey]);
}

/** Small React adapter around AI SDK 7 ChatTransport for the Tauri webview. */
export function useChat(options: UseChatOptions) {
  const { chatId, transport, storageKey = "hiremeops:assistant-chat", initialMessages } = options;
  const [messages, setMessages] = useState<UIMessage[]>(
    () => initialMessages ?? loadChatMessages(storageKey),
  );
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<Error | undefined>();
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  useMessagePersistence(storageKey, messages);

  const sendMessage = useCallback(
    ({ text }: { text: string }) =>
      sendChatMessage({
        text,
        chatId,
        transport,
        setError,
        setStatus,
        setMessages,
        messagesRef,
        abortRef,
      }),
    [chatId, transport],
  );
  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clearError = useCallback(() => {
    setError(undefined);
    setStatus((current) => (current === "error" ? "ready" : current));
  }, []);

  return { messages, status, error, sendMessage, stop, clearError };
}
