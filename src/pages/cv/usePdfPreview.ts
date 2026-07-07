// Hook: resolve a CV's page-1 thumbnail, lazily and cached.
//
// `enabled` gates the actual work so callers can defer loading until the card
// scrolls near the viewport (see CvPreviewThumb's IntersectionObserver).

import { useEffect, useState } from "react";
import { getCachedThumb, renderCvThumbnail } from "./pdf";
import type { CvBytesLoader } from "./types";

export type PreviewStatus = "idle" | "loading" | "ready" | "unavailable";

interface PreviewState {
  status: PreviewStatus;
  src: string | null;
}

export function useCvPreview(
  cvId: string,
  loader: CvBytesLoader,
  enabled: boolean,
): PreviewState {
  // Async render result, tagged with the cv id it belongs to. Written *only*
  // from the async render callback — never synchronously inside the effect —
  // so the "loading"/"ready-from-cache" states are derived during render below.
  const [rendered, setRendered] = useState<{ id: string; src: string | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (getCachedThumb(cvId)) return; // cache hit resolves via derivation below

    let alive = true;
    void renderCvThumbnail(cvId, loader).then((url) => {
      if (!alive) return;
      setRendered({ id: cvId, src: url });
    });

    return () => {
      alive = false;
    };
  }, [cvId, loader, enabled]);

  // Derive the public status during render, so no setState happens in the
  // effect body. A cache hit wins immediately; otherwise an async result for
  // *this* cv resolves it; anything else is still loading (or idle if gated).
  const cached = getCachedThumb(cvId);
  if (cached) return { status: "ready", src: cached };
  if (!enabled) return { status: "idle", src: null };
  if (rendered && rendered.id === cvId) {
    return rendered.src
      ? { status: "ready", src: rendered.src }
      : { status: "unavailable", src: null };
  }
  return { status: "loading", src: null };
}
