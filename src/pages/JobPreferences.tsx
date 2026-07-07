import { useState } from "react";
import { useJobFiltersStore } from "../stores/useJobFiltersStore";

const SENIORITY_OPTIONS = [
  "Internship",
  "Entry Level",
  "Mid Level",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Manager",
];
const REMOTE_OPTIONS = ["On-site", "Hybrid", "Remote", "Flexible"];

// ---------------------------------------------------------------------------
// TagInput — displays current tags + inline text input to add new ones.
// ---------------------------------------------------------------------------
function TagInput({
  values,
  onChange,
  placeholder = "Type and press Enter…",
  id,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const t = draft.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setDraft("");
  }

  return (
    <div className="tag-list" role="group" aria-label={placeholder}>
      {values.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button
            type="button"
            className="tag-remove"
            onClick={() => onChange(values.filter((v) => v !== tag))}
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className="tag-input"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Backspace" && draft === "" && values.length > 0)
            onChange(values.slice(0, -1));
        }}
        onBlur={commit}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function JobPreferences() {
  const filters = useJobFiltersStore((s) => s.filters);
  const set     = useJobFiltersStore((s) => s.setFilter);
  const reset   = useJobFiltersStore((s) => s.reset);

  // Search query / dork templates live in local state until the store is extended.
  const [searchTemplates, setSearchTemplates] = useState<string[]>([]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Job Preferences</h1>
        <span className="page-subtitle">
          Filters applied to every search &amp; scoring run
        </span>
      </div>

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="toolbar-spacer" />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={reset}
        >
          Reset to defaults
        </button>
      </div>

      {/* ── §1 Target Criteria ── */}
      <div className="section-group">
        <h2 className="section-title">Target Criteria</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="pref-roles">
              Target Roles
            </label>
            <TagInput
              id="pref-roles"
              values={filters.targetRoles}
              onChange={(v) => set("targetRoles", v)}
              placeholder="e.g. Backend Engineer"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pref-loc">
              Locations
            </label>
            <TagInput
              id="pref-loc"
              values={filters.locations}
              onChange={(v) => set("locations", v)}
              placeholder="e.g. Remote, Berlin"
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Seniority</span>
            <div className="check-group" style={{ marginTop: "var(--sp-1)" }}>
              {SENIORITY_OPTIONS.map((opt) => (
                <label key={opt} className="check-label">
                  <input
                    type="checkbox"
                    checked={filters.seniority.includes(opt)}
                    onChange={(e) =>
                      set(
                        "seniority",
                        e.target.checked
                          ? [...filters.seniority, opt]
                          : filters.seniority.filter((s) => s !== opt),
                      )
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Remote Mode</span>
            <div className="check-group" style={{ marginTop: "var(--sp-1)" }}>
              {REMOTE_OPTIONS.map((opt) => (
                <label key={opt} className="check-label">
                  <input
                    type="checkbox"
                    checked={filters.remoteModes.includes(opt)}
                    onChange={(e) =>
                      set(
                        "remoteModes",
                        e.target.checked
                          ? [...filters.remoteModes, opt]
                          : filters.remoteModes.filter((m) => m !== opt),
                      )
                    }
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── §2 Compensation ── */}
      <div className="section-group">
        <h2 className="section-title">Compensation</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="min-salary">
              Minimum Salary (annual, USD)
            </label>
            <input
              id="min-salary"
              type="number"
              className="field__input"
              min={0}
              step={5000}
              value={filters.minSalary ?? ""}
              onChange={(e) =>
                set(
                  "minSalary",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              placeholder="e.g. 120000"
            />
            <span className="field__helper">
              Leave blank to skip salary filtering.
            </span>
          </div>
        </div>
      </div>

      {/* ── §3 Skills ── */}
      <div className="section-group">
        <h2 className="section-title">Skills</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="req-skills">
              Required Skills
            </label>
            <TagInput
              id="req-skills"
              values={filters.requiredSkills}
              onChange={(v) => set("requiredSkills", v)}
              placeholder="e.g. Rust, Kubernetes"
            />
            <span className="field__helper">
              Jobs missing these will be rejected.
            </span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pref-skills">
              Preferred Skills
            </label>
            <TagInput
              id="pref-skills"
              values={filters.preferredSkills}
              onChange={(v) => set("preferredSkills", v)}
              placeholder="e.g. PostgreSQL, gRPC"
            />
            <span className="field__helper">Boost match score when present.</span>
          </div>
        </div>
      </div>

      {/* ── §4 Exclusions ── */}
      <div className="section-group">
        <h2 className="section-title">Exclusions</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="excl-kw">
              Excluded Keywords
            </label>
            <TagInput
              id="excl-kw"
              values={filters.excludedKeywords}
              onChange={(v) => set("excludedKeywords", v)}
              placeholder="e.g. PHP, unpaid, intern"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="block-co">
              Blocked Companies
            </label>
            <TagInput
              id="block-co"
              values={filters.blockedCompanies}
              onChange={(v) => set("blockedCompanies", v)}
              placeholder="e.g. AmazingStartup Inc."
            />
          </div>
        </div>
      </div>

      {/* ── §5 Auto-Submit Rules (locked) ── */}
      <div className="section-group">
        <h2 className="section-title">Auto-Submit Rules</h2>
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--sp-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
          }}
        >
          {(
            [
              { label: "Minimum match score to auto-submit",    val: "60 %" },
              { label: "Needs-review confidence threshold",      val: "50 %" },
              { label: "Not a duplicate URL for this profile",   val: "Required" },
              { label: "No active captcha / manual check",       val: "Required" },
              { label: "Required profile facts present",         val: "Required" },
            ] satisfies { label: string; val: string }[]
          ).map(({ label, val }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sp-4)",
              }}
            >
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)" }}>
                {label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-accent)",
                  flexShrink: 0,
                }}
              >
                {val}
              </span>
            </div>
          ))}
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            These thresholds are enforced by the automation engine and cannot be
            lowered to prevent accidental mass-submissions.
          </p>
        </div>
      </div>

      {/* ── §6 Retry Rules (locked) ── */}
      <div className="section-group">
        <h2 className="section-title">Retry Rules</h2>
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--sp-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
          }}
        >
          {(
            [
              { label: "Retry transient failures",  val: "Yes" },
              { label: "Max retry attempts",         val: "10" },
              { label: "Daily application limit",    val: "None" },
              { label: "Daily connection limit",     val: "None" },
            ] satisfies { label: string; val: string }[]
          ).map(({ label, val }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sp-4)",
              }}
            >
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-2)" }}>
                {label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  color: "var(--color-accent)",
                  flexShrink: 0,
                }}
              >
                {val}
              </span>
            </div>
          ))}
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            Transient failures (network timeouts, rate-limits) are retried
            automatically. Permanent failures (e.g. already applied) are not retried.
          </p>
        </div>
      </div>

      {/* ── §7 Search Query / Dork Templates ── */}
      <div className="section-group">
        <h2 className="section-title">Search Query Templates</h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field__label" htmlFor="search-templates">
              Query / Dork Templates
            </label>
            <TagInput
              id="search-templates"
              values={searchTemplates}
              onChange={setSearchTemplates}
              placeholder='e.g. site:linkedin.com/jobs "rust engineer" remote'
            />
            <span className="field__helper">
              Each template is used verbatim as a search query. Supports LinkedIn
              search strings and Google dork syntax. The automation cycles through
              all templates per run.
            </span>
          </div>
          {searchTemplates.length > 0 && (
            <div
              style={{ gridColumn: "1 / -1" }}
              aria-live="polite"
              aria-label="Active templates"
            >
              <p
                style={{
                  margin: "0 0 var(--sp-2)",
                  fontSize: "var(--text-xs)",
                  color: "var(--color-text-muted)",
                }}
              >
                {searchTemplates.length} template
                {searchTemplates.length !== 1 ? "s" : ""} active
              </p>
              <ol
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-1)",
                }}
              >
                {searchTemplates.map((tpl, i) => (
                  <li
                    key={tpl}
                    style={{
                      display: "flex",
                      gap: "var(--sp-3)",
                      padding: "var(--sp-2) var(--sp-3)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--fw-semibold)",
                        color: "var(--color-text-muted)",
                        fontFamily: "var(--font-mono)",
                        minWidth: "1.5rem",
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <code
                      style={{
                        fontSize: "var(--text-xs)",
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-text)",
                        wordBreak: "break-all",
                      }}
                    >
                      {tpl}
                    </code>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
