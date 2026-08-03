/**
 * EmbeddedBrowser — a real Chromium running HEADLESS in the backend, streamed into a canvas over CDP
 * with clicks/typing/scroll/navigation forwarded back. Fills its parent (no page chrome) so it can be
 * dropped into a tab of the preview viewer. Opens on mount, closes on unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowReloadHorizontalIcon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "./ui/Icon";
import type { PreviewFrame } from "../types/preview";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
// DuckDuckGo tolerates headless far better than Google (which walls the pane with an endless
// "verify you're human" challenge). Users can still type any URL.
const HOME = "https://duckduckgo.com/";

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return HOME;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function EmbeddedBrowser() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<string | null>(null);
  const lastSizeRef = useRef<string>("");
  const [input, setInput] = useState(HOME);
  const [status, setStatus] = useState<"connecting" | "live" | "idle" | "error">(
    inTauri ? "connecting" : "idle",
  );
  const [detail, setDetail] = useState("");

  const toViewportCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const handle = handleRef.current;
    if (handle) void invoke("preview_input", { handle, event }).catch(() => {});
  }, []);

  const sendResize = useCallback(() => {
    const handle = handleRef.current;
    const el = contentRef.current;
    if (!handle || !el) return;
    const w = Math.round(el.clientWidth);
    const h = Math.round(el.clientHeight);
    if (w < 2 || h < 2) return;
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const key = `${w}x${h}@${scale}`;
    if (key === lastSizeRef.current) return;
    lastSizeRef.current = key;
    void invoke("preview_resize", { handle, width: w, height: h, scale }).catch(() => {});
  }, []);

  const go = useCallback(
    (raw?: string) => {
      const next = normalizeUrl(raw ?? input);
      setInput(next);
      const handle = handleRef.current;
      if (handle) void invoke("preview_navigate", { handle, url: next }).catch(() => {});
    },
    [input],
  );

  useEffect(() => {
    if (!inTauri) return;
    let closed = false;
    let lastSeq = -1;

    const channel = new Channel<PreviewFrame>();
    channel.onmessage = (frame) => {
      if (closed || frame.seq <= lastSeq) return;
      lastSeq = frame.seq;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const img = new Image();
      img.onload = () => {
        if (closed) return;
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setStatus("live");
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    };

    invoke<string>("preview_open", { url: HOME, headless: true, channel })
      .then((h) => {
        handleRef.current = h;
        if (closed) {
          void invoke("preview_close", { handle: h }).catch(() => {});
          return;
        }
        sendResize();
      })
      .catch((e) => {
        if (!closed) {
          setStatus("error");
          setDetail(String(e));
        }
      });

    return () => {
      closed = true;
      const h = handleRef.current;
      handleRef.current = null;
      if (h) void invoke("preview_close", { handle: h }).catch(() => {});
    };
  }, [sendResize]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let t: number | null = null;
    const ro = new ResizeObserver(() => {
      if (t !== null) window.clearTimeout(t);
      t = window.setTimeout(() => {
        t = null;
        sendResize();
      }, 120);
    });
    ro.observe(el);
    return () => {
      if (t !== null) window.clearTimeout(t);
      ro.disconnect();
    };
  }, [sendResize]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {/* Toolbar — terax PreviewAddressBar: ghost icon buttons + a muted URL field on a card/40 bar */}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(input);
              } else if (e.key === "Escape") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
      </div>

      <div ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          className="block h-full w-full outline-none"
          onClick={(e) => {
            canvasRef.current?.focus();
            send({ kind: "click", ...toViewportCoords(e) });
          }}
          onWheel={(e) => send({ kind: "wheel", ...toViewportCoords(e), deltaY: e.deltaY })}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            e.preventDefault();
            send({
              kind: "keydown",
              key: e.key,
              code: e.code,
              keyCode: e.keyCode || (e as unknown as { which: number }).which || 0,
              text: e.key.length === 1 ? e.key : "",
            });
          }}
          onKeyUp={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            e.preventDefault();
            send({
              kind: "keyup",
              key: e.key,
              code: e.code,
              keyCode: e.keyCode || (e as unknown as { which: number }).which || 0,
            });
          }}
        />
        {status !== "live" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surf p-4 text-center text-sm text-fg-muted">
            {status === "connecting" && "Starting the embedded browser…"}
            {status === "idle" && "The embedded browser is only available in the desktop app."}
            {status === "error" && `Browser unavailable: ${detail}`}
          </div>
        )}
      </div>
    </div>
  );
}

export default EmbeddedBrowser;
