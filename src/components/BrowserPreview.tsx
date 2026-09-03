/**
 * Evidence Viewer — renders the LIVE automation session as it runs. On mount it opens a CDP
 * screencast of the worker's active page (preview_open_live) over a Tauri Channel and paints each
 * JPEG frame onto a canvas; on unmount it stops the stream. Off-Tauri (plain browser / screenshots)
 * it degrades to a static placeholder instead of invoking.
 */
import { useRef } from "react";
import { useBrowserPreviewSession } from "./browser-preview-session";

type Props = {
  /** Explicit session handle to view; omit to view the driver's current session. */
  handle?: string | null;
  className?: string;
};

export default function BrowserPreview({ handle = null, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { status, detail } = useBrowserPreviewSession(canvasRef, handle);

  return (
    <div className={className} style={{ position: "relative", width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "auto",
          display: "block",
          background: "var(--color-surface-sunken)",
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
            color: "var(--color-text-muted)",
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
