import { useEventStore } from "../stores/useEventStore";
import type { AppEventType } from "../types/events";

const VISIBLE_COUNT = 30;

/** Map event type → CSS modifier class on .event-log-type */
function evtClass(type: AppEventType): string {
  if (type.includes(".completed") || type.includes(".done") || type.includes("item_found"))
    return "evt--success";
  if (type.includes(".failed"))    return "evt--failed";
  if (type.includes("review")  || type.includes("captcha")) return "evt--review";
  if (type.includes("started") || type.includes("resumed")) return "evt--running";
  if (type.includes("stopped"))    return "evt--stopped";
  if (type.includes("paused"))     return "evt--paused";
  return "";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Live event log drawer – right rail of every page. */
export function EventLogDrawer() {
  const events = useEventStore((s) => s.events);
  const clear  = useEventStore((s) => s.clear);
  const recent = events.slice(0, VISIBLE_COUNT);

  return (
    <aside className="event-log-drawer" aria-label="Live event log">
      <div className="event-log-header">
        <h2 className="event-log-title">Event Log</h2>
        <button
          type="button"
          className="event-log-clear-btn"
          onClick={clear}
          aria-label="Clear event log"
          disabled={events.length === 0}
        >
          Clear
        </button>
      </div>

      <div className="event-log-body" role="log" aria-live="polite" aria-atomic="false">
        {recent.length === 0 ? (
          <p className="event-log-empty">No events yet.</p>
        ) : (
          <ul className="event-log-list">
            {recent.map((evt) => (
              <li key={evt.id} className="event-log-item">
                <span className={`event-log-type ${evtClass(evt.type)}`}>
                  {evt.type}
                </span>
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
