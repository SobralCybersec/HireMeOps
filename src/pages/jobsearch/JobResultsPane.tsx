import type { JobPostDto } from "../../types/domain";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "./platform-constants";
import {
  Badge,
  Button,
  EmptyState,
  MatchScoreBadge,
  humanizeStatus,
  jobStatusVariant,
} from "../../components/ui";

function JobResultItem({
  job,
  selected,
  score,
  onSelect,
}: {
  job: JobPostDto;
  selected: boolean;
  score: number | null;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      className={
        selected ? "list-item job-search__result selected" : "list-item job-search__result"
      }
    >
      <button
        type="button"
        className="job-search__result-button"
        aria-pressed={selected}
        onClick={() => onSelect(job.id)}
      >
        <div className="job-search__result-main">
          {PLATFORM_ICONS[job.platform] && (
            <img
              src={PLATFORM_ICONS[job.platform]}
              alt={PLATFORM_LABELS[job.platform] ?? job.platform}
              title={PLATFORM_LABELS[job.platform] ?? job.platform}
              width={22}
              height={22}
              style={{ borderRadius: 5, flexShrink: 0 }}
            />
          )}
          <div className="job-search__result-copy">
            <div className="list-item__name">{job.title}</div>
            <div className="list-item__meta">
              {job.company} · {job.location ?? "Remote"}
            </div>
          </div>
        </div>
        <div className="job-search__result-state">
          <Badge variant={jobStatusVariant(job.status)}>{humanizeStatus(job.status)}</Badge>
          {score !== null && <MatchScoreBadge score={score} />}
        </div>
      </button>
    </li>
  );
}

export function JobResultsPane({ model }: { model: JobResultsModel }) {
  const {
    mobilePane,
    filtered,
    activeProfileId,
    isLoading,
    selectedId,
    matchScoreFor,
    selectJob,
    nextCursor,
    wordsFilter,
    loadMore,
  } = model;
  return (
    <div
      className="three-pane__panel job-search__results"
      data-mobile-active={mobilePane === "jobs"}
    >
      <div className="panel-header job-search__panel-header">
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
        <EmptyState title="Loading…" />
      ) : filtered.length === 0 ? (
        <EmptyState label="Empty" title="No jobs match" body="Adjust filters or run a search." />
      ) : (
        <div>
          <ul className="job-search__result-list" aria-label="Job results">
            {filtered.map((job) => (
              <JobResultItem
                key={job.id}
                job={job}
                selected={selectedId === job.id}
                score={matchScoreFor(job.id)}
                onSelect={selectJob}
              />
            ))}
          </ul>
          {nextCursor !== null && wordsFilter.trim().length < 2 && (
            <Button size="sm" disabled={isLoading} onClick={loadMore}>
              Load more jobs
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export type JobResultsModel = {
  mobilePane: "filters" | "jobs" | "detail";
  filtered: JobPostDto[];
  activeProfileId: string | null;
  isLoading: boolean;
  selectedId: string | null;
  matchScoreFor: (jobId: string) => number | null;
  selectJob: (id: string) => void;
  nextCursor: unknown;
  wordsFilter: string;
  loadMore: () => void;
};
