// Card preview tile: lazily renders the CV's first page as an image once the
// card scrolls near the viewport; shows a shimmer while loading and a calm
// file-type glyph when bytes aren't available (backend seam not wired yet).

import { useEffect, useRef, useState } from "react";
import { getCachedThumb } from "./pdf";
import { useCvPreview } from "./usePdfPreview";
import type { CvBytesLoader, CvLibraryDoc } from "./types";

interface CvPreviewThumbProps {
  cv: CvLibraryDoc;
  loader: CvBytesLoader;
}

export function CvPreviewThumb({ cv, loader }: CvPreviewThumbProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(() => getCachedThumb(cv.id) !== null);

  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const { status, src } = useCvPreview(cv.id, loader, visible);
  const glyph = cv.fileType === "pdf" ? "PDF" : "DOC";

  return (
    <div ref={rootRef} className="cv-card__preview cvx-thumb" data-status={status}>
      {status === "ready" && src ? (
        <img className="cvx-thumb__img" src={src} alt={`First page of ${cv.fileName}`} loading="lazy" />
      ) : status === "loading" ? (
        <div className="cvx-skel" aria-hidden="true" />
      ) : (
        <span className="cvx-thumb__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="cvx-thumb__pages" aria-hidden="true">
        {cv.pageCount}p
      </span>
    </div>
  );
}
