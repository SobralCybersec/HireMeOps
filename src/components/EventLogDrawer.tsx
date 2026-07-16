import { useRef, useLayoutEffect, useMemo } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { useEventStore } from "../stores/useEventStore";
import { Icon } from "./ui";
import { useReducedEffects } from "../lib/effects";
import { animate } from "animejs";
import type { AppEventType } from "../types/events";
import "./EventLogDrawer.css";

const VISIBLE_COUNT = 30;

/** Map event type → CSS modifier class on .event-log-type */
function evtClass(type: AppEventType): string {
  if (type.includes(".completed") || type.includes(".done") || type.includes("item_found"))
    return "evt--success";
  if (type.includes(".failed")) return "evt--failed";
  if (type.includes("review") || type.includes("captcha")) return "evt--review";
  if (type.includes("started") || type.includes("resumed")) return "evt--running";
  if (type.includes("stopped")) return "evt--stopped";
  if (type.includes("paused")) return "evt--paused";
  return "";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const BRIDGE_LABEL: Record<string, string> = {
  connecting: "Connecting...",
  live: "Live",
  error: "Disconnected",
};

/** Live event log drawer - right rail of every page. */
export function EventLogDrawer() {
  const events = useEventStore((s) => s.events);
  const clear = useEventStore((s) => s.clear);
  const bridgeStatus = useEventStore((s) => s.bridgeStatus);
  // events.length only ever grows (append-only log) - reference change is the
  // right dependency signal, and it means this recomputes only when new
  // events actually arrive, not on unrelated re-renders (e.g. theme toggle).
  const recent = useMemo(() => events.slice(0, VISIBLE_COUNT), [events]);
  const reduced = useReducedEffects();
  const listRef = useRef<HTMLUListElement>(null);
  const prevCountRef = useRef(events.length);

  // Animate the newest event item sliding in from right when new events arrive.
  // useLayoutEffect (not useEffect) so the initial opacity:0 is committed to the
  // DOM before the browser paints - prevents the one-frame flash at opacity:1
  // that useEffect would cause (fires after paint). SR is unaffected: aria-live
  // announces on DOM insertion, which happens before any layout effects run, and
  // opacity:0 is invisible to AT regardless.
  useLayoutEffect(() => {
    if (reduced || !listRef.current || events.length <= prevCountRef.current) {
      prevCountRef.current = events.length;
      return;
    }
    const newCount = events.length - prevCountRef.current;
    prevCountRef.current = events.length;

    // Select only the newly added items (they appear at the top of the list)
    const items = Array.from(listRef.current.children).slice(0, newCount);
    if (items.length === 0) return;

    const anim = animate(items, {
      opacity: [0, 1],
      translateX: [12, 0],
      duration: 200,
      ease: "outExpo",
    });

    return () => {
      anim.revert();
    };
  }, [events.length, reduced]);

  return (
    <aside className="event-log-drawer" aria-label="Live event log">
      <div className="event-log-header">
        <h2 className="event-log-title">Event Log</h2>
        <span
          className={`event-log-status event-log-status--${bridgeStatus}`}
          title={
            bridgeStatus === "error"
              ? "The live event channel is disconnected - events are not updating."
              : `Live event channel: ${BRIDGE_LABEL[bridgeStatus]}`
          }
        >
          <span className="event-log-status-dot" aria-hidden="true" />
          <span className="event-log-status-label">{BRIDGE_LABEL[bridgeStatus]}</span>
        </span>
        <button
          type="button"
          className="event-log-clear-btn"
          onClick={clear}
          aria-label="Clear event log"
          disabled={events.length === 0}
        >
          <Icon icon={Delete02Icon} size={13} />
          Clear
        </button>
      </div>

      <div className="event-log-body" role="log" aria-live="polite" aria-atomic="false">
        {recent.length === 0 ? (
          <p className="event-log-empty">No events yet.</p>
        ) : (
          <ul className="event-log-list" ref={listRef}>
            {recent.map((evt) => (
              <li key={evt.id} className="event-log-item">
                <span className={`event-log-type ${evtClass(evt.type)}`}>{evt.type}</span>
                <time className="event-log-time" dateTime={evt.createdAt}>
                  {fmtTime(evt.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
