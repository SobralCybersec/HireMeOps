import { useEffect, useState, type RefObject } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { PREVIEW_CLOSE_LIVE, PREVIEW_OPEN_LIVE, type PreviewFrame } from "../types/preview";

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
type PreviewStatus = "connecting" | "live" | "idle" | "error";

export function useBrowserPreviewSession(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  handle: string | null,
) {
  const [status, setStatus] = useState<PreviewStatus>(IN_TAURI ? "connecting" : "idle");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!IN_TAURI) return;
    let closed = false;
    let attached: string | null = null;
    let lastSeq = -1;
    let lastFrameAt = Date.now();
    const channel = new Channel<PreviewFrame>();
    channel.onmessage = (frame) => {
      if (closed || frame.seq <= lastSeq) return;
      lastSeq = frame.seq;
      lastFrameAt = Date.now();
      const canvas = canvasRef.current;
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
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attach = () => {
      invoke<string>(PREVIEW_OPEN_LIVE, { handle, channel })
        .then((next) => {
          attached = next;
          lastFrameAt = Date.now();
          if (closed) void invoke(PREVIEW_CLOSE_LIVE, { handle: next }).catch(() => {});
        })
        .catch((error) => {
          if (closed) return;
          setStatus("error");
          setDetail(String(error));
          retry = setTimeout(attach, 2500);
        });
    };
    attach();
    const watchdog = setInterval(() => {
      if (closed || !attached || Date.now() - lastFrameAt < 5000) return;
      const previous = attached;
      attached = null;
      lastFrameAt = Date.now();
      void invoke(PREVIEW_CLOSE_LIVE, { handle: previous })
        .catch(() => {})
        .finally(() => {
          if (!closed) attach();
        });
    }, 2500);
    return () => {
      closed = true;
      clearInterval(watchdog);
      if (retry) clearTimeout(retry);
      if (attached) void invoke(PREVIEW_CLOSE_LIVE, { handle: attached }).catch(() => {});
    };
  }, [canvasRef, handle]);

  return { status, detail };
}
