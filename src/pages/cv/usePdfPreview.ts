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
  const [state, setState] = useState<PreviewState>(() => {
    const cached = getCachedThumb(cvId);
    return cached ? { status: "ready", src: cached } : { status: "idle", src: null };
  });

  useEffect(() => {
    if (!enabled) return;

    const cached = getCachedThumb(cvId);
    if (cached) {
      setState({ status: "ready", src: cached });
      return;
    }

    let alive = true;
    setState({ status: "loading", src: null });
    void renderCvThumbnail(cvId, loader).then((url) => {
      if (!alive) return;
      setState(url ? { status: "ready", src: url } : { status: "unavailable", src: null });
    });

    return () => {
      alive = false;
    };
  }, [cvId, loader, enabled]);

  return state;
}
