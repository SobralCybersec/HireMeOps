import { useRef, useEffect, useMemo, useState, type CSSProperties } from "react";
import { PauseIcon, PlayIcon, RotateClockwiseIcon, StopIcon } from "@hugeicons/core-free-icons";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import { BrowserPreview } from "../components/BrowserPreview";
import { useReducedEffects } from "../lib/effects";
import { animate } from "animejs";
import type { AutomationState } from "../types/domain";
import {
  AutomationStatusBadge,
  Badge,
  BrowserSessionBadge,
  Button,
  Card,
  EmptyState,
  Icon,
  StatusDot,
  Switch,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  automationVariant,
  humanizeStatus,
  type SessionStatus,
} from "../components/ui";
import "./AutomationCockpit.css";

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

/* ── Layout styles (cannot edit theme.css, Lane 1 owns it) ─────── */

/** Full-height cockpit: no page scroll, inner panels handle overflow. */
const cockpitFill: CSSProperties = {
  flex: 1,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  padding: "var(--sp-4)",
  paddingTop: "var(--sp-2)",
  gap: "var(--sp-3)",
  minWidth: 0,
};

/** State hero strip: dot + large mono label + badge. */
const heroStrip: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: "var(--sp-4)",
  padding: "var(--sp-3) var(--sp-5)",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  flexShrink: 0,
  minWidth: 0,
};

const heroLeft: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  minWidth: 0,
};

const heroLabel: CSSProperties = {
  fontSize: "var(--text-2xl)",
  fontWeight: "var(--fw-bold)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-text)",
  lineHeight: 1,
  letterSpacing: "-0.02em",
};

const heroSub: CSSProperties = {
  fontSize: "var(--text-sm)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-text-2)",
  marginTop: "var(--sp-1)",
  maxWidth: "60ch",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const sideStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-3)",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

/** Make the evidence Card fill vertically and let its body scroll. */
const evidenceFlex: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

/** Make the log Card take remaining height after the queue Card. */
const logFlex: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const toolbarMeta: CSSProperties = {
  fontSize: "var(--text-2xs)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const evidenceActions: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
};

const reviewBanner: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-4)",
  padding: "var(--sp-3) var(--sp-4)",
  background: "var(--color-surface-2, #1a1f2e)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  flexShrink: 0,
  marginBottom: "var(--sp-2)",
};

const reviewBannerBody: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--sp-1)",
  flex: 1,
  minWidth: 0,
};

const reviewBannerTitle: CSSProperties = {
  fontSize: "var(--text-sm)",
  fontWeight: "var(--fw-bold)",
  color: "var(--color-text)",
};

const reviewBannerSub: CSSProperties = {
  fontSize: "var(--text-xs)",
  fontFamily: "var(--font-mono)",
  color: "var(--color-text-2)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const reviewBannerActions: CSSProperties = {
  display: "flex",
  gap: "var(--sp-2)",
  flexShrink: 0,
};

/* ── Session status derivation ───────────────────────────────────── */

/**
 * Best-effort browser session state derived from what the cockpit already
 * knows. Once a dedicated `browserSession` selector lands in the automation
 * store this becomes a straight passthrough.
 */
function deriveSessionStatus(
  watchUrl: string | null | undefined,
  isRunning: boolean,
  isEmergencyStopped: boolean,
): SessionStatus {
  if (isEmergencyStopped) return "disconnected";
  if (!watchUrl) return "unknown";
  return isRunning ? "connected" : "disconnected";
}

/* ── Component ───────────────────────────────────────────────────── */

export function AutomationCockpit() {
  const state = useAutomationStore((s) => s.state);
  const currentTaskId = useAutomationStore((s) => s.currentTaskId);
  const isEmergencyStopped = useAutomationStore((s) => s.isEmergencyStopped);
  const start = useAutomationStore((s) => s.start);
  const pause = useAutomationStore((s) => s.pause);
  const resume = useAutomationStore((s) => s.resume);
  const stop = useAutomationStore((s) => s.stop);
  const confirmSubmit = useAutomationStore((s) => s.confirmSubmit);
  const rejectSubmit = useAutomationStore((s) => s.rejectSubmit);
  const watchUrl = useAutomationStore((s) => s.watchUrl);
  const detail = useAutomationStore((s) => s.detail);
  const events = useEventStore((s) => s.events);

  const reduce = useReducedEffects();
  const stateRef = useRef<HTMLDivElement>(null);
  const prevState = useRef(state);

  /**
   * Headless is a real operator control - flipping it while a session is
   * live tears the CDP screencast down and re-opens it (BrowserPreview's
   * effect is keyed on `headless`). Defaults to true because that matches
   * the desktop app's normal automated-application flow; a supervisor
   * switches it off when they want to watch the run in a visible window.
   */
  const [headless, setHeadless] = useState(true);

  // Subtle scale pulse on automation state transitions - communicates
  // the state change without being distracting. Transform + opacity only.
  useEffect(() => {
    if (reduce || !stateRef.current || prevState.current === state) {
      prevState.current = state;
      return;
    }
    prevState.current = state;
    const anim = animate(stateRef.current, {
      scale: [0.97, 1],
      opacity: [0.7, 1],
      duration: 280,
      ease: "outExpo",
    });
    return () => {
      anim.revert();
    };
  }, [state, reduce]);

  const isIdle = IDLE_STATES.includes(state);
  const isRunning = !isIdle;
  const isPaused = state === "PausedByUser";
  const isNeedsReview = state === "NeedsReview";
  const isPausedForCaptcha = state === "PausedForCaptcha";
  const dot = automationVariant(state);

  const appEvents = useMemo(
    () =>
      events.filter((e) => e.type.startsWith("application.") || e.type.startsWith("automation.")),
    [events],
  );

  // The backend's `detail` (e.g. "No applications are queued", a failure
  // reason) is the most informative thing we can show, so it wins whenever the
  // engine provides one. Falls back to the derived status text otherwise.
  const subLabel = detail
    ? detail
    : currentTaskId
      ? `Task: ${currentTaskId}`
      : isEmergencyStopped
        ? "Emergency stopped - restart to resume"
        : isPaused
          ? "Paused - press Resume to continue"
          : isRunning
            ? `${state}... no application in progress yet`
            : "Idle - press Start to begin";

  const sessionStatus = deriveSessionStatus(watchUrl, isRunning, isEmergencyStopped);

  return (
    <div style={cockpitFill}>
      {/* Controls toolbar ─────────────────────────────────────────── */}
      <Toolbar aria-label="Automation controls">
        <Button
          variant="primary"
          size="sm"
          icon={<Icon icon={PlayIcon} size={12} />}
          onClick={() => void start()}
          disabled={isRunning || isPaused}
        >
          Start
        </Button>
        <Button
          size="sm"
          icon={<Icon icon={PauseIcon} size={12} />}
          onClick={() => void pause()}
          disabled={!isRunning}
        >
          Pause
        </Button>
        <Button
          size="sm"
          icon={<Icon icon={RotateClockwiseIcon} size={12} />}
          onClick={() => void resume()}
          disabled={!isPaused}
        >
          Resume
        </Button>
        <Button
          size="sm"
          icon={<Icon icon={StopIcon} size={12} />}
          onClick={() => void stop()}
          disabled={state === "Stopped" || state === "Queued"}
        >
          Stop
        </Button>
        <ToolbarSep />
        <Button size="sm" disabled>
          Run Once
        </Button>
        <Button size="sm" disabled>
          Dry Run
        </Button>
        <ToolbarSep />
        <BrowserSessionBadge
          label="Browser"
          status={sessionStatus}
          detail={watchUrl ? new URL(safeUrl(watchUrl)).host : undefined}
        />
        <ToolbarSpacer />
        <span style={toolbarMeta}>Cockpit</span>
      </Toolbar>

      {/* State hero ──────────────────────────────────────────────── */}
      <div
        ref={stateRef}
        style={heroStrip}
        className={isRunning && !reduce ? "fx-pulse-ring" : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        <div style={heroLeft}>
          <StatusDot variant={dot} size={10} />
          <div style={{ minWidth: 0 }}>
            <div style={heroLabel}>{humanizeStatus(state)}</div>
            <div style={heroSub}>{subLabel}</div>
          </div>
        </div>
        <div />
        <AutomationStatusBadge state={state} showDot={false} />
      </div>

      {/* Main area: evidence (left) + queue/log stack (right) ───── */}
      <div className="lane2-cockpit-main">
        {/* Evidence viewer - primary focus area */}
        <Card
          title="Evidence Viewer"
          actions={
            <div style={evidenceActions}>
              <Switch
                checked={headless}
                onChange={setHeadless}
                aria-label="Run browser in headless mode"
              >
                Headless
              </Switch>
              {watchUrl ? (
                <Badge variant="running">Live</Badge>
              ) : (
                <Badge variant="neutral">Standby</Badge>
              )}
            </div>
          }
          bodyClassName={watchUrl ? "card__body--compact" : undefined}
          className="cockpit-evidence"
        >
          <div style={evidenceFlex}>
            {isNeedsReview && (
              <div style={reviewBanner}>
                <div style={reviewBannerBody}>
                  <span style={reviewBannerTitle}>Review required</span>
                  <span style={reviewBannerSub}>
                    {detail ?? "Form filled — confirm to submit or reject to skip."}
                  </span>
                </div>
                <div style={reviewBannerActions}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void confirmSubmit()}
                  >
                    ✓ Confirm &amp; Submit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void rejectSubmit()}
                  >
                    ✗ Reject &amp; Skip
                  </Button>
                </div>
              </div>
            )}
            {isPausedForCaptcha && (
              <div style={{ ...reviewBanner, background: "var(--color-warning-surface, #2a2000)" }}>
                <div style={reviewBannerBody}>
                  <span style={reviewBannerTitle}>Captcha detected</span>
                  <span style={reviewBannerSub}>
                    {detail ?? "Solve the captcha in the browser window — automation will resume automatically."}
                  </span>
                </div>
              </div>
            )}
            {watchUrl ? (
              <BrowserPreview url={watchUrl} active={isRunning} headless={headless} />
            ) : (
              <EmptyState
                label="Standby"
                title="No active session"
                body="Screenshots, DOM snapshots, and form state will appear here when an application is running."
              />
            )}
          </div>
        </Card>

        {/* Right stack: queue + event log */}
        <div style={sideStack}>
          <Card title="Queue" actions={<Badge variant={dot}>0</Badge>} compact>
            <EmptyState
              label="Empty"
              title="Queue is empty"
              body="Run Job Search first to populate the queue."
            />
          </Card>

          <Card
            title="Event Log"
            actions={<Badge variant="neutral">{appEvents.length}</Badge>}
            compact
            bodyClassName="event-log-scroll"
          >
            <div style={logFlex}>
              {/* role="log" announces streaming events to screen readers */}
              <div role="log" aria-live="polite" aria-atomic="false" aria-label="Automation log">
                {appEvents.length === 0 ? (
                  <EmptyState
                    label="Quiet"
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
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * URL constructor throws on unparseable input; the automation store's
 * `watchUrl` is opaque and may occasionally arrive without a scheme
 * (e.g. "linkedin.com/jobs/123"). Prepend "https://" as a fallback so we
 * can still extract a host for the session-badge detail chip.
 */
function safeUrl(raw: string): string {
  try {
    return new URL(raw).toString();
  } catch {
    return `https://${raw}`;
  }
}
