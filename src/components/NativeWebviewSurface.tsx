/**
 * Embedded native-webview surface (ported from terax-ai). Renders a placeholder host <div> and mounts
 * a REAL OS webview as a child of the main window, kept positioned/sized over the host as it scrolls
 * and resizes — so a browser lives INSIDE our UI instead of spawning a separate window.
 *
 * Engine boundary: this is the OS webview, not the patchright automation browser (separate engine,
 * separate cookies). Use it for in-app browsing/login panes; watch the automation via BrowserPreview.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  url: string;
  visible: boolean;
  onUrlChange?: (url: string) => void;
};

type WebviewBounds = { x: number; y: number; width: number; height: number };
type WebviewUrlPayload = { label: string; url: string };

const URL_EVENT = "hiremeops:preview-webview-url";

export function nativePreviewWebviewLabel(id: number): string {
  return `preview_native_${id}`;
}

export function navigateNativeWebview(label: string, url: string) {
  return invoke("preview_webview_navigate", { label, url });
}
export function reloadNativeWebview(label: string) {
  return invoke("preview_webview_reload", { label });
}
export function goBackNativeWebview(label: string) {
  return invoke("preview_webview_go_back", { label });
}
export function goForwardNativeWebview(label: string) {
  return invoke("preview_webview_go_forward", { label });
}
function createNativeWebview(payload: {
  windowLabel: string;
  label: string;
  url: string;
  bounds: WebviewBounds;
}) {
  return invoke("preview_webview_create", payload);
}
function setNativeWebviewBounds(label: string, bounds: WebviewBounds) {
  return invoke("preview_webview_set_bounds", { label, bounds });
}
function showNativeWebview(label: string) {
  return invoke("preview_webview_show", { label });
}
function hideNativeWebview(label: string) {
  return invoke("preview_webview_hide", { label });
}
function closeNativeWebview(label: string) {
  return invoke("preview_webview_close", { label });
}

export function NativeWebviewSurface({ label, url, visible, onUrlChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readBounds = useCallback((): WebviewBounds | null => {
    const node = hostRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }, []);

  const syncBounds = useCallback(async () => {
    if (!createdRef.current) return;
    const bounds = readBounds();
    if (!bounds) return;
    await setNativeWebviewBounds(label, bounds);
  }, [label, readBounds]);

  const requestSyncBounds = useCallback(() => {
    if (syncFrameRef.current !== null) return;
    syncFrameRef.current = window.requestAnimationFrame(() => {
      syncFrameRef.current = null;
      void syncBounds().catch(() => undefined);
    });
  }, [syncBounds]);

  useEffect(() => {
    return () => {
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current);
        syncFrameRef.current = null;
      }
      createdRef.current = false;
      currentUrlRef.current = null;
      void closeNativeWebview(label);
    };
  }, [label]);

  useEffect(() => {
    let disposed = false;

    async function syncWebview() {
      if (!url) return;
      const bounds = readBounds();
      if (!bounds) return;

      if (!createdRef.current) {
        if (!visible) return;
        setError(null);
        await createNativeWebview({
          windowLabel: getCurrentWindow().label,
          label,
          url,
          bounds,
        });
        if (disposed) {
          await closeNativeWebview(label).catch(() => undefined);
          return;
        }
        createdRef.current = true;
        currentUrlRef.current = url;
      } else if (url !== currentUrlRef.current) {
        await navigateNativeWebview(label, url);
        currentUrlRef.current = url;
      }

      await syncBounds().catch(() => undefined);
      await (visible ? showNativeWebview(label) : hideNativeWebview(label)).catch(() => undefined);
    }

    void syncWebview().catch((err) => {
      if (!disposed) setError(String(err || "native preview failed"));
    });

    return () => {
      disposed = true;
    };
  }, [label, readBounds, syncBounds, url, visible]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => requestSyncBounds());
    observer.observe(node);
    const onWindowResize = () => requestSyncBounds();
    const onScroll = () => requestSyncBounds();
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [requestSyncBounds]);

  useEffect(() => {
    if (!visible) return;
    requestSyncBounds();
    const frame = window.requestAnimationFrame(requestSyncBounds);
    return () => window.cancelAnimationFrame(frame);
  }, [requestSyncBounds, url, visible]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void getCurrentWebviewWindow()
      .listen<WebviewUrlPayload>(URL_EVENT, (event) => {
        if (cancelled || event.payload.label !== label) return;
        currentUrlRef.current = event.payload.url;
        if (event.payload.url !== url) onUrlChange?.(event.payload.url);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else cleanup = unlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [label, onUrlChange, url]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!createdRef.current) return;
      if (document.hidden) {
        void hideNativeWebview(label).catch(() => undefined);
      } else if (visible) {
        void showNativeWebview(label).catch(() => undefined);
        requestSyncBounds();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [label, requestSyncBounds, visible]);

  return (
    <div ref={hostRef} style={{ position: "relative", height: "100%", minHeight: 0, width: "100%", overflow: "hidden", background: "var(--color-surface, #0b0b0d)" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 12, color: "var(--color-text-muted, #8a8a94)" }}>
          {error ?? "Embedded browser active"}
        </div>
      </div>
    </div>
  );
}

export default NativeWebviewSurface;
