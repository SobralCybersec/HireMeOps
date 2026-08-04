/**
 * Evidence Viewer — renders the LIVE automation session as it runs. On mount it opens a CDP
 * screencast of the worker's active page (preview_open_live) over a Tauri Channel and paints each
 * JPEG frame onto a canvas; on unmount it stops the stream. Off-Tauri (plain browser / screenshots)
 * it degrades to a static placeholder instead of invoking.
 */
import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { PREVIEW_OPEN_LIVE, PREVIEW_CLOSE_LIVE, type PreviewFrame } from "../types/preview";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Props = {
  /** Explicit session handle to view; omit to view the driver's current session. */
  handle?: string | null;
  className?: string;
};

export default function BrowserPreview({ handle = null, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "idle" | "error">(
    inTauri ? "connecting" : "idle",
  );
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    if (!inTauri) return;

    let closed = false;
    let attached: string | null = null;
    let lastSeq = -1;
    let lastFrameAt = Date.now();

    const channel = new Channel<PreviewFrame>();
    channel.onmessage = (frame) => {
      if (closed || frame.seq <= lastSeq) return; // drop stale/out-of-order frames
      lastSeq = frame.seq;
      lastFrameAt = Date.now();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const img = new Image();
      img.onload = () => {
        if (closed) return;
        if (canvas.width !== frame.width) canvas.width = frame.width;
        if (canvas.height !== frame.height) canvas.height = frame.height;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setStatus("live");
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    };

    let retry: ReturnType<typeof setTimeout> | undefined;
    // Keep re-attaching while there's no session yet, so a global pane opened BEFORE a run starts
    // latches onto whatever automation fires next (attaches to the driver's current_session).
    const attach = () => {
      invoke<string>(PREVIEW_OPEN_LIVE, { handle, channel })
        .then((h) => {
          attached = h;
          lastFrameAt = Date.now(); // fresh attach — don't let the watchdog fire immediately
          if (closed) void invoke(PREVIEW_CLOSE_LIVE, { handle: h }).catch(() => {});
        })
        .catch((e) => {
          if (closed) return;
          setStatus("error");
          setDetail(String(e));
          retry = setTimeout(attach, 2500);
        });
    };
    attach();

    // Staleness watchdog: when the attached automation ends (browser closed) its frames stop. Re-attach
    // to current_session — which by then points at the NEXT run — so run B auto-appears without the user
    // touching the pane. (A genuinely idle-but-alive page also goes quiet; re-attaching to the same
    // handle is cheap and startScreencast immediately re-sends a frame, so it just blips.)
    const STALE_MS = 5000;
    const watchdog = setInterval(() => {
      if (closed || !attached) return; // not attached yet → attach()'s own retry handles it
      if (Date.now() - lastFrameAt < STALE_MS) return;
      const prev = attached;
      attached = null;
      lastFrameAt = Date.now(); // reset so we don't re-fire before the new stream warms up
      void invoke(PREVIEW_CLOSE_LIVE, { handle: prev })
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
  }, [handle]);

  return (
    <div className={className} style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          background: "#0b0b0d",
          borderRadius: 8,
        }}
      />
      {status !== "live" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            color: "#8a8a94",
            textAlign: "center",
            padding: 12,
          }}
        >
          {status === "connecting" && "Connecting to the live session…"}
          {status === "idle" && "Live preview is only available in the desktop app."}
          {status === "error" && `Preview unavailable: ${detail || "no active automation session"}`}
        </div>
      )}
    </div>
  );
}
