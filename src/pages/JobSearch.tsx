import { useState } from "react";
import type { Job, JobStatus } from "../types/domain";

const MOCK_JOBS: Job[] = [
  { id: "j1", title: "Senior Rust Developer", company: "Cloudflare",  location: "Remote",            platform: "LinkedIn",   status: "discovered",   matchScore: 87 },
  { id: "j2", title: "Backend Engineer",      company: "Stripe",      location: "San Francisco, CA", platform: "Greenhouse", status: "queued",        matchScore: 72 },
  { id: "j3", title: "Systems Engineer",      company: "Figma",       location: "Remote",            platform: "LinkedIn",   status: "applied",       matchScore: 65 },
  { id: "j4", title: "Infra Engineer",        company: "Vercel",      location: "Remote",            platform: "Lever",      status: "needs_review",  matchScore: 59 },
  { id: "j5", title: "Staff Engineer",        company: "Temporal",    location: "Remote",            platform: "Ashby",      status: "failed",        matchScore: 80 },
];

const STATUS_BADGE: Record<JobStatus, string> = {
  discovered:           "badge--neutral",
  matched:              "badge--running",
  rejected:             "badge--stopped",
  queued:               "badge--queued",
  applied:              "badge--success",
  failed:               "badge--failed",
  needs_review:         "badge--review",
  saved:                "badge--neutral",
  ignored:              "badge--neutral",
  skipped_duplicate_url:"badge--neutral",
};

type FilterStatus = "all" | JobStatus;

const PLATFORMS = ["All", "LinkedIn", "Greenhouse", "Lever", "Ashby", "Workday"];

export function JobSearch() {
  const [statusFilter,   setStatusFilter]   = useState<FilterStatus>("all");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [selectedId,     setSelectedId]     = useState<string | null>(null);

  const filtered = MOCK_JOBS.filter((j) => {
    const matchStatus   = statusFilter === "all" || j.status === statusFilter;
    const matchPlatform = platformFilter === "All" || j.platform === platformFilter;
    return matchStatus && matchPlatform;
  });

  const selected = MOCK_JOBS.find((j) => j.id === selectedId) ?? null;

  return (
    <div className="page page--fill">
      {/* Toolbar */}
      <div className="toolbar toolbar--border">
        <button type="button" className="btn btn--primary" disabled>
          ▶ LinkedIn Search
        </button>
        <button type="button" className="btn btn--ghost" disabled>
          Google Dork
        </button>
        <div className="toolbar-sep" />
        <button type="button" className="btn btn--ghost" disabled={selectedId === null}>
          Score Selected
        </button>
        <button type="button" className="btn btn--ghost" disabled={selectedId === null}>
          Queue Selected
        </button>
        <button type="button" className="btn btn--ghost" disabled={selectedId === null}>
          Skip
        </button>
        <div className="toolbar-spacer" />
        <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
          {filtered.length} / {MOCK_JOBS.length} jobs
        </span>
      </div>

      {/* Three-pane */}
      <div className="three-pane">
        {/* Filters panel */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Filters</h2>
          </div>
          <div style={{ padding: "var(--sp-3)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            <div className="field">
              <label className="field__label" htmlFor="plat-filter">Platform</label>
              <select
                id="plat-filter"
                className="field__select"
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <span className="field__label" style={{ marginBottom: "var(--sp-2)", display: "block" }}>
                Status
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {(["all", "discovered", "queued", "matched", "applied", "needs_review", "failed"] as FilterStatus[]).map((s) => (
                  <label key={s} className="check-label">
                    <input
                      type="radio"
                      name="status-filter"
                      value={s}
                      checked={statusFilter === s}
                      onChange={() => setStatusFilter(s)}
                    />
                    {s === "all" ? "All statuses" : s.replace("_", " ")}
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="min-score">Min Match Score</label>
              <input
                id="min-score"
                type="number"
                className="field__input"
                min={0}
                max={100}
                defaultValue={0}
                placeholder="0 – 100"
              />
            </div>
          </div>
        </div>

        {/* Job list */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Jobs</h2>
            <span className="badge badge--neutral">{filtered.length}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">No jobs match</p>
              <p className="empty-state__body">Adjust filters or run a search.</p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((job) => (
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
                    <div className="list-item__meta">{job.company} · {job.location}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                    <span className={`badge ${STATUS_BADGE[job.status]}`}>
                      {job.status.replace("_", " ")}
                    </span>
                    {job.matchScore !== null && (
                      <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>
                        {job.matchScore}%
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Job detail */}
        <div className="three-pane__panel">
          <div className="panel-header">
            <h2 className="panel-header__title">Detail</h2>
          </div>

          {selected === null ? (
            <div className="empty-state">
              <div className="empty-state__label">Select</div>
              <p className="empty-state__title">No job selected</p>
              <p className="empty-state__body">Click a job from the list to see details and match explanation.</p>
            </div>
          ) : (
            <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--fw-semibold)", color: "var(--color-text)" }}>
                  {selected.title}
                </h3>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)", marginTop: 2 }}>
                  {selected.company}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
                {[
                  { label: "Location",  val: selected.location  },
                  { label: "Platform",  val: selected.platform  },
                  { label: "Status",    val: selected.status    },
                  { label: "Match",     val: selected.matchScore !== null ? `${selected.matchScore}%` : "–" },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", fontWeight: "var(--fw-semibold)" }}>
                      {label}
                    </div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                      {val}
                    </div>
                  </div>
                ))}
              </div>

              {selected.matchScore !== null && (
                <div>
                  <div className="section-title" style={{ marginBottom: "var(--sp-2)" }}>Match Score</div>
                  <div className="score-bar-row">
                    <span className="score-bar-label">Overall</span>
                    <div className="score-bar">
                      <div
                        className="score-bar__fill"
                        style={{ width: `${selected.matchScore}%` }}
                        role="progressbar"
                        aria-valuenow={selected.matchScore}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                    <span className="score-val">{selected.matchScore}%</span>
                  </div>
                </div>
              )}

              <div className="toolbar" style={{ flexWrap: "wrap" }}>
                <button type="button" className="btn btn--primary btn--sm">Queue</button>
                <button type="button" className="btn btn--ghost btn--sm">Open URL</button>
                <button type="button" className="btn btn--ghost btn--sm">Skip</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
