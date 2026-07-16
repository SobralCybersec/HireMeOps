import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ApplicationStatus, JobStatus } from "../types/domain";
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
  humanizeStatus,
} from "../components/ui";
import type { Column } from "../components/ui";
import { useJobStore } from "../stores/useJobStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useAnime } from "../lib/useAnime";
import { animate, stagger } from "animejs";

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
  const navigate = useNavigate();

  const activeProfileId = useProfileStore((s) => s.activeProfileId);
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

  // The automation browser remains open on a human-handoff outcome. Take the
  // operator to the cockpit instead of generating a second draft.
  const handleReview = useCallback(() => navigate("/automation"), [navigate]);

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
