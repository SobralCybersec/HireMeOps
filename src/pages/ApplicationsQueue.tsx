import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { ApplicationStatus, AutomationState, JobStatus } from "../types/domain";
import {
  Badge,
  Button,
  DataTable,
  DuplicateUrlWarning,
  EmptyState,
  MatchScoreBadge,
  StatusDot,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  applicationStatusVariant,
  automationVariant,
  humanizeStatus,
} from "../components/ui";
import type { Column } from "../components/ui";
import PreviewViewer from "../components/PreviewViewer";
import { useJobStore } from "../stores/useJobStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useAnime } from "../lib/useAnime";
import { animate, stagger } from "animejs";

/* Automation lifecycle states that mean "not actively running" — Start is
   available and Stop is not. Mirrors the engine's terminal/idle set. */
const IDLE_STATES: AutomationState[] = [
  "Queued",
  "Stopped",
  "Failed",
  "Completed",
  "PausedByUser",
  "RetryScheduled",
  "SkippedDuplicateUrl",
];

function humanState(state: AutomationState): string {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/* ── Types ───────────────────────────────────────────────────────── */

interface ApplicationRow {
  id: string;
  jobTitle: string;
  company: string;
  platform: string;
  status: ApplicationStatus;
  retryAttemptCount: number;
  /** Original job post URL - used by DuplicateUrlWarning on skipped rows. */
  url: string;
  /** Match score 0-100, or null when the job hasn't been scored. */
  matchScore: number | null;
}

/**
 * Map a backend JobStatus to the queue's ApplicationStatus subset.
 * Returns null for statuses that don't represent an in-flight application
 * (e.g. "discovered", "matched", "saved") - those rows are excluded.
 *
 * Mapping:
 *   applied               → submitted        (backend term vs UI term)
 *   skipped_duplicate_url → skipped_duplicate (truncated for display)
 *   queued / needs_review / failed are 1-to-1.
 */
function toAppStatus(s: JobStatus): ApplicationStatus | null {
  switch (s) {
    case "queued":
      return "queued";
    case "needs_review":
      return "needs_review";
    case "applied":
      return "submitted";
    case "failed":
      return "failed";
    case "skipped_duplicate_url":
      return "skipped_duplicate";
    default:
      return null;
  }
}

type FilterKey = "all" | ApplicationStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "needs_review", label: "Needs Review" },
  { key: "submitted", label: "Submitted" },
  { key: "failed", label: "Failed" },
  { key: "skipped_duplicate", label: "Duplicates" },
];

/* ── Columns ─────────────────────────────────────────────────────── */

function buildColumns(onReview: () => void): Column<ApplicationRow>[] {
  return [
    { key: "jobTitle", header: "Job", primary: true },
    { key: "company", header: "Company" },
    { key: "platform", header: "Platform", mono: true },
    {
      key: "matchScore",
      header: "Match",
      align: "right" as const,
      render: (row) => <MatchScoreBadge score={row.matchScore} />,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const variant = applicationStatusVariant(row.status);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <StatusDot variant={variant} />
            <Badge variant={variant}>{humanizeStatus(row.status)}</Badge>
          </span>
        );
      },
    },
    {
      key: "retryAttemptCount",
      header: "Retries",
      mono: true,
      align: "right" as const,
    },
    {
      key: "_actions",
      header: "",
      render: (row) => {
        if (row.status === "needs_review")
          return (
            <Button size="sm" onClick={onReview}>
              Review
            </Button>
          );
        if (row.status === "failed")
          return (
            <Button size="sm" disabled title="Retry is not connected yet">
              Retry unavailable
            </Button>
          );
        return null;
      },
    },
  ];
}

/* ── Component ───────────────────────────────────────────────────── */

export function ApplicationsQueue() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const activeProfileId = useProfileStore((s) => s.activeProfileId);

  // Automation engine — the LinkedIn Easy Apply run is human-in-the-loop: Start
  // drains queued apply_job tasks, the engine fills each form and PARKS at the
  // Submit button (state → "NeedsReview"), and the operator confirms or discards
  // it here. (The old Automation Cockpit page that owned these controls was
  // removed, orphaning the flow — this restores it.)
  const autoState = useAutomationStore((s) => s.state);
  const autoDetail = useAutomationStore((s) => s.detail);
  const autoError = useAutomationStore((s) => s.error);
  const start = useAutomationStore((s) => s.start);
  const pause = useAutomationStore((s) => s.pause);
  const resume = useAutomationStore((s) => s.resume);
  const stop = useAutomationStore((s) => s.stop);
  const confirmSubmit = useAutomationStore((s) => s.confirmSubmit);
  const rejectSubmit = useAutomationStore((s) => s.rejectSubmit);
  const clearError = useAutomationStore((s) => s.clearError);

  const isIdle = IDLE_STATES.includes(autoState);
  const isPaused = autoState === "PausedByUser";
  const isRunning = !isIdle && !isPaused;
  const needsReview = autoState === "NeedsReview";
  const automationRef = useRef<HTMLDivElement>(null);
  // Narrow selectors (not a whole-store destructure) so this page only
  // re-renders when a field it actually reads changes - `error` lives in
  // this store too but only JobSearch's banner needs it.
  const jobs = useJobStore((s) => s.jobs);
  const matches = useJobStore((s) => s.matches);
  const isLoading = useJobStore((s) => s.isLoading);
  const loadJobs = useJobStore((s) => s.loadJobs);
  const loadMatches = useJobStore((s) => s.loadMatches);

  // Reload all job posts whenever the active profile changes. We load without a
  // status filter and derive application rows client-side so the same fetch
  // also keeps JobSearch in sync (shared store instance). Matches are loaded
  // too so a row's job_matches.id can be resolved for the draft flow.
  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadMatches(activeProfileId);
  }, [activeProfileId, loadJobs, loadMatches]);

  // Index matches by jobId once for O(1) score lookup per row instead of a
  // per-row Array.find scan.
  const matchByJobId = useMemo(() => new Map(matches.map((m) => [m.jobId, m] as const)), [matches]);

  // Map JobPostDtos → ApplicationRows, dropping non-application statuses.
  const allRows: ApplicationRow[] = useMemo(
    () =>
      jobs.flatMap((j) => {
        const appStatus = toAppStatus(j.status);
        if (appStatus === null) return [];
        const match = matchByJobId.get(j.id);
        return [
          {
            id: j.id,
            jobTitle: j.title,
            company: j.company,
            platform: j.platform,
            status: appStatus,
            // retryAttemptCount is not tracked in JobPostDto (it lives in a separate
            // job_applications table not yet exposed by the API). Default to 0.
            retryAttemptCount: 0,
            url: j.url,
            matchScore: match ? Number(match.score) : null,
          },
        ];
      }),
    [jobs, matchByJobId],
  );

  const rows = useMemo(
    () => (activeFilter === "all" ? allRows : allRows.filter((r) => r.status === activeFilter)),
    [allRows, activeFilter],
  );

  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<FilterKey, number>>(
        (acc, f) => {
          acc[f.key] =
            f.key === "all" ? allRows.length : allRows.filter((r) => r.status === f.key).length;
          return acc;
        },
        {} as Record<FilterKey, number>,
      ),
    [allRows],
  );

  // A needs-review row points the operator at the parked-submit controls below;
  // the real form review happens in the live browser window.
  const handleReview = useCallback(() => {
    automationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const refreshRows = useCallback(() => {
    if (activeProfileId) void loadJobs(activeProfileId);
  }, [activeProfileId, loadJobs]);

  const handleConfirm = useCallback(async () => {
    await confirmSubmit();
    refreshRows();
  }, [confirmSubmit, refreshRows]);

  const handleDiscard = useCallback(async () => {
    await rejectSubmit();
    refreshRows();
  }, [rejectSubmit, refreshRows]);

  // buildColumns is pure over the two callbacks - memoize so DataTable gets a
  // stable columns array instead of a brand-new one (and new render closures
  // per cell) on every render.
  const columns = useMemo(() => buildColumns(handleReview), [handleReview]);

  // Stagger table rows on mount/filter change - data arriving at the console
  const tableRef = useRef<HTMLDivElement>(null);
  useAnime(tableRef, () => {
    animate("tbody tr", {
      opacity: [0, 1],
      translateY: [4, 0],
      delay: stagger(30, { from: "first" }),
      duration: 250,
      ease: "outExpo",
    });
  }, [activeFilter, rows.length]);

  const subtitle = isLoading ? "Loading..." : `${allRows.length} total`;

  const emptyBody =
    activeProfileId === null
      ? "Select a profile to see your applications."
      : "Run Job Search and start automation to begin applying.";

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Applications Queue</h1>
        <span className="page-subtitle">{subtitle}</span>
      </div>

      {/* Automation engine controls + parked-submit review (LinkedIn Easy Apply). */}
      <section
        ref={automationRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-3)",
          padding: "var(--sp-4)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-surface)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sp-3)" }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <StatusDot variant={automationVariant(autoState)} />
            <strong>{humanState(autoState)}</strong>
          </span>
          {autoDetail && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {autoDetail}
            </span>
          )}
          <ToolbarSpacer />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void start()}
            disabled={isRunning || isPaused}
            title="Drain queued applications through the browser engine"
          >
            Start run
          </Button>
          <Button size="sm" onClick={() => void pause()} disabled={!isRunning}>
            Pause
          </Button>
          <Button size="sm" onClick={() => void resume()} disabled={!isPaused}>
            Resume
          </Button>
          <Button
            size="sm"
            onClick={() => void stop()}
            disabled={autoState === "Stopped" || (isIdle && autoState !== "RetryScheduled")}
          >
            Stop
          </Button>
        </div>

        {/* Preview viewer: Live Automation (CDP screencast) + an interactive Browser tab. */}
        <PreviewViewer automationActive={isRunning || isPaused} className="evidence-viewer" />

        {needsReview && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "var(--sp-3)",
              padding: "var(--sp-3)",
              border: "1px solid var(--color-warning, #b7791f)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-surface-2)",
            }}
          >
            <div style={{ flex: 1, minWidth: "16rem" }}>
              <strong style={{ fontSize: "var(--text-sm)" }}>Filled — parked at Submit.</strong>
              <p
                style={{
                  margin: "var(--sp-1) 0 0",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                Review the form in the browser window. Nothing is submitted automatically — confirm
                to send it, or discard to skip this application.
              </p>
            </div>
            <Button variant="primary" size="sm" onClick={() => void handleConfirm()}>
              Confirm &amp; Submit
            </Button>
            <Button size="sm" onClick={() => void handleDiscard()}>
              Discard
            </Button>
          </div>
        )}

        {autoError && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              fontSize: "var(--text-xs)",
              color: "var(--color-danger, #c0392b)",
            }}
          >
            {autoError}
            <button
              type="button"
              onClick={clearError}
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              dismiss
            </button>
          </div>
        )}
      </section>

      <Toolbar>
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter by status"
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={activeFilter === f.key ? "filter-tab active" : "filter-tab"}
              onClick={() => setActiveFilter(f.key)}
              aria-pressed={activeFilter === f.key}
            >
              {f.label}
              <span className="filter-tab__count">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <ToolbarSpacer />
        <ToolbarSep />
        <Button disabled>Export CSV</Button>
        <Button disabled>Retry Failed</Button>
      </Toolbar>

      {activeFilter === "skipped_duplicate" && rows.length > 0 && (
        <DuplicateUrlWarning
          url={rows[0].url}
          message={
            rows.length === 1
              ? "1 job was skipped because its URL was already processed."
              : `${rows.length} jobs were skipped because their URLs were already processed. Example:`
          }
        />
      )}

      <div ref={tableRef}>
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          empty={<EmptyState label="Empty" title="No applications yet" body={emptyBody} />}
        />
      </div>
    </div>
  );
}
