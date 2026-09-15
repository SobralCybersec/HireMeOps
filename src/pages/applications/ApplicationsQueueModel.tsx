import type { ApplicationStatus } from "../types/domain";
import {
  Badge,
  Button,
  MatchScoreBadge,
  StatusDot,
  applicationStatusVariant,
  humanizeStatus,
} from "../components/ui";
import type { Column } from "../components/ui";

export interface ApplicationRow {
  id: string;
  jobTitle: string;
  company: string;
  platform: string;
  status: ApplicationStatus;
  retryAttemptCount: number;
  url: string;
  matchScore: number | null;
}

export type FilterKey = "all" | ApplicationStatus;

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "queued", label: "Queued" },
  { key: "needs_review", label: "Needs Review" },
  { key: "submitted", label: "Submitted" },
  { key: "failed", label: "Failed" },
  { key: "skipped_duplicate", label: "Duplicates" },
];

export function buildColumns(onReview: () => void): Column<ApplicationRow>[] {
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
    { key: "retryAttemptCount", header: "Retries", mono: true, align: "right" as const },
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
