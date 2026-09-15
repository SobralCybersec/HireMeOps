import { Cancel01Icon, PlayIcon } from "@hugeicons/core-free-icons";
import type { JobMatchDto, JobPostDto, SearchQueryDto } from "../types/domain";
import { ApplicationDraftModal } from "../components/ApplicationDraftModal";
import { JobCalibrationPanel } from "./jobsearch/JobCalibrationPanel";
import { type SearchPlatform } from "./jobsearch/search-runners";
import { JobDetailPane, type JobDetailModel } from "./jobsearch/JobDetailPane";
import { JobResultsPane, type JobResultsModel } from "./jobsearch/JobResultsPane";
import type { ContactFilter, FilterStatus, WorkModeFilter } from "./jobsearch/job-search-types";
import {
  Button,
  Checkbox,
  Field,
  Icon,
  Input,
  Select,
  Switch,
  RadioGroup,
  Toolbar,
  ToolbarSep,
  ToolbarSpacer,
} from "../components/ui";
import "./JobSearch.css";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "discovered", label: "Discovered" },
  { value: "queued", label: "Queued" },
  { value: "matched", label: "Matched" },
  { value: "applied", label: "Applied" },
  { value: "needs_review", label: "Needs review" },
  { value: "failed", label: "Failed" },
];

import { useJobSearchController } from "./jobsearch/useJobSearchController";

const CONTACT_OPTIONS = [
  { value: "all", label: "Any" },
  { value: "email", label: "Has email" },
  { value: "phone", label: "Has phone" },
  { value: "any", label: "Has email or phone" },
];

function SavedQueries({
  queries,
  removingId,
  onRemove,
}: {
  queries: SearchQueryDto[];
  removingId: string | null;
  onRemove: (id: string) => void;
}) {
  if (queries.length === 0) return null;
  return (
    <Field label="Saved queries">
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--sp-1)",
        }}
      >
        {queries.map((query) => (
          <li
            key={query.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: "var(--text-xs)",
                color: "var(--color-text-2)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)",
              }}
              title={`${query.platform}: ${query.query}`}
            >
              {query.platform}: {query.query}
            </span>
            <Button
              size="sm"
              disabled={removingId !== null}
              onClick={() => onRemove(query.id)}
              aria-label={`Remove ${query.platform} query`}
            >
              <Icon icon={Cancel01Icon} size={12} />
            </Button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

function SkillChecks({
  skills,
  selectedSkills,
  onToggle,
}: {
  skills: string[];
  selectedSkills: string[];
  onToggle: (skill: string) => void;
}) {
  if (skills.length === 0) return null;
  return (
    <Field label="Skills in search" helper="Ticked skills stack into the hiring-posts query.">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
        {skills.map((skill) => (
          <Checkbox
            key={skill}
            checked={selectedSkills.includes(skill)}
            onChange={() => onToggle(skill)}
          >
            {skill}
          </Checkbox>
        ))}
      </div>
    </Field>
  );
}

function ContactFilterField({
  value,
  onChange,
}: {
  value: ContactFilter;
  onChange: (value: ContactFilter) => void;
}) {
  return (
    <Field label="Contact" helper="Show only posts exposing a way to apply directly.">
      <RadioGroup
        name="contact-filter"
        value={value}
        options={CONTACT_OPTIONS}
        onChange={(next) => onChange(next as ContactFilter)}
        label="Filter by contact"
      />
    </Field>
  );
}

function MinScoreField({
  value,
  onChange,
}: {
  value: number | "";
  onChange: (value: number | "") => void;
}) {
  return (
    <Field label="Min match score" helper="0 - 100. Blank shows every job.">
      <Input
        type="number"
        name="min-score"
        autoComplete="off"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          const score = Number(raw);
          if (Number.isFinite(score)) onChange(Math.max(0, Math.min(100, score)));
        }}
        placeholder="e.g. 70…"
      />
    </Field>
  );
}

function WorkModeField({
  value,
  onChange,
}: {
  value: WorkModeFilter;
  onChange: (value: WorkModeFilter) => void;
}) {
  return (
    <Field label="Work mode">
      <RadioGroup
        name="work-mode-filter"
        value={value}
        options={[
          { value: "all", label: "All" },
          { value: "remote", label: "Remote" },
          { value: "hybrid", label: "Hybrid" },
          { value: "onsite", label: "On-site" },
        ]}
        onChange={(next) => onChange(next as WorkModeFilter)}
        label="Filter by work mode"
      />
    </Field>
  );
}

function StatusField({
  value,
  onChange,
}: {
  value: FilterStatus;
  onChange: (value: FilterStatus) => void;
}) {
  return (
    <Field label="Status">
      <RadioGroup
        name="status-filter"
        value={value}
        options={STATUS_OPTIONS}
        onChange={(next) => onChange(next as FilterStatus)}
        label="Filter by status"
      />
    </Field>
  );
}

export type SearchFiltersModel = {
  mobilePane: "filters" | "jobs" | "detail";
  platformFilter: string;
  platformOptions: { value: string; label: string }[];
  wordsFilter: string;
  locationFilter: string;
  statusFilter: FilterStatus;
  workModeFilter: WorkModeFilter;
  minScore: number | "";
  contactFilter: ContactFilter;
  requiredSkills: string[];
  selectedSkills: string[];
  savedQueries: SearchQueryDto[];
  removingId: string | null;
  onPlatformChange: (value: string) => void;
  onWordsChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onStatusChange: (value: FilterStatus) => void;
  onWorkModeChange: (value: WorkModeFilter) => void;
  onMinScoreChange: (value: number | "") => void;
  onContactChange: (value: ContactFilter) => void;
  onToggleSkill: (skill: string) => void;
  onRemoveQuery: (id: string) => void;
};

function SearchFiltersPane({ model }: { model: SearchFiltersModel }) {
  const {
    mobilePane,
    platformFilter,
    platformOptions,
    wordsFilter,
    locationFilter,
    statusFilter,
    workModeFilter,
    minScore,
    contactFilter,
    requiredSkills,
    selectedSkills,
    savedQueries,
    removingId,
    onPlatformChange,
    onWordsChange,
    onLocationChange,
    onStatusChange,
    onWorkModeChange,
    onMinScoreChange,
    onContactChange,
    onToggleSkill,
    onRemoveQuery,
  } = model;
  return (
    <div
      className="three-pane__panel job-search__filters"
      data-mobile-active={mobilePane === "filters"}
    >
      <div className="panel-header job-search__panel-header">
        <h2 className="panel-header__title">Filters</h2>
      </div>
      <div className="section-group" style={{ padding: "var(--sp-3)" }}>
        <Field label="Platform">
          <Select
            name="platform"
            autoComplete="off"
            value={platformFilter}
            options={platformOptions}
            onChange={(event) => onPlatformChange(event.target.value)}
          />
        </Field>
        <Field label="Keywords" helper="Every word must appear in the job. Blank shows all.">
          <Input
            name="keywords"
            autoComplete="off"
            value={wordsFilter}
            onChange={(event) => onWordsChange(event.target.value)}
            placeholder="e.g. react, java, remote…"
          />
        </Field>
        <Field label="Location" helper="City, region, or 'remote'/'hybrid'. Blank shows all.">
          <Input
            name="location"
            autoComplete="off"
            value={locationFilter}
            onChange={(event) => onLocationChange(event.target.value)}
            placeholder="e.g. São Paulo, Remote…"
          />
        </Field>
        <StatusField value={statusFilter} onChange={onStatusChange} />
        <WorkModeField value={workModeFilter} onChange={onWorkModeChange} />
        <MinScoreField value={minScore} onChange={onMinScoreChange} />
        <ContactFilterField value={contactFilter} onChange={onContactChange} />
        <SkillChecks
          skills={requiredSkills}
          selectedSkills={selectedSkills}
          onToggle={onToggleSkill}
        />
        <SavedQueries queries={savedQueries} removingId={removingId} onRemove={onRemoveQuery} />
      </div>
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────────── */

export function JobSearch() {
  const viewModel = useJobSearchController();
  return <JobSearchView model={viewModel} />;
}

export type JobSearchViewModel = {
  activeProfileId: string | null;
  filtered: JobPostDto[];
  jobs: JobPostDto[];
  matches: JobMatchDto[];
  queuedCount: number;
  showPreferences: boolean;
  bannerError: string | null;
  dismissError: () => void;
  canSearch: boolean;
  runningAll: boolean;
  isGenerating: boolean;
  searchDisabledTitle: string | undefined;
  handleRunAll: () => Promise<void>;
  showManual: boolean;
  toggleManual: () => void;
  handleRunSearch: (platform: SearchPlatform) => Promise<void>;
  togglePreferences: () => void;
  handleDeleteOldScans: () => Promise<void>;
  selectedId: string | null;
  isLoading: boolean;
  handleScoreSelected: () => Promise<void>;
  handleQueueSelected: () => Promise<void>;
  handleQueueAll: () => Promise<void>;
  handleSkipSelected: () => Promise<void>;
  isApplying: boolean;
  handleAutoApply: () => void;
  hideDuplicates: boolean;
  hiddenDupeCount: number;
  setHideDuplicates: (value: boolean) => void;
  searchMsg: string | null;
  mobilePane: "filters" | "jobs" | "detail";
  setMobilePane: (value: "filters" | "jobs" | "detail") => void;
  panesModel: JobSearchPanesModel;
  selectedMatchId: string | null;
  draftModalOpen: boolean;
  setDraftModalOpen: (value: boolean) => void;
};

const MANUAL_SEARCHES: { platform: SearchPlatform; label: string }[] = [
  { platform: "linkedin", label: "LinkedIn" },
  { platform: "google", label: "Google Dork" },
  { platform: "posts", label: "Hiring posts" },
  { platform: "catho", label: "Catho" },
  { platform: "infojobs", label: "InfoJobs" },
  { platform: "gupy", label: "Gupy" },
  { platform: "indeed", label: "Indeed" },
  { platform: "upwork", label: "Upwork" },
  { platform: "99freelas", label: "99freelas" },
  { platform: "programathor", label: "ProgramaThor" },
  { platform: "geekhunter", label: "GeekHunter" },
];
function JobSearchView({ model }: { model: JobSearchViewModel }) {
  const { showPreferences, panesModel, selectedMatchId, draftModalOpen, setDraftModalOpen } = model;
  return (
    <div
      className={`page page--fill job-search-page${showPreferences ? " job-search-page--preferences" : ""}`}
    >
      <SearchMasthead model={model} />
      <SearchToolbar model={model} />
      <MobileSearchTabs model={model} />
      <SearchPreferences model={model} />

      <JobSearchPanes model={panesModel} />

      <ApplicationDraftModal
        jobMatchId={selectedMatchId}
        open={draftModalOpen}
        onClose={() => setDraftModalOpen(false)}
      />
    </div>
  );
}

function SearchMasthead({ model }: { model: JobSearchViewModel }) {
  const { activeProfileId, filtered, jobs, matches, queuedCount, bannerError, dismissError } =
    model;
  return (
    <>
      <header className="job-search__masthead">
        <div>
          <div className="job-search__eyebrow">
            Sourcing workspace / {activeProfileId === null ? "No profile" : "Profile ready"}
          </div>
          <h1 className="job-search__title">Job search</h1>
          <p className="job-search__subtitle">
            Search connected sources, compare fit, and move strong roles into your queue.
          </p>
        </div>
        <div className="job-search__signal" aria-label={`${filtered.length} visible jobs`}>
          <span>Visible now</span>
          <strong>{filtered.length}</strong>
        </div>
        <div className="job-search__metrics" aria-label="Job search summary">
          <span>
            <b>{jobs.length}</b> total
          </span>
          <span>
            <b>{matches.length}</b> scored
          </span>
          <span>
            <b>{queuedCount}</b> queued
          </span>
        </div>
      </header>

      {/* Error banner */}
      {bannerError !== null && (
        <div className="banner banner--error" role="alert">
          <span>{bannerError}</span>
          <Button size="sm" onClick={dismissError} aria-label="Dismiss error">
            <Icon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      )}
    </>
  );
}

function SearchToolbar({ model }: { model: JobSearchViewModel }) {
  const {
    canSearch,
    runningAll,
    isGenerating,
    searchDisabledTitle,
    handleRunAll,
    showPreferences,
    showManual,
    toggleManual,
    handleRunSearch,
    togglePreferences,
    handleDeleteOldScans,
    selectedId,
    isLoading,
    handleScoreSelected,
    handleQueueSelected,
    handleQueueAll,
    handleSkipSelected,
    isApplying,
    handleAutoApply,
    hideDuplicates,
    hiddenDupeCount,
    setHideDuplicates,
    searchMsg,
    filtered,
    jobs,
    activeProfileId,
  } = model;
  return (
    <Toolbar border className="job-search__toolbar" aria-label="Job search actions">
      <Button
        variant="primary"
        disabled={!canSearch || runningAll}
        title={searchDisabledTitle}
        icon={isGenerating || runningAll ? undefined : <Icon icon={PlayIcon} size={14} />}
        onClick={() => void handleRunAll()}
      >
        {runningAll ? "Searching all…" : isGenerating ? "Generating…" : "Search all"}
      </Button>
      <Button size="sm" onClick={() => toggleManual()} title="Run one platform at a time">
        {showManual ? "Hide manual searches" : "Manual searches"}
      </Button>
      <Button
        size="sm"
        onClick={() => togglePreferences()}
        title="Target roles, skills, filters that drive search & scoring"
      >
        {showPreferences ? "Hide preferences" : "Preferences"}
      </Button>
      {showManual && (
        <>
          <ToolbarSep />
          {MANUAL_SEARCHES.map(({ platform, label }) => (
            <Button
              key={platform}
              size="sm"
              disabled={!canSearch}
              title={searchDisabledTitle}
              onClick={() => void handleRunSearch(platform)}
            >
              {label}
            </Button>
          ))}
        </>
      )}
      <ToolbarSep />
      <Button
        disabled={activeProfileId === null}
        title={activeProfileId === null ? "Select a profile first" : undefined}
        onClick={() => void handleDeleteOldScans()}
      >
        Delete old scans
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
      <Button
        disabled={activeProfileId === null || isLoading}
        title="Queue every fresh (non-duplicate) job in this view"
        onClick={() => void handleQueueAll()}
      >
        Queue all
      </Button>
      <Button disabled={selectedId === null || isLoading} onClick={handleSkipSelected}>
        Skip
      </Button>
      <ToolbarSep />
      <Button
        variant="primary"
        disabled={activeProfileId === null || isApplying}
        title="Submit an application to every queued job. Catho, InfoJobs, Indeed, and LinkedIn use visible windows."
        onClick={() => void handleAutoApply()}
      >
        {isApplying ? "Auto-applying…" : "Auto-apply all"}
      </Button>
      <ToolbarSep />
      <Switch checked={hideDuplicates} onChange={setHideDuplicates}>
        Hide duplicates{hiddenDupeCount > 0 ? ` (${hiddenDupeCount} hidden)` : ""}
      </Switch>
      <ToolbarSpacer />
      {searchMsg !== null && (
        <span
          aria-live="polite"
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
          aria-live="polite"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Loading…
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
  );
}

function SearchPreferences({ model }: { model: JobSearchViewModel }) {
  const { showPreferences } = model;
  return (
    <>
      {showPreferences && (
        <div className="job-search__preferences">
          <JobCalibrationPanel />
        </div>
      )}
    </>
  );
}

export type JobSearchPanesModel = {
  showPreferences: boolean;
  filters: SearchFiltersModel;
  results: JobResultsModel;
  detail: JobDetailModel;
};

function JobSearchPanes({ model }: { model: JobSearchPanesModel }) {
  return (
    <div className="three-pane job-search__panes" hidden={model.showPreferences}>
      <SearchFiltersPane model={model.filters} />
      <JobResultsPane model={model.results} />
      <JobDetailPane model={model.detail} />
    </div>
  );
}

function MobileSearchTabs({ model }: { model: JobSearchViewModel }) {
  const { mobilePane, filtered, setMobilePane } = model;
  return (
    <nav className="job-search__mobile-tabs" aria-label="Search workspace sections">
      <button
        type="button"
        className={mobilePane === "filters" ? "is-active" : undefined}
        aria-pressed={mobilePane === "filters"}
        onClick={() => setMobilePane("filters")}
      >
        Filters
      </button>
      <button
        type="button"
        className={mobilePane === "jobs" ? "is-active" : undefined}
        aria-pressed={mobilePane === "jobs"}
        onClick={() => setMobilePane("jobs")}
      >
        Jobs <span>{filtered.length}</span>
      </button>
      <button
        type="button"
        className={mobilePane === "detail" ? "is-active" : undefined}
        aria-pressed={mobilePane === "detail"}
        onClick={() => setMobilePane("detail")}
      >
        Detail
      </button>
    </nav>
  );
}
