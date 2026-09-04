import type { RefObject } from "react";
import {
  ArrowLeft02Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight02Icon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "./ui/Icon";
import type { EmbeddedBrowserStatus } from "./embedded-browser-session";

interface ViewProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  input: string;
  status: EmbeddedBrowserStatus;
  detail: string;
  setInput: (value: string) => void;
  go: (raw?: string) => void;
  send: (event: Record<string, unknown>) => void;
  toViewportCoords: (event: { clientX: number; clientY: number }) => { x: number; y: number };
}

function BrowserToolbar(props: Pick<ViewProps, "input" | "setInput" | "go" | "send">) {
  const { input, setInput, go, send } = props;
  return (
    <div className="flex min-h-9 min-w-0 shrink-0 flex-wrap items-center gap-1 border-b border-bd/60 bg-surf/40 px-1.5 py-1">
      <button
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        title="Back"
        aria-label="Back"
        onClick={() => send({ kind: "back" })}
      >
        <Icon icon={ArrowLeft02Icon} size={14} strokeWidth={1.75} />
      </button>
      <button
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        title="Forward"
        aria-label="Forward"
        onClick={() => send({ kind: "forward" })}
      >
        <Icon icon={ArrowRight02Icon} size={14} strokeWidth={1.75} />
      </button>
      <button
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        title="Reload"
        aria-label="Reload"
        onClick={() => send({ kind: "reload" })}
      >
        <Icon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={1.75} />
      </button>
      <div className="flex min-w-28 flex-1 items-center gap-1.5 rounded-md bg-sunken/60 px-2">
        <Icon icon={Globe02Icon} size={13} strokeWidth={1.75} />
        <input
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-muted/70"
          value={input}
          spellCheck={false}
          autoComplete="off"
          placeholder="Enter a URL and press Enter"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              go(input);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </div>
  );
}

function BrowserCanvas(props: Pick<ViewProps, "canvasRef" | "send" | "toViewportCoords">) {
  const { canvasRef, send, toViewportCoords } = props;
  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="block h-full w-full outline-none"
      onClick={(event) => {
        canvasRef.current?.focus();
        send({ kind: "click", ...toViewportCoords(event) });
      }}
      onWheel={(event) => send({ kind: "wheel", ...toViewportCoords(event), deltaY: event.deltaY })}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        send({
          kind: "keydown",
          key: event.key,
          code: event.code,
          keyCode: event.keyCode || (event as unknown as { which: number }).which || 0,
          text: event.key.length === 1 ? event.key : "",
        });
      }}
      onKeyUp={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        send({
          kind: "keyup",
          key: event.key,
          code: event.code,
          keyCode: event.keyCode || (event as unknown as { which: number }).which || 0,
        });
      }}
    />
  );
}

function BrowserStatus({ status, detail }: Pick<ViewProps, "status" | "detail">) {
  if (status === "live") return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surf p-4 text-center text-sm text-fg-muted">
      {status === "connecting" && "Starting the embedded browser…"}
      {status === "idle" && "The embedded browser is only available in the desktop app."}
      {status === "error" && `Browser unavailable: ${detail}`}
    </div>
  );
}

export function EmbeddedBrowserView(props: ViewProps) {
  const { contentRef, status, detail } = props;
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <BrowserToolbar {...props} />
      <div ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
        <BrowserCanvas {...props} />
        <BrowserStatus status={status} detail={detail} />
      </div>
    </div>
  );
}
