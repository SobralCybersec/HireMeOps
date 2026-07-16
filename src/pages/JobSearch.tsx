import { useState, useEffect, useMemo } from "react";
import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { JobStatus, SearchQueryInput } from "../types/domain";
import { useJobStore } from "../stores/useJobStore";
import { useJobFiltersStore } from "../stores/useJobFiltersStore";
import { useSearchQueryStore } from "../stores/useSearchQueryStore";
import { useProfileStore } from "../stores/useProfileStore";
import { ApplicationDraftModal } from "../components/ApplicationDraftModal";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Icon,
  Input,
  MatchScoreBadge,
  ScoreBar,
  Select,
  RadioGroup,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
  jobStatusVariant,
  matchScoreVariant,
  humanizeStatus,
} from "../components/ui";

/* ── Constants ──────────────────────────────────────────────────── */

type FilterStatus = "all" | JobStatus;

const PLATFORM_OPTIONS = [
  { value: "All", label: "All" },
  { value: "LinkedIn", label: "LinkedIn" },
  { value: "Greenhouse", label: "Greenhouse" },
  { value: "Lever", label: "Lever" },
  { value: "Ashby", label: "Ashby" },
  { value: "Workday", label: "Workday" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "discovered", label: "Discovered" },
  { value: "queued", label: "Queued" },
  { value: "matched", label: "Matched" },
  { value: "applied", label: "Applied" },
  { value: "needs_review", label: "Needs review" },
  { value: "failed", label: "Failed" },
];

/* ── Component ──────────────────────────────────────────────────── */

export function JobSearch() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [minScore, setMinScore] = useState<number | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const filters = useJobFiltersStore((s) => s.filters);
  const {
    jobs,
    matches,
    isLoading,
    error,
    loadJobs,
    loadMatches,
    scoreJob,
    setJobStatus,
    runSearch,
    clearError,
  } = useJobStore();
  // Narrow selectors - useSearchQueryStore also carries `isLoading`, which
  // this page never reads; a whole-store subscription would re-render here
  // on every list-load toggle for no visible change.
  const queries = useSearchQueryStore((s) => s.queries);
  const isGenerating = useSearchQueryStore((s) => s.isGenerating);
  const searchError = useSearchQueryStore((s) => s.error);
  const loadQueries = useSearchQueryStore((s) => s.load);
  const generateQueries = useSearchQueryStore((s) => s.generate);
  const clearSearchError = useSearchQueryStore((s) => s.clearError);

  // Reload whenever the active profile changes.
  useEffect(() => {
    if (!activeProfileId) return;
    void loadJobs(activeProfileId);
    void loadMatches(activeProfileId);
    void loadQueries(activeProfileId);
  }, [activeProfileId, loadJobs, loadMatches, loadQueries]);

  // Build the generator input from the shared job-filters working set. Returns
  // null when no profile is active. targetRoles must be non-empty for a
  // meaningful query - the button gating enforces that before we get here.
  const buildSearchInput = (): SearchQueryInput | null => {
    if (activeProfileId === null) return null;
    return {
      profileId: activeProfileId,
      titles: filters.targetRoles,
      requiredSkills: filters.requiredSkills,
      location: filters.locations[0] ?? null,
      remoteMode: filters.remoteModes[0]?.toLowerCase() ?? null,
      seniority: filters.seniority,
    };
  };

  // Generate queries (once) if none exist yet, then run the enabled query for
  // the chosen platform and refresh the job list with whatever it discovered.
  const handleRunSearch = async (platform: "linkedin" | "google") => {
    if (activeProfileId === null) return;
    setSearchMsg(null);

    let available = queries;
    if (available.length === 0) {
      const input = buildSearchInput();
      if (input === null) return;
      const ids = await generateQueries(input);
      if (ids === null) return;
      available = useSearchQueryStore.getState().queries;
    }

    const target = available.find((q) => q.platform === platform && q.enabled);
    if (target === undefined) {
      setSearchMsg(`No ${platform} query available.`);
      return;
    }

    const count = await runSearch(target.id);
    if (count === null) return;
    setSearchMsg(
      count === 0
        ? `No imported ${platform} jobs to process. Online discovery is not connected yet.`
        : `Processed ${count} imported ${platform} job${count === 1 ? "" : "s"}.`,
    );
    await loadJobs(activeProfileId);
    await loadMatches(activeProfileId);
  };

  const canSearch =
    activeProfileId !== null && !isLoading && !isGenerating && filters.targetRoles.length > 0;

  const searchDisabledTitle =
    activeProfileId === null
      ? "Select a profile first"
      : filters.targetRoles.length === 0
        ? "Set target roles in Job Preferences first"
        : undefined;

  const bannerError = error ?? searchError;
  const dismissError = () => {
    clearError();
    clearSearchError();
  };

  // Index matches by jobId once for O(1) lookup instead of an Array.find scan
  // per job, per render (filter, list badges, and detail pane all query it).
  const scoreByJobId = useMemo(() => {
    const m = new Map<string, number>();
    for (const match of matches) m.set(match.jobId, Math.round(match.score));
    return m;
  }, [matches]);

  const matchScoreFor = (jobId: string): number | null => scoreByJobId.get(jobId) ?? null;

  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        const matchStatus = statusFilter === "all" || j.status === statusFilter;
        const matchPlatform = platformFilter === "All" || j.platform === platformFilter;
        if (!matchStatus || !matchPlatform) return false;
        // Min-score gate: only applied when the user set a threshold. Unscored jobs
        // (score === null) fall through so the operator can still see and score
        // them; hiding them would misleadingly imply they were rejected.
        if (typeof minScore === "number" && minScore > 0) {
          const s = scoreByJobId.get(j.id) ?? null;
          if (s !== null && s < minScore) return false;
        }
        return true;
      }),
    [jobs, statusFilter, platformFilter, minScore, scoreByJobId],
  );

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const selectedMatchScore = selected !== null ? matchScoreFor(selected.id) : null;
  const selectedMatchId =
    selected !== null ? (matches.find((m) => m.jobId === selected.id)?.id ?? null) : null;
  // Full match row for the selected job (used for score breakdown).
  const selectedMatch =
    selected !== null ? (matches.find((m) => m.jobId === selected.id) ?? null) : null;

  const handleScoreSelected = async () => {
    if (selectedId === null || activeProfileId === null) return;
    await scoreJob(selectedId, activeProfileId);
  };

  const handleQueueSelected = async () => {
    if (selectedId === null) return;
    await setJobStatus(selectedId, "queued");
  };

  const handleQueueDetail = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "queued");
  };

  const handleSkipSelected = async () => {
    if (selected === null) return;
    await setJobStatus(selected.id, "ignored");
  };

  const handleOpenSelected = async () => {
    if (selected === null) return;
    try {
      await openUrl(selected.url);
    } catch (e) {
      setSearchMsg(`Could not open job URL: ${String(e)}`);
    }
  };

  return (
    <div className="page page--fill">
      {/* Error banner */}
      {bannerError !== null && (
        <div className="banner banner--error" role="alert">
          <span>{bannerError}</span>
          <Button size="sm" onClick={dismissError} aria-label="Dismiss error">
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <Toolbar border>
        <Button
          variant="primary"
          disabled={!canSearch}
          title={searchDisabledTitle}
          icon={isGenerating ? undefined : <Icon icon={PlayIcon} size={14} />}
          onClick={() => handleRunSearch("linkedin")}
        >
          {isGenerating ? "Generating..." : "LinkedIn Search"}
        </Button>
        <Button
          disabled={!canSearch}
          title={searchDisabledTitle}
          onClick={() => handleRunSearch("google")}
        >
          Google Dork
        </Button>
        <ToolbarSep />
        <Button
          disabled={selectedId === null || activeProfileId === null || isLoading}
          onClick={handleScoreSelected}
        >
          Score Selected
        </Button>
        <Button disabled={selectedId === null || isLoading} onClick={handleQueueSelected}>
          Queue Selected
        </Button>
        <Button disabled={selectedId === null || isLoading} onClick={handleSkipSelected}>
          Skip
        </Button>
        <ToolbarSpacer />
        {searchMsg !== null && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-2)",
            }}
          >
            {searchMsg}
          </span>
        )}
        {isLoading && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            Loading...
          </span>
        )}
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filtered.length} / {jobs.length} jobs
        </span>
      </Toolbar>

      {/* Three-pane */}
      <div className="three-pane">
        {/* ── Filters panel ──────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Filters</h2>
          </div>
          <div className="section-group" style={{ padding: "var(--sp-3)" }}>
            <Field label="Platform">
              <Select
                value={platformFilter}
                options={PLATFORM_OPTIONS}
                onChange={(e) => setPlatformFilter(e.target.value)}
              />
            </Field>

            <Field label="Status">
              <RadioGroup
                name="status-filter"
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={(v) => setStatusFilter(v as FilterStatus)}
                label="Filter by status"
              />
            </Field>

            <Field label="Min match score" helper="0 - 100. Blank shows every job.">
              <Input
                type="number"
                min={0}
                max={100}
                step={5}
                value={minScore}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setMinScore("");
                    return;
                  }
                  const n = Number(raw);
                  if (Number.isFinite(n)) {
                    setMinScore(Math.max(0, Math.min(100, n)));
                  }
                }}
                placeholder="0"
              />
            </Field>
          </div>
        </div>

        {/* ── Job list ────────────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Jobs</h2>
            <Badge variant="neutral">{filtered.length}</Badge>
          </div>

          {activeProfileId === null ? (
            <EmptyState
              label="Profile"
              title="No profile selected"
              body="Select a profile to load jobs."
            />
          ) : isLoading ? (
            <EmptyState title="Loading..." />
          ) : filtered.length === 0 ? (
            <EmptyState
              label="Empty"
              title="No jobs match"
              body="Adjust filters or run a search."
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((job) => {
                const score = matchScoreFor(job.id);
                return (
                  <li
                    key={job.id}
                    className={selectedId === job.id ? "list-item selected" : "list-item"}
                    onClick={() => setSelectedId(job.id)}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selectedId === job.id}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(job.id)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="list-item__name">{job.title}</div>
                      <div className="list-item__meta">
                        {job.company} · {job.location ?? "Remote"}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "var(--sp-1)",
                        flexShrink: 0,
                      }}
                    >
                      <Badge variant={jobStatusVariant(job.status)}>
                        {humanizeStatus(job.status)}
                      </Badge>
                      {score !== null && <MatchScoreBadge score={score} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Job detail ─────────────────────────────────────────── */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Detail</h2>
          </div>

          {selected === null ? (
            <EmptyState
              label="Select"
              title="No job selected"
              body="Click a job from the list to see details and match explanation."
            />
          ) : (
            <div
              style={{
                padding: "var(--sp-4)",
                display: "flex",
                flexDirection: "column",
                gap: "var(--sp-4)",
              }}
            >
              {/* Header */}
              <div>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "var(--text-md)",
                    fontWeight: "var(--fw-semibold)",
                    color: "var(--color-text)",
                  }}
                >
                  {selected.title}
                </h3>
                <div className="list-item__meta" style={{ marginTop: "var(--sp-1)" }}>
                  {selected.company}
                </div>
              </div>

              {/* Metadata grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "var(--sp-3)",
                }}
              >
                <DetailField label="Location" value={selected.location ?? "Remote"} />
                <DetailField label="Platform" value={selected.platform} />
                <DetailField label="Status">
                  <Badge variant={jobStatusVariant(selected.status)}>
                    {humanizeStatus(selected.status)}
                  </Badge>
                </DetailField>
                <DetailField label="Match">
                  <MatchScoreBadge score={selectedMatchScore} />
                </DetailField>
              </div>

              {/* Score breakdown (only when scored) */}
              {selectedMatch !== null && (
                <div>
                  <h4 className="section-title" style={{ marginBottom: "var(--sp-2)" }}>
                    Score Breakdown
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--sp-2)",
                    }}
                  >
                    <ScoreBar
                      label="Overall"
                      value={selectedMatch.score}
                      variant={matchScoreVariant(selectedMatch.score)}
                    />
                    <ScoreBar
                      label="Role"
                      value={selectedMatch.roleScore}
                      variant={matchScoreVariant(selectedMatch.roleScore)}
                    />
                    <ScoreBar
                      label="Skills"
                      value={selectedMatch.skillScore}
                      variant={matchScoreVariant(selectedMatch.skillScore)}
                    />
                    <ScoreBar
                      label="Seniority"
                      value={selectedMatch.seniorityScore}
                      variant={matchScoreVariant(selectedMatch.seniorityScore)}
                    />
                    <ScoreBar
                      label="Location"
                      value={selectedMatch.locationScore}
                      variant={matchScoreVariant(selectedMatch.locationScore)}
                    />
                    <ScoreBar
                      label="Salary"
                      value={selectedMatch.salaryScore}
                      variant={matchScoreVariant(selectedMatch.salaryScore)}
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <Toolbar>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isLoading}
                  onClick={handleQueueDetail}
                >
                  Queue
                </Button>
                <Button
                  size="sm"
                  disabled={selectedMatchId === null}
                  title={
                    selectedMatchId === null
                      ? "Score this job first to draft an application"
                      : "Draft an application for this match"
                  }
                  onClick={() => setDraftModalOpen(true)}
                >
                  Draft
                </Button>
                <Button size="sm" onClick={() => void handleOpenSelected()}>
                  Open URL
                </Button>
                <Button size="sm" onClick={() => void handleSkipSelected()}>
                  Skip
                </Button>
              </Toolbar>
            </div>
          )}
        </div>
      </div>

      <ApplicationDraftModal
        jobMatchId={selectedMatchId}
        open={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
      />
    </div>
  );
}

/* ── Detail field sub-component ─────────────────────────────────── */

function DetailField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-2xs)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-text-muted)",
          fontWeight: "var(--fw-semibold)",
        }}
      >
        {label}
      </div>
      {children ?? (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--color-text-2)",
            fontFamily: "var(--font-mono)",
            marginTop: "2px",
          }}
        >
          {value}
        </div>
      )}
    </div>
  );
}
