import type { RefObject } from "react";
import type { AutomationState } from "../types/domain";
import {
  Button,
  DataTable,
  DuplicateUrlWarning,
  EmptyState,
  StatusDot,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  automationVariant,
} from "../components/ui";
import type { Column } from "../components/ui";
import PreviewViewer from "../components/PreviewViewer";
import { FILTERS, type ApplicationRow, type FilterKey } from "./ApplicationsQueueModel";

function humanState(state: AutomationState): string {
  return state.replace(/([a-z])([A-Z])/g, "$1 $2");
}

interface AutomationPanelProps {
  automationRef: RefObject<HTMLDivElement | null>;
  autoState: AutomationState;
  autoDetail: string | null;
  autoError: string | null;
  isIdle: boolean;
  isPaused: boolean;
  isRunning: boolean;
  needsReview: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onClearError: () => void;
}

function AutomationControls(
  props: Pick<
    AutomationPanelProps,
    | "autoState"
    | "autoDetail"
    | "isIdle"
    | "isPaused"
    | "isRunning"
    | "onStart"
    | "onPause"
    | "onResume"
    | "onStop"
  >,
) {
  const { autoState, autoDetail, isIdle, isPaused, isRunning, onStart, onPause, onResume, onStop } =
    props;
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--sp-3)" }}>
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
        onClick={onStart}
        disabled={isRunning || isPaused}
        title="Drain queued applications through the browser engine"
      >
        Start run
      </Button>
      <Button size="sm" onClick={onPause} disabled={!isRunning}>
        Pause
      </Button>
      <Button size="sm" onClick={onResume} disabled={!isPaused}>
        Resume
      </Button>
      <Button
        size="sm"
        onClick={onStop}
        disabled={autoState === "Stopped" || (isIdle && autoState !== "RetryScheduled")}
      >
        Stop
      </Button>
    </div>
  );
}

function ReviewPrompt({
  onConfirm,
  onDiscard,
}: Pick<AutomationPanelProps, "onConfirm" | "onDiscard">) {
  return (
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
          Review the form in the browser window. Nothing is submitted automatically — confirm to
          send it, or discard to skip this application.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onConfirm}>
        Confirm &amp; Submit
      </Button>
      <Button size="sm" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  );
}

function AutomationError({ message, onClear }: { message: string; onClear: () => void }) {
  return (
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
      {message}
      <button
        type="button"
        onClick={onClear}
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
  );
}

function AutomationPanel(props: AutomationPanelProps) {
  const {
    automationRef,
    autoError,
    needsReview,
    isRunning,
    isPaused,
    onConfirm,
    onDiscard,
    onClearError,
  } = props;
  return (
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
      <AutomationControls {...props} />
      <PreviewViewer automationActive={isRunning || isPaused} className="evidence-viewer" />
      {needsReview && <ReviewPrompt onConfirm={onConfirm} onDiscard={onDiscard} />}
      {autoError && <AutomationError message={autoError} onClear={onClearError} />}
    </section>
  );
}

interface FilterBarProps {
  activeFilter: FilterKey;
  counts: Record<FilterKey, number>;
  onFilter: (filter: FilterKey) => void;
}

function FilterBar({ activeFilter, counts, onFilter }: FilterBarProps) {
  return (
    <Toolbar>
      <div
        className="filter-tabs"
        role="group"
        aria-label="Filter by status"
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            className={activeFilter === filter.key ? "filter-tab active" : "filter-tab"}
            onClick={() => onFilter(filter.key)}
            aria-pressed={activeFilter === filter.key}
          >
            {filter.label}
            <span className="filter-tab__count">{counts[filter.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <ToolbarSpacer />
      <ToolbarSep />
      <Button disabled>Export CSV</Button>
      <Button disabled>Retry Failed</Button>
    </Toolbar>
  );
}

export interface ApplicationsQueueViewProps extends AutomationPanelProps {
  tableRef: RefObject<HTMLDivElement | null>;
  activeFilter: FilterKey;
  counts: Record<FilterKey, number>;
  rows: ApplicationRow[];
  columns: Column<ApplicationRow>[];
  isLoading: boolean;
  totalRows: number;
  emptyBody: string;
  onFilter: (filter: FilterKey) => void;
}

export function ApplicationsQueueView(props: ApplicationsQueueViewProps) {
  const {
    tableRef,
    activeFilter,
    counts,
    rows,
    columns,
    isLoading,
    totalRows,
    emptyBody,
    onFilter,
    ...automation
  } = props;
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Applications Queue</h1>
        <span className="page-subtitle">{isLoading ? "Loading..." : `${totalRows} total`}</span>
      </div>
      <AutomationPanel {...automation} />
      <FilterBar activeFilter={activeFilter} counts={counts} onFilter={onFilter} />
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
          getRowKey={(row) => row.id}
          empty={<EmptyState label="Empty" title="No applications yet" body={emptyBody} />}
        />
      </div>
    </div>
  );
}
