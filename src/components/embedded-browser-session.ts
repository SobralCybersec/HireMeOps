import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { PreviewFrame } from "../types/preview";

export const EMBEDDED_BROWSER_HOME = "https://duckduckgo.com/";
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const HTTP_URL = new RegExp("^https?://", "i");

export type EmbeddedBrowserStatus = "connecting" | "live" | "idle" | "error";

export interface EmbeddedBrowserRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  handleRef: MutableRefObject<string | null>;
  lastSizeRef: MutableRefObject<string>;
}

function previewUrl(raw: string) {
  const value = raw.trim();
  if (!value) return EMBEDDED_BROWSER_HOME;
  return HTTP_URL.test(value) ? value : `https://${value}`;
}

function sendPreviewEvent(
  handleRef: MutableRefObject<string | null>,
  event: Record<string, unknown>,
) {
  const handle = handleRef.current;
  if (handle) void invoke("preview_input", { handle, event }).catch(() => {});
}

function sendPreviewResize(
  contentRef: RefObject<HTMLDivElement | null>,
  handleRef: MutableRefObject<string | null>,
  lastSizeRef: MutableRefObject<string>,
) {
  const handle = handleRef.current;
  const element = contentRef.current;
  if (!handle || !element) return;
  const width = Math.round(element.clientWidth);
  const height = Math.round(element.clientHeight);
  if (width < 2 || height < 2) return;
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const key = `${width}x${height}@${scale}`;
  if (key === lastSizeRef.current) return;
  lastSizeRef.current = key;
  void invoke("preview_resize", { handle, width, height, scale }).catch(() => {});
}

function navigatePreview(
  handleRef: MutableRefObject<string | null>,
  raw: string,
  setInput: (value: string) => void,
) {
  const url = previewUrl(raw);
  setInput(url);
  const handle = handleRef.current;
  if (handle) void invoke("preview_navigate", { handle, url }).catch(() => {});
}

function usePreviewConnection(
  refs: EmbeddedBrowserRefs,
  sendResize: () => void,
  setStatus: (status: EmbeddedBrowserStatus) => void,
  setDetail: (detail: string) => void,
) {
  useEffect(() => {
    if (!IN_TAURI) return;
    let closed = false;
    let lastSeq = -1;
    const channel = new Channel<PreviewFrame>();
    channel.onmessage = (frame) => {
      if (closed || frame.seq <= lastSeq) return;
      lastSeq = frame.seq;
      const canvas = refs.canvasRef.current;
      if (!canvas) return;
      const image = new Image();
      image.onload = () => {
        if (closed) return;
        canvas.width = frame.width;
        canvas.height = frame.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        setStatus("live");
      };
      image.src = `data:image/jpeg;base64,${frame.data}`;
    };
    invoke<string>("preview_open", { url: EMBEDDED_BROWSER_HOME, headless: true, channel })
      .then((handle) => {
        refs.handleRef.current = handle;
        if (closed) {
          void invoke("preview_close", { handle }).catch(() => {});
          return;
        }
        sendResize();
      })
      .catch((error) => {
        if (!closed) {
          setStatus("error");
          setDetail(String(error));
        }
      });
    return () => {
      closed = true;
      const handle = refs.handleRef.current;
      refs.handleRef.current = null;
      if (handle) void invoke("preview_close", { handle }).catch(() => {});
    };
  }, [refs, sendResize, setDetail, setStatus]);
}

function usePreviewResize(contentRef: RefObject<HTMLDivElement | null>, sendResize: () => void) {
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    let timer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        sendResize();
      }, 120);
    });
    observer.observe(element);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [contentRef, sendResize]);
}

export function useEmbeddedBrowserSession(refs: EmbeddedBrowserRefs) {
  const [input, setInput] = useState(EMBEDDED_BROWSER_HOME);
  const [status, setStatus] = useState<EmbeddedBrowserStatus>(IN_TAURI ? "connecting" : "idle");
  const [detail, setDetail] = useState("");
  const toViewportCoords = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = refs.canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [refs.canvasRef],
  );
  const send = useCallback(
    (event: Record<string, unknown>) => sendPreviewEvent(refs.handleRef, event),
    [refs.handleRef],
  );
  const sendResize = useCallback(() => {
    sendPreviewResize(refs.contentRef, refs.handleRef, refs.lastSizeRef);
  }, [refs.contentRef, refs.handleRef, refs.lastSizeRef]);
  const go = useCallback(
    (raw?: string) => navigatePreview(refs.handleRef, raw ?? input, setInput),
    [input, refs.handleRef],
  );
  usePreviewConnection(refs, sendResize, setStatus, setDetail);
  usePreviewResize(refs.contentRef, sendResize);
  return { input, setInput, status, detail, toViewportCoords, send, sendResize, go };
}
