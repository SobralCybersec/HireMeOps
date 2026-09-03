// A CV library card: page-1 preview, name, status/type badges, assigned
// variants, score bar and a footer of file facts. Hovering or focusing the
// preview raises an enlarged page peek (portal'd, so the grid never clips it).

import { useCallback, useRef, useState } from "react";
import { useReducedEffects } from "../../lib/effects";
import { getCachedPeek, renderCvPeek } from "./pdf";
import { CvPreviewThumb } from "./CvPreviewThumb";
import { CvCardDetails, CvCardPeek } from "./CvCardParts";
import type { CvBytesLoader, CvLibraryDoc } from "./types";

interface CvCardProps {
  cv: CvLibraryDoc;
  selected: boolean;
  loader: CvBytesLoader;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

interface PeekPos {
  left: number;
  top: number;
  src: string;
}

const PEEK_WIDTH = 480;

export function CvCard({ cv, selected, loader, onSelect, onOpen }: CvCardProps) {
  const reduce = useReducedEffects();
  const [peek, setPeek] = useState<PeekPos | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether the pointer is still on the card, so a late-resolving hi-res
  // render doesn't re-open a peek the user already left.
  const hoveringRef = useRef(false);

  const showPeek = useCallback(() => {
    hoveringRef.current = true;
    const el = thumbRef.current;
    if (!el) return;
    const place = (src: string): PeekPos => {
      const r = el.getBoundingClientRect();
      // Prefer the right side; flip left when there isn't room.
      const roomRight = window.innerWidth - r.right;
      const left =
        roomRight > PEEK_WIDTH + 24 ? r.right + 12 : Math.max(12, r.left - PEEK_WIDTH - 12);
      const top = Math.min(Math.max(12, r.top), window.innerHeight - PEEK_WIDTH * 1.35 - 12);
      return { left, top, src };
    };
    // Show instantly with whatever is cached (tile, or a prior hi-res peek)…
    const cached = getCachedPeek(cv.id);
    if (cached) setPeek(place(cached));
    // …then upgrade to a dedicated high-resolution render of page 1.
    void renderCvPeek(cv.id, loader).then((src) => {
      if (src && hoveringRef.current) setPeek(place(src));
    });
  }, [cv.id, loader]);

  const hidePeek = useCallback(() => {
    hoveringRef.current = false;
    setPeek(null);
  }, []);

  return (
    <div
      className={selected ? "cv-card cvx-card cvx-card--selected" : "cv-card cvx-card"}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${cv.fileName}, ${cv.fileType.toUpperCase()}, ${cv.pageCount} pages`}
      onClick={() => onSelect(cv.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(cv.id);
        }
      }}
    >
      <div
        ref={thumbRef}
        className="cvx-card__thumb-wrap"
        onMouseEnter={showPeek}
        onMouseLeave={hidePeek}
        onFocus={showPeek}
        onBlur={hidePeek}
      >
        <button
          type="button"
          className="cvx-card__open"
          aria-label={`Open ${cv.fileName} in viewer`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(cv.id);
          }}
        >
          <CvPreviewThumb cv={cv} loader={loader} />
          <span className="cvx-card__open-hint" aria-hidden="true">
            Open
          </span>
        </button>
      </div>

      <CvCardDetails cv={cv} />
      <CvCardPeek peek={peek} reduce={reduce} />
    </div>
  );
}
