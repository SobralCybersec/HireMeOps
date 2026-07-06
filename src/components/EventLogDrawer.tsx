import { useEventStore } from "../stores/useEventStore";

const VISIBLE_COUNT = 20;

/** Small live "event log" drawer, fed only by useEventStore (no polling). */
export function EventLogDrawer() {
  const events = useEventStore((state) => state.events);
  const recent = events.slice(0, VISIBLE_COUNT);

  return (
    <aside className="event-log-drawer" aria-label="Live event log">
      <h2>Event Log</h2>
      {recent.length === 0 ? (
        <p className="event-log-empty">No events yet.</p>
      ) : (
        <ul className="event-log-list">
          {recent.map((event) => (
            <li key={event.id} className="event-log-item">
              <span className="event-log-type">{event.type}</span>
              <time className="event-log-time" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
