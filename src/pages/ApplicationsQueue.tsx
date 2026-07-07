import { useState } from "react";
import type { ApplicationStatus } from "../types/domain";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  applicationStatusVariant,
  humanizeStatus,
} from "../components/ui";
import type { Column } from "../components/ui";

/* ── Types ───────────────────────────────────────────────────────── */

interface ApplicationRow {
  id: string;
  jobTitle: string;
  company: string;
  platform: string;
  status: ApplicationStatus;
  retryAttemptCount: number;
}

// Placeholder data – replace with real store once backend is wired
const MOCK_ROWS: ApplicationRow[] = [];

type FilterKey = "all" | ApplicationStatus;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",               label: "All"          },
  { key: "queued",            label: "Queued"       },
  { key: "needs_review",      label: "Needs Review" },
  { key: "submitted",         label: "Submitted"    },
  { key: "failed",            label: "Failed"       },
  { key: "skipped_duplicate", label: "Duplicates"   },
];

/* ── Columns ─────────────────────────────────────────────────────── */

function buildColumns(
  onReview: (row: ApplicationRow) => void,
  onRetry:  (row: ApplicationRow) => void,
): Column<ApplicationRow>[] {
  return [
    { key: "jobTitle", header: "Job",      primary: true },
    { key: "company",  header: "Company"               },
    { key: "platform", header: "Platform", mono: true  },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={applicationStatusVariant(row.status)}>
          {humanizeStatus(row.status)}
        </Badge>
      ),
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
          return <Button size="sm" onClick={() => onReview(row)}>Review</Button>;
        if (row.status === "failed")
          return <Button size="sm" onClick={() => onRetry(row)}>Retry</Button>;
        return null;
      },
    },
  ];
}

/* ── Component ───────────────────────────────────────────────────── */

export function ApplicationsQueue() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const rows =
    activeFilter === "all"
      ? MOCK_ROWS
      : MOCK_ROWS.filter((r) => r.status === activeFilter);

  const counts = FILTERS.reduce<Record<FilterKey, number>>((acc, f) => {
    acc[f.key] =
      f.key === "all"
        ? MOCK_ROWS.length
        : MOCK_ROWS.filter((r) => r.status === f.key).length;
    return acc;
  }, {} as Record<FilterKey, number>);

  // Phase 1 stubs – wire to store actions once backend is ready
  const handleReview = (_row: ApplicationRow) => {};
  const handleRetry  = (_row: ApplicationRow) => {};

  const columns = buildColumns(handleReview, handleRetry);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Applications Queue</h1>
        <span className="page-subtitle">{MOCK_ROWS.length} total</span>
      </div>

      <Toolbar>
        <div className="filter-tabs" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={activeFilter === f.key ? "filter-tab active" : "filter-tab"}
              onClick={() => setActiveFilter(f.key)}
              aria-pressed={activeFilter === f.key}
            >
              {f.label}
              <span className="filter-tab__count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <ToolbarSpacer />
        <ToolbarSep />
        <Button disabled>Export CSV</Button>
        <Button disabled>Retry Failed</Button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        empty={
          <EmptyState
            label="Empty"
            title="No applications yet"
            body="Run Job Search and start automation to begin applying."
          />
        }
      />
    </div>
  );
}
