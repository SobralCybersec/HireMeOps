import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import {
  AutomationStatusBadge,
  Badge,
  Button,
  Card,
  ChartCard,
  EmptyState,
  KpiCard,
  automationVariant,
  humanizeStatus,
} from "../components/ui";
import type { KpiTone } from "../components/ui";
import type { AutomationState } from "../types/domain";
import type { AppEventType } from "../types/events";

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

const QUICK_NAV = [
  { to: "/job-search",      label: "Job Search",   hint: "Browse & match jobs"   },
  { to: "/applications",    label: "Applications", hint: "Submission queue"       },
  { to: "/automation",      label: "Automation",   hint: "Cockpit & live state"   },
  { to: "/cv-library",      label: "CV Library",   hint: "Manage CV documents"    },
  { to: "/job-preferences", label: "Preferences",  hint: "Targets & filters"      },
] as const;

/* ── Helpers ─────────────────────────────────────────────────────── */

/** Returns the `.evt--*` modifier class suffix for a given event type. */
function eventVariant(type: AppEventType): string {
  switch (type) {
    case "application.completed":          return "success";
    case "application.failed":             return "failed";
    case "application.needs_review":
    case "automation.paused_for_captcha":  return "review";
    case "automation.stopped":             return "stopped";
    case "automation.paused":              return "paused";
    case "automation.started":
    case "automation.resumed":
    case "job.search.started":
    case "job.search.item_found":
    case "job.match.done":
    case "application.started":
    case "application.retry_scheduled":    return "running";
    default:                               return "";
  }
}

/* ── Pipeline funnel (CSS score-bars; no canvas dependency) ──────── */

interface FunnelRow {
  label:   string;
  count:   number;
  variant: string;
}

/**
 * Horizontal bar chart built from `.score-bar-row` primitives.
 * Each bar is scaled relative to `total` (the largest bucket).
 */
function PipelineFunnel({ rows, total }: { rows: FunnelRow[]; total: number }) {
  return (
    <div
      style={{
        display:       "flex",
        flexDirection: "column",
        gap:           "var(--sp-2)",
        padding:       "var(--sp-2) var(--sp-4)",
        width:         "100%",
      }}
    >
      {rows.map(({ label, count, variant }) => {
        const pct = total > 0 ? Math.min(Math.round((count / total) * 100), 100) : 0;
        return (
          <div key={label} className="score-bar-row">
            <span className="score-bar-label">{label}</span>
            <div className="score-bar">
              <div
                className="score-bar__fill"
                style={{
                  width:      `${pct}%`,
                  background: `var(--status-${variant}-text)`,
                }}
              />
            </div>
            <span
              className="score-val"
              style={{ color: `var(--status-${variant}-text)` }}
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────── */

export function Dashboard() {
  /* Fine-grained store subscriptions — one selector per value so
     unrelated state changes don't cause unnecessary re-renders.      */
  const state              = useAutomationStore((s) => s.state);
  const isEmergencyStopped = useAutomationStore((s) => s.isEmergencyStopped);
  const start              = useAutomationStore((s) => s.start);
  const pause              = useAutomationStore((s) => s.pause);
  const resume             = useAutomationStore((s) => s.resume);
  const stop               = useAutomationStore((s) => s.stop);
  const events             = useEventStore((s) => s.events);

  /* Derived automation flags */
  const isIdle    = IDLE_STATES.includes(state);
  const isRunning = !isIdle && state !== "PausedByUser";
  const isPaused  = state === "PausedByUser";

  /* Stable click handlers — avoids re-creating lambdas in JSX */
  const handleStart  = useCallback(() => { void start();  }, [start]);
  const handlePause  = useCallback(() => { void pause();  }, [pause]);
  const handleResume = useCallback(() => { void resume(); }, [resume]);
  const handleStop   = useCallback(() => { void stop();   }, [stop]);

  /* Event counters derived from the rolling buffer */
  const submitted  = events.filter((e) => e.type === "application.completed").length;
  const failed     = events.filter((e) => e.type === "application.failed").length;
  const review     = events.filter((e) => e.type === "application.needs_review").length;
  const discovered = events.filter((e) => e.type === "job.search.item_found").length;
  const duplicates = events.filter((e) => e.type === "job.duplicate_skipped").length;

  /* Derived metrics */
  const attempts    = submitted + failed;
  const successRate = attempts > 0 ? Math.round((submitted / attempts) * 100) : null;
  const rateVariant: KpiTone =
    successRate === null ? "default"
    : successRate >= 70  ? "success"
    : successRate >= 40  ? "review"
    :                      "danger";

  /* Funnel dataset — bars scale to the largest single bucket */
  const funnelRows: FunnelRow[] = [
    { label: "Discovered",   count: discovered, variant: "neutral" },
    { label: "Submitted",    count: submitted,  variant: "success" },
    { label: "Needs Review", count: review,     variant: "review"  },
    { label: "Failed",       count: failed,     variant: "failed"  },
    { label: "Skipped",      count: duplicates, variant: "paused"  },
  ];
  const funnelPeak = Math.max(discovered, submitted, failed, review, duplicates, 1);

  const dot = automationVariant(state);

  return (
    <div className="page">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="page-subtitle">Session overview</span>
        <div style={{ marginLeft: "auto" }}>
          <AutomationStatusBadge state={state} />
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="stat-grid">
        <KpiCard
          label="Submitted"
          value={submitted}
          meta="this session"
          tone={submitted > 0 ? "accent" : "default"}
          className="fx-stagger-1"
        />
        <KpiCard
          label="Discovered"
          value={discovered}
          meta="this session"
          className="fx-stagger-2"
        />
        <KpiCard
          label="Needs Review"
          value={review}
          tone={review > 0 ? "review" : "default"}
          className="fx-stagger-3"
        />
        <KpiCard
          label="Failed"
          value={failed}
          tone={failed > 0 ? "danger" : "default"}
          className="fx-stagger-4"
        />
        <KpiCard label="Duplicates Skipped" value={duplicates} className="fx-stagger-5" />
        <KpiCard label="Events Logged"      value={events.length} className="fx-stagger-6" />
        <KpiCard
          label="Success Rate"
          value={successRate !== null ? `${successRate}%` : "—"}
          meta={
            attempts > 0
              ? `${attempts} attempt${attempts !== 1 ? "s" : ""}`
              : "no attempts yet"
          }
          tone={rateVariant}
        />
      </div>

      {/* ── Main grid ───────────────────────────────────────────── */}
      <div className="dash-grid">

        {/* Left column: control card + pipeline funnel stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>

          {/* Automation Control */}
          <Card
            title="Automation Control"
            actions={<Badge variant={dot}>{humanizeStatus(state)}</Badge>}
          >
            <div
              className="state-display"
              style={{ marginBottom: "var(--sp-4)" }}
            >
              <span
                className="state-display__dot"
                style={{ background: `var(--status-${dot}-text)` }}
                aria-hidden="true"
              />
              <div>
                <div className="state-display__label">
                  {humanizeStatus(state)}
                </div>
                <div
                  className="state-display__sub"
                  style={
                    isEmergencyStopped
                      ? { color: "var(--color-danger)" }
                      : undefined
                  }
                >
                  {isEmergencyStopped
                    ? "Emergency stopped — reset before restarting"
                    : isRunning
                      ? "Automation is active"
                      : isPaused
                        ? "Paused by user — resume when ready"
                        : "Ready to start"}
                </div>
              </div>
            </div>

            <div className="toolbar">
              <Button
                variant="primary"
                size="sm"
                onClick={handleStart}
                disabled={isRunning || isPaused}
                aria-label="Start automation"
              >
                ▶ Start
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePause}
                disabled={!isRunning}
                aria-label="Pause automation"
              >
                ⏸ Pause
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResume}
                disabled={!isPaused}
                aria-label="Resume automation"
              >
                ↺ Resume
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                disabled={
                  state === "Stopped" ||
                  (isIdle && state !== "RetryScheduled")
                }
                aria-label="Stop automation"
              >
                ■ Stop
              </Button>
            </div>
          </Card>

          {/* Application pipeline funnel */}
          <ChartCard
            title="Application Pipeline"
            placeholder="Start automation to see pipeline data."
          >
            {discovered > 0
              ? <PipelineFunnel rows={funnelRows} total={funnelPeak} />
              : undefined}
          </ChartCard>
        </div>

        {/* Right column: live event feed */}
        <Card
          title="Live Feed"
          actions={<Badge variant="neutral">{events.length}</Badge>}
          compact
        >
          {/* aria-live so screen readers announce arriving events */}
          <div
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-label="Recent automation events"
          >
            {events.length === 0 ? (
              <EmptyState
                label="Quiet"
                title="No events yet"
                body="Start automation to see live events here."
              />
            ) : (
              <ul
                className="event-log-list"
                style={{ padding: "var(--sp-1) 0" }}
              >
                {events.slice(0, 20).map((e) => {
                  const v = eventVariant(e.type);
                  return (
                    <li
                      key={e.id}
                      className={v ? `event-log-item evt--${v}` : "event-log-item"}
                    >
                      <span className="event-log-type">{e.type}</span>
                      <time className="event-log-time" dateTime={e.createdAt}>
                        {new Date(e.createdAt).toLocaleTimeString([], {
                          hour:   "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* ── Quick access ────────────────────────────────────────── */}
      <Card title="Quick Access" compact>
        <nav aria-label="Quick navigation">
          {QUICK_NAV.map(({ to, label, hint }) => (
            <Link
              key={to}
              to={to}
              className="list-item"
              style={{ textDecoration: "none" }}
            >
              <span className="list-item__name">{label}</span>
              <span className="list-item__meta">{hint}</span>
            </Link>
          ))}
        </nav>
      </Card>

    </div>
  );
}
