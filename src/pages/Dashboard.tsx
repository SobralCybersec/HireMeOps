import { useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import {
  AlertDiamondIcon,
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FileValidationIcon,
  Flag03Icon,
  MailSend02Icon,
  PauseIcon,
  PlayIcon,
  Refresh01Icon,
  Route01Icon,
  Search01Icon,
  StopIcon,
  Target02Icon,
  TaskDone02Icon,
  ViewIcon,
  WorkflowSquare02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { animate, stagger } from "animejs";
import { AutomationStatusBadge, Button, Icon } from "../components/ui";
import { useAnime } from "../lib/useAnime";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import type { AutomationState } from "../types/domain";
import type { AppEvent, AppEventType } from "../types/events";
import "./Dashboard.css";

const IDLE_STATES: AutomationState[] = [
  "Queued",
  "Stopped",
  "Failed",
  "Completed",
  "PausedByUser",
  "RetryScheduled",
  "SkippedDuplicateUrl",
];

interface RouteStage {
  key: string;
  label: string;
  detail: string;
  count: number;
  icon: IconSvgElement;
  tone: "neutral" | "active" | "success" | "review" | "failed";
}

const EVENT_COPY: Record<AppEventType, string> = {
  "profile.updated": "Profile facts updated",
  "cv.uploaded": "CV added to the library",
  "cv.analysis.done": "CV analysis completed",
  "job.search.started": "Job search started",
  "job.search.item_found": "Job discovered",
  "job.match.done": "Job match evaluated",
  "job.duplicate_skipped": "Duplicate job skipped",
  "application.started": "Application attempt started",
  "application.needs_review": "Application requires review",
  "application.failed": "Application attempt failed",
  "application.completed": "Application submitted",
  "application.retry_scheduled": "Retry scheduled",
  "automation.started": "Automation run started",
  "automation.paused": "Automation paused",
  "automation.paused_for_captcha": "Automation paused for verification",
  "automation.resumed": "Automation resumed",
  "automation.evidence_saved": "Failure evidence saved",
  "automation.stopped": "Automation stopped",
  "automation.state": "Automation state changed",
  log: "System log entry",
};

function eventIcon(type: AppEventType): IconSvgElement {
  if (type === "application.completed") return CheckmarkCircle02Icon;
  if (type === "application.failed") return AlertDiamondIcon;
  if (type.includes("review") || type.includes("captcha")) return ViewIcon;
  if (type.includes("retry")) return Refresh01Icon;
  if (type.startsWith("job.")) return Search01Icon;
  if (type.startsWith("cv.")) return FileValidationIcon;
  if (type.startsWith("automation.")) return WorkflowSquare02Icon;
  return Clock01Icon;
}

function eventTone(type: AppEventType): string {
  if (type === "application.completed" || type === "job.match.done") return "success";
  if (type === "application.failed") return "failed";
  if (type.includes("review") || type.includes("captcha")) return "review";
  if (type.includes("started") || type.includes("resumed")) return "active";
  return "neutral";
}

function formatEventTime(event: AppEvent): string {
  return new Date(event.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function phaseIndex(state: AutomationState): number {
  switch (state) {
    case "ScoringJob":
    case "SelectingCV":
      return 1;
    case "GeneratingAnswers":
    case "FillingForm":
    case "NeedsReview":
    case "PausedForCaptcha":
      return 2;
    case "Submitting":
    case "VerifyingSubmission":
      return 3;
    case "Completed":
      return 4;
    default:
      return 0;
  }
}

function humanState(state: AutomationState): string {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Object-centric recruitment operations desk. It replaces the interchangeable
 * KPI-card dashboard with a mission route, exception queue and run ledger.
 */
export function Dashboard() {
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useAutomationStore((s) => s.state);
  const detail = useAutomationStore((s) => s.detail);
  const error = useAutomationStore((s) => s.error);
  const isEmergencyStopped = useAutomationStore((s) => s.isEmergencyStopped);
  const start = useAutomationStore((s) => s.start);
  const pause = useAutomationStore((s) => s.pause);
  const resume = useAutomationStore((s) => s.resume);
  const stop = useAutomationStore((s) => s.stop);
  const clearError = useAutomationStore((s) => s.clearError);
  const events = useEventStore((s) => s.events);

  const isIdle = IDLE_STATES.includes(state);
  const isPaused = state === "PausedByUser";
  const isRunning = !isIdle && !isPaused;

  const handleStart = useCallback(() => void start(), [start]);
  const handlePause = useCallback(() => void pause(), [pause]);
  const handleResume = useCallback(() => void resume(), [resume]);
  const handleStop = useCallback(() => void stop(), [stop]);

  // Recomputed only when the events array reference changes, not on every
  // render (headless toggle, hover, etc.) - events can grow to hundreds of
  // entries across a long automation session.
  const {
    submitted,
    failed,
    review,
    discovered,
    matched,
    duplicates,
    attempts,
    successRate,
    recentEvents,
  } = useMemo(() => {
    const submitted = events.filter((event) => event.type === "application.completed").length;
    const failed = events.filter((event) => event.type === "application.failed").length;
    const review = events.filter((event) => event.type === "application.needs_review").length;
    const discovered = events.filter((event) => event.type === "job.search.item_found").length;
    const matched = events.filter((event) => event.type === "job.match.done").length;
    const duplicates = events.filter((event) => event.type === "job.duplicate_skipped").length;
    const attempts = submitted + failed;
    const successRate = attempts > 0 ? Math.round((submitted / attempts) * 100) : null;
    return {
      submitted,
      failed,
      review,
      discovered,
      matched,
      duplicates,
      attempts,
      successRate,
      recentEvents: events.slice(0, 12),
    };
  }, [events]);

  const stages = useMemo<RouteStage[]>(
    () => [
      {
        key: "source",
        label: "Source",
        detail: "Jobs discovered",
        count: discovered,
        icon: Search01Icon,
        tone: discovered > 0 ? "active" : "neutral",
      },
      {
        key: "qualify",
        label: "Qualify",
        detail: "Matches evaluated",
        count: matched,
        icon: Target02Icon,
        tone: matched > 0 ? "active" : "neutral",
      },
      {
        key: "prepare",
        label: "Prepare",
        detail: "Answers and CV selection",
        count: review,
        icon: FileValidationIcon,
        tone: review > 0 ? "review" : "neutral",
      },
      {
        key: "submit",
        label: "Submit",
        detail: "Attempts made",
        count: attempts,
        icon: MailSend02Icon,
        tone: attempts > 0 ? "active" : "neutral",
      },
      {
        key: "verify",
        label: "Verify",
        detail: "Confirmed submissions",
        count: submitted,
        icon: TaskDone02Icon,
        tone: submitted > 0 ? "success" : "neutral",
      },
    ],
    [attempts, discovered, matched, review, submitted],
  );

  const currentPhase = phaseIndex(state);

  useAnime(rootRef, () => {
    animate(".field-brief__slash", {
      scaleX: [0, 1],
      opacity: [0, 1],
      duration: 720,
      ease: "outExpo",
    });
    animate(".field-reveal", {
      opacity: [0, 1],
      translateY: [12, 0],
      delay: stagger(70),
      duration: 480,
      ease: "outExpo",
    });
    animate(".mission-stage", {
      opacity: [0, 1],
      translateX: [-12, 0],
      delay: stagger(80, { start: 220 }),
      duration: 440,
      ease: "outExpo",
    });
  }, [state]);

  return (
    <div className="page field-desk" ref={rootRef}>
      <section className="field-brief field-reveal" aria-labelledby="field-desk-title">
        <div className="field-brief__slash" aria-hidden="true" />
        <div className="field-brief__copy">
          <span className="field-kicker">
            <Icon icon={Flag03Icon} size={15} aria-hidden="true" />
            Active application operation
          </span>
          <h1 id="field-desk-title">Application field desk</h1>
          <p>
            Control the current run, see where applications are accumulating, and resolve exceptions
            without losing the session trail.
          </p>
        </div>

        <div className="field-brief__state">
          <span className="field-brief__state-label">Engine state</span>
          <div className="field-brief__state-value">
            <AutomationStatusBadge state={state} />
            <strong>{humanState(state)}</strong>
          </div>
          <p className={isEmergencyStopped ? "field-danger-copy" : undefined}>
            {error ??
              detail ??
              (isRunning
                ? "The automation engine is processing the current route."
                : isPaused
                  ? "The run is paused. Resume when the browser is ready."
                  : "No application is currently being processed.")}
          </p>
          {error && (
            <button className="field-text-action" type="button" onClick={clearError}>
              Dismiss error
            </button>
          )}
        </div>

        <div className="field-controls" aria-label="Automation controls">
          <Button
            variant="primary"
            icon={<Icon icon={PlayIcon} size={15} aria-hidden="true" />}
            onClick={handleStart}
            disabled={isRunning || isPaused}
          >
            Start run
          </Button>
          <Button
            variant="ghost"
            icon={<Icon icon={PauseIcon} size={15} aria-hidden="true" />}
            onClick={handlePause}
            disabled={!isRunning}
          >
            Pause
          </Button>
          <Button
            variant="ghost"
            icon={<Icon icon={Refresh01Icon} size={15} aria-hidden="true" />}
            onClick={handleResume}
            disabled={!isPaused}
          >
            Resume
          </Button>
          <Button
            variant="ghost"
            icon={<Icon icon={StopIcon} size={15} aria-hidden="true" />}
            onClick={handleStop}
            disabled={state === "Stopped" || (isIdle && state !== "RetryScheduled")}
          >
            Stop
          </Button>
        </div>

        <dl className="field-outcomes" aria-label="Current session outcomes">
          <div>
            <dt>Found</dt>
            <dd>{discovered}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{submitted}</dd>
          </div>
          <div className={review > 0 ? "field-outcomes__attention" : undefined}>
            <dt>Review</dt>
            <dd>{review}</dd>
          </div>
          <div className={failed > 0 ? "field-outcomes__danger" : undefined}>
            <dt>Failed</dt>
            <dd>{failed}</dd>
          </div>
          <div>
            <dt>Verified success</dt>
            <dd>{successRate === null ? "-" : `${successRate}%`}</dd>
          </div>
        </dl>
      </section>

      <section className="mission-map field-reveal" aria-labelledby="mission-route-title">
        <header className="field-section-heading">
          <span className="field-section-heading__icon" aria-hidden="true">
            <Icon icon={Route01Icon} size={20} />
          </span>
          <div>
            <span className="field-section-heading__eyebrow">Session route</span>
            <h2 id="mission-route-title">Where is the work accumulating?</h2>
          </div>
          <span className="field-section-heading__aside">
            Current phase <strong>{currentPhase + 1}/5</strong>
          </span>
        </header>

        <div
          className="mission-route-map"
          style={{ "--route-progress": `${currentPhase * 25}%` } as React.CSSProperties}
        >
          <div className="mission-route-map__rail" aria-hidden="true">
            <span className="mission-route-map__progress" />
          </div>
          {stages.map((stage, index) => (
            <article
              key={stage.key}
              className={`mission-stage mission-stage--${stage.tone}${index === currentPhase ? " mission-stage--current" : ""}`}
              aria-current={index === currentPhase ? "step" : undefined}
            >
              <span className="mission-stage__index">0{index + 1}</span>
              <span className="mission-stage__icon" aria-hidden="true">
                <Icon icon={stage.icon} size={22} />
              </span>
              <div className="mission-stage__copy">
                <h3>{stage.label}</h3>
                <p>{stage.detail}</p>
              </div>
              <strong className="mission-stage__count">{stage.count}</strong>
              {index === currentPhase && (
                <span className="mission-stage__marker">{humanState(state)}</span>
              )}
            </article>
          ))}
        </div>

        <footer className="mission-map__notes">
          <span>
            <Icon icon={CheckmarkCircle02Icon} size={15} aria-hidden="true" />
            {submitted} confirmed
          </span>
          <span>
            <Icon icon={AlertDiamondIcon} size={15} aria-hidden="true" />
            {failed} failed
          </span>
          <span>
            <Icon icon={Refresh01Icon} size={15} aria-hidden="true" />
            {duplicates} duplicate {duplicates === 1 ? "URL" : "URLs"} skipped
          </span>
        </footer>
      </section>

      <div className="field-workspace field-reveal">
        <section className="attention-queue" aria-labelledby="attention-title">
          <header className="field-section-heading field-section-heading--compact">
            <span className="field-section-heading__icon" aria-hidden="true">
              <Icon icon={AlertDiamondIcon} size={19} />
            </span>
            <div>
              <span className="field-section-heading__eyebrow">Operator decisions</span>
              <h2 id="attention-title">Attention queue</h2>
            </div>
          </header>

          {review === 0 && failed === 0 ? (
            <div className="attention-clear">
              <Icon icon={CheckmarkCircle02Icon} size={28} aria-hidden="true" />
              <div>
                <strong>No unresolved application events</strong>
                <p>The current session has not emitted review or failure events.</p>
              </div>
            </div>
          ) : (
            <div className="attention-list">
              {review > 0 && (
                <Link className="attention-item attention-item--review" to="/applications">
                  <span className="attention-item__icon" aria-hidden="true">
                    <Icon icon={ViewIcon} size={21} />
                  </span>
                  <span>
                    <strong>
                      {review} application {review === 1 ? "needs" : "need"} review
                    </strong>
                    <small>Inspect answers and evidence before submission.</small>
                  </span>
                  <Icon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
                </Link>
              )}
              {failed > 0 && (
                <Link className="attention-item attention-item--failed" to="/applications">
                  <span className="attention-item__icon" aria-hidden="true">
                    <Icon icon={Refresh01Icon} size={21} />
                  </span>
                  <span>
                    <strong>
                      {failed} failed {failed === 1 ? "attempt" : "attempts"}
                    </strong>
                    <small>Review the saved failure reason and safe retry scope.</small>
                  </span>
                  <Icon icon={ArrowRight02Icon} size={17} aria-hidden="true" />
                </Link>
              )}
            </div>
          )}

          <div className="attention-links" aria-label="Related work areas">
            <Link to="/job-search">
              <Icon icon={Search01Icon} size={15} aria-hidden="true" />
              Refine search
            </Link>
            <Link to="/cv-library">
              <Icon icon={FileValidationIcon} size={15} aria-hidden="true" />
              Inspect CV library
            </Link>
            <Link to="/automation">
              <Icon icon={WorkflowSquare02Icon} size={15} aria-hidden="true" />
              Open live cockpit
            </Link>
          </div>
        </section>

        <section className="run-ledger" aria-labelledby="run-ledger-title">
          <header className="field-section-heading field-section-heading--compact">
            <span className="field-section-heading__icon" aria-hidden="true">
              <Icon icon={Clock01Icon} size={19} />
            </span>
            <div>
              <span className="field-section-heading__eyebrow">Auditable sequence</span>
              <h2 id="run-ledger-title">Run ledger</h2>
            </div>
            <span className="field-section-heading__aside">{events.length} events</span>
          </header>

          {recentEvents.length === 0 ? (
            <div className="ledger-empty">
              <Icon icon={WorkflowSquare02Icon} size={28} aria-hidden="true" />
              <p>Start a search or automation run to create the first ledger entry.</p>
            </div>
          ) : (
            <ol className="ledger-list">
              {recentEvents.map((event) => (
                <li
                  className={`ledger-entry ledger-entry--${eventTone(event.type)}`}
                  key={event.id}
                >
                  <span className="ledger-entry__icon" aria-hidden="true">
                    <Icon icon={eventIcon(event.type)} size={17} />
                  </span>
                  <span className="ledger-entry__copy">
                    <strong>{EVENT_COPY[event.type]}</strong>
                    <code>{event.type}</code>
                  </span>
                  <time dateTime={event.createdAt}>{formatEventTime(event)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
