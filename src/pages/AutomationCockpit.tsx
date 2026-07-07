import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import type { AutomationState } from "../types/domain";
import {
  AutomationStatusBadge,
  Badge,
  Button,
  Card,
  EmptyState,
  Toolbar,
  ToolbarSep,
  automationVariant,
} from "../components/ui";

/* ── Constants ───────────────────────────────────────────────────── */

const IDLE_STATES: AutomationState[] = [
  "Queued",
  "Stopped",
  "Failed",
  "Completed",
  "PausedByUser",
  "RetryScheduled",
  "SkippedDuplicateUrl",
];

/* ── Component ───────────────────────────────────────────────────── */

export function AutomationCockpit() {
  const state              = useAutomationStore((s) => s.state);
  const currentTaskId      = useAutomationStore((s) => s.currentTaskId);
  const isEmergencyStopped = useAutomationStore((s) => s.isEmergencyStopped);
  const start              = useAutomationStore((s) => s.start);
  const pause              = useAutomationStore((s) => s.pause);
  const resume             = useAutomationStore((s) => s.resume);
  const stop               = useAutomationStore((s) => s.stop);
  const events             = useEventStore((s) => s.events);

  const isIdle    = IDLE_STATES.includes(state);
  const isRunning = !isIdle;
  const isPaused  = state === "PausedByUser";
  const dot       = automationVariant(state);

  const appEvents = events.filter(
    (e) =>
      e.type.startsWith("application.") ||
      e.type.startsWith("automation."),
  );

  const subLabel = currentTaskId
    ? `Task: ${currentTaskId}`
    : isEmergencyStopped
      ? "Emergency stopped — restart to resume"
      : "Idle — press Start to begin";

  return (
    <div className="page">
      <Toolbar>
        <Button
          variant="primary"
          icon="▶"
          onClick={() => void start()}
          disabled={isRunning || isPaused}
        >
          Start
        </Button>
        <Button
          icon="⏸"
          onClick={() => void pause()}
          disabled={!isRunning}
        >
          Pause
        </Button>
        <Button
          icon="↺"
          onClick={() => void resume()}
          disabled={!isPaused}
        >
          Resume
        </Button>
        <Button
          icon="■"
          onClick={() => void stop()}
          disabled={state === "Stopped" || state === "Queued"}
        >
          Stop
        </Button>
        <ToolbarSep />
        <Button disabled>Run Once</Button>
        <Button disabled>Dry Run</Button>
      </Toolbar>

      {/* State display ------------------------------------------------ */}
      <div className="state-display" aria-live="polite">
        <AutomationStatusBadge state={state} bare />
        <div className="state-display__label">{subLabel}</div>
        <div style={{ marginLeft: "auto" }}>
          <AutomationStatusBadge state={state} showDot={false} />
        </div>
      </div>

      {/* Two-column: queue + log -------------------------------------- */}
      <div className="cockpit-grid">
        <Card
          title="Application Queue"
          actions={<Badge variant={dot}>0</Badge>}
          compact
        >
          <EmptyState
            title="Queue is empty"
            body="Run Job Search first to populate the queue."
          />
        </Card>

        <Card
          title="Automation Log"
          actions={<Badge variant="neutral">{appEvents.length}</Badge>}
          compact
          bodyClassName="event-log-scroll"
        >
          {appEvents.length === 0 ? (
            <EmptyState
              title="No events"
              body="Automation events will stream here."
            />
          ) : (
            <ul className="event-log-list">
              {appEvents.slice(0, 40).map((e) => (
                <li key={e.id} className="event-log-item">
                  <span className="event-log-type">{e.type}</span>
                  <time className="event-log-time" dateTime={e.createdAt}>
                    {new Date(e.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Evidence viewer --------------------------------------------- */}
      <Card
        title="Evidence Viewer"
        actions={<Badge variant="neutral">–</Badge>}
      >
        <div className="evidence-placeholder">
          Screenshots, DOM snapshots, console logs and form state will appear
          here when an application is running or has been reviewed.
        </div>
      </Card>
    </div>
  );
}
