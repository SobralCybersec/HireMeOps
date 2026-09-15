/** Embedded Chromium preview with forwarded navigation and input events. */
import { useMemo, useRef } from "react";
import { EmbeddedBrowserView } from "./EmbeddedBrowserView";
import { useEmbeddedBrowserSession, type EmbeddedBrowserRefs } from "./embedded-browser-session";

export function EmbeddedBrowser() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<string | null>(null);
  const lastSizeRef = useRef("");
  const refs = useMemo<EmbeddedBrowserRefs>(
    () => ({ canvasRef, contentRef, handleRef, lastSizeRef }),
    [canvasRef, contentRef, handleRef, lastSizeRef],
  );
  const session = useEmbeddedBrowserSession(refs);
  return <EmbeddedBrowserView {...refs} {...session} />;
}

export default EmbeddedBrowser;
