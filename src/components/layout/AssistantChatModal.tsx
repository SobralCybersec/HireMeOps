import { useEffect, useMemo, useRef, useState } from "react";
import { AiChat01Icon, ArrowUp02Icon, Cancel01Icon, SquareIcon } from "@hugeicons/core-free-icons";
import type { UIMessage } from "ai";
import { Button, Icon, Textarea } from "./ui";
import { createTauriChatTransport } from "../lib/ai/tauriChat";
import { useChat, type ChatStatus } from "../lib/ai/useChat";
import "./AssistantChatModal.css";

interface AssistantChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MessagePart = UIMessage["parts"][number];

function partText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isToolPart(part: MessagePart): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function toolValue(part: MessagePart) {
  return part as unknown as {
    type: string;
    toolName?: string;
    state?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
}

function toolPre(value: unknown) {
  return value === undefined ? null : <pre>{jsonText(value)}</pre>;
}

function ToolPart({ part }: { part: MessagePart }) {
  if (!isToolPart(part)) return null;
  const value = toolValue(part);
  const toolName = value.toolName ?? value.type.slice(5);
  return (
    <details className="assistant-chat__tool">
      <summary>
        <span className="assistant-chat__tool-dot" />
        <strong>{toolName}</strong>
        <span>{value.state ?? "available"}</span>
      </summary>
      {toolPre(value.input)}
      {toolPre(value.errorText ?? value.output)}
    </details>
  );
}

function MessageRow({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const text = partText(message);
  return (
    <article className={`assistant-chat__message assistant-chat__message--${message.role}`}>
      <div className="assistant-chat__message-label">{message.role === "user" ? "You" : "ENI"}</div>
      {text && (
        <div className="assistant-chat__message-text" aria-live={streaming ? "polite" : undefined}>
          {text}
        </div>
      )}
      {message.parts.map((part, index) => (
        <ToolPart key={`${message.id}-${index}`} part={part} />
      ))}
    </article>
  );
}

function ChatHeader({ status, onClose }: { status: ChatStatus; onClose: () => void }) {
  return (
    <header className="assistant-chat__header">
      <div className="assistant-chat__title">
        <Icon icon={AiChat01Icon} size={18} />
        <h2 id="assistant-chat-title">AI assistant</h2>
        <span className={`assistant-chat__status assistant-chat__status--${status}`} role="status">
          {status}
        </span>
      </div>
      <Button
        aria-label="Close AI assistant"
        icon={<Icon icon={Cancel01Icon} size={16} />}
        onClick={onClose}
      />
    </header>
  );
}

function ChatMessages({
  messages,
  status,
  scrollRef,
}: {
  messages: UIMessage[];
  status: ChatStatus;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lastMessageId = messages[messages.length - 1]?.id;
  return (
    <div ref={scrollRef} className="assistant-chat__messages" role="log" aria-live="polite">
      {messages.length === 0 ? (
        <div className="assistant-chat__empty">
          <Icon icon={AiChat01Icon} size={28} />
          <strong>Assistant standing by</strong>
          <span>Ask about profiles, CVs, jobs, or application workflow.</span>
        </div>
      ) : (
        messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            streaming={status === "streaming" && message.id === lastMessageId}
          />
        ))
      )}
    </div>
  );
}

function ChatComposer({
  busy,
  inputRef,
  onSend,
  onStop,
}: {
  busy: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState("");
  const send = () => {
    const value = input.trim();
    if (!value || busy) return;
    setInput("");
    onSend(value);
  };
  return (
    <form
      className="assistant-chat__composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Textarea
        ref={inputRef}
        rows={2}
        value={input}
        placeholder="Ask the assistant… Enter to send, Shift+Enter for newline"
        disabled={busy}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      {busy ? (
        <Button
          variant="danger"
          aria-label="Stop response"
          icon={<Icon icon={SquareIcon} size={15} />}
          onClick={onStop}
        >
          Stop
        </Button>
      ) : (
        <Button
          variant="primary"
          type="submit"
          disabled={!input.trim()}
          icon={<Icon icon={ArrowUp02Icon} size={15} />}
        >
          Send
        </Button>
      )}
    </form>
  );
}

export function AssistantChatModal({ open, onOpenChange }: AssistantChatModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transport = useMemo(() => createTauriChatTransport(), []);
  const { messages, status, error, sendMessage, stop } = useChat({
    chatId: "hiremeops-assistant",
    transport,
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      inputRef.current?.focus();
    } else if (dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages, status]);

  function close() {
    onOpenChange(false);
  }

  return (
    <dialog
      ref={dialogRef}
      className="assistant-chat-modal"
      aria-labelledby="assistant-chat-title"
      onClose={close}
    >
      <div className="assistant-chat">
        <ChatHeader status={status} onClose={close} />
        <ChatMessages messages={messages} status={status} scrollRef={scrollRef} />
        {error && (
          <div className="assistant-chat__error" role="alert">
            {error.message}
          </div>
        )}
        <ChatComposer
          busy={busy}
          inputRef={inputRef}
          onSend={(text) => void sendMessage({ text })}
          onStop={stop}
        />
      </div>
    </dialog>
  );
}
