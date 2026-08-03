import { useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useJobFiltersStore } from "../../stores/useJobFiltersStore";
import { useJobPreferencesStore } from "../../stores/useJobPreferencesStore";
import { useProfileStore } from "../../stores/useProfileStore";
import {
  Badge,
  Button,
  Card,
  Field,
  FormRow,
  Icon,
  Input,
  Switch,
  Toolbar,
  ToolbarSpacer,
} from "../../components/ui";
import { mockSearchTemplates } from "../../lib/devMocks";
import type { CreateJobPreferenceInput } from "../../types/domain";

/** Default name used when persisting the single global preference set. */
const DEFAULT_PREFERENCE_NAME = "Default";

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
// TagInput - displays current tags + inline text input to add new ones.
// The internal draft <input> stays a raw element because it is a specialised
// composite control (chip strip + editable buffer) that Lane 1's Input primitive
// does not model; the wrapping .tag-list carries the focus ring and border, so
// the buffer intentionally has no border of its own.
// ---------------------------------------------------------------------------
function TagInput({
  values,
  onChange,
  placeholder = "Type and press Enter",
  id,
  "aria-describedby": ariaDescribedBy,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
  "aria-describedby"?: string;
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
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className="tag-input"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        aria-describedby={ariaDescribedBy}
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
// JobCalibrationPanel - the former Job Preferences page, folded into Job Search
// as a collapsible calibration bench. Filters live in useJobFiltersStore (shared
// with the search + scorer); boot hydration from the newest saved preference now
// happens in useJobPreferencesStore.load, so this panel is pure edit + persist.
// ---------------------------------------------------------------------------
export function JobCalibrationPanel() {
  const filters = useJobFiltersStore((s) => s.filters);
  const set = useJobFiltersStore((s) => s.setFilter);
  const reset = useJobFiltersStore((s) => s.reset);

  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const save = useJobPreferencesStore((s) => s.save);
  const isSaving = useJobPreferencesStore((s) => s.isSaving);
  const saveError = useJobPreferencesStore((s) => s.error);

  // Search query / dork templates live in local state until the store is extended.
  // Off-Tauri dev builds seed these from the mock layer; `[]` in production.
  const [searchTemplates, setSearchTemplates] = useState<string[]>(mockSearchTemplates);

  // Transient "Saved" confirmation shown after a successful persist.
  const [justSaved, setJustSaved] = useState(false);

  async function handleSave() {
    if (!activeProfileId) return;
    setJustSaved(false);
    const input: CreateJobPreferenceInput = {
      profileId: activeProfileId,
      name: DEFAULT_PREFERENCE_NAME,
      targetRolesJson: JSON.stringify(filters.targetRoles),
      seniorityJson: JSON.stringify(filters.seniority),
      locationsJson: JSON.stringify(filters.locations),
      remoteModesJson: JSON.stringify(filters.remoteModes),
      minSalary: filters.minSalary,
      salaryCurrency: "USD",
      requiredSkillsJson: JSON.stringify(filters.requiredSkills),
      preferredSkillsJson: JSON.stringify(filters.preferredSkills),
      excludedKeywordsJson: JSON.stringify(filters.excludedKeywords),
      blockedCompaniesJson: JSON.stringify(filters.blockedCompanies),
      // auto-submit / retry rules are locked in the UI → backend defaults apply.
    };
    const id = await save(input);
    if (id) setJustSaved(true);
  }

  // Small helpers to toggle a value inside a multi-select checkbox group. Keeps
  // the onChange handlers below flat and readable.
  const toggleSeniority = (opt: string, on: boolean) =>
    set("seniority", on ? [...filters.seniority, opt] : filters.seniority.filter((s) => s !== opt));
  const toggleRemote = (opt: string, on: boolean) =>
    set(
      "remoteModes",
      on ? [...filters.remoteModes, opt] : filters.remoteModes.filter((m) => m !== opt),
    );

  return (
    <div className="calibration-panel">
      {/* ── Toolbar ── */}
      <Toolbar>
        <ToolbarSpacer />
        {saveError && <Badge variant="failed">{saveError}</Badge>}
        {justSaved && !saveError && <Badge variant="success">Saved</Badge>}
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset to defaults
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!activeProfileId || isSaving}
          title={activeProfileId ? undefined : "Select a profile to save preferences"}
        >
          {isSaving ? "Saving..." : "Save preferences"}
        </Button>
      </Toolbar>

      {/* Three logical groups (target profile, match filters, search templates)
         share ONE Card so the panel reads as a continuous form rather than three
         competing rounded panels. Hairline dividers carry the hierarchy. */}
      <Card title="Calibration">
        <div className="section-group">
          <h3 className="section-title">Target Profile</h3>
          <FormRow cols={2}>
            <Field label="Target roles" helper="One per tag. Drives every generated search query.">
              <TagInput
                values={filters.targetRoles}
                onChange={(v) => set("targetRoles", v)}
                placeholder="e.g. Backend Engineer"
              />
            </Field>
            <Field
              label="Locations"
              helper="City, region, or 'Remote'. First entry seeds the search."
            >
              <TagInput
                values={filters.locations}
                onChange={(v) => set("locations", v)}
                placeholder="e.g. Remote, Berlin"
              />
            </Field>
          </FormRow>

          <FormRow cols={2}>
            <Field label="Seniority" span="full">
              <div className="check-group" role="group" aria-label="Seniority">
                {SENIORITY_OPTIONS.map((opt) => (
                  <Switch
                    key={opt}
                    checked={filters.seniority.includes(opt)}
                    onChange={(on) => toggleSeniority(opt, on)}
                  >
                    {opt}
                  </Switch>
                ))}
              </div>
            </Field>
          </FormRow>

          <FormRow cols={2}>
            <Field label="Remote mode" span="full">
              <div className="check-group" role="group" aria-label="Remote mode">
                {REMOTE_OPTIONS.map((opt) => (
                  <Switch
                    key={opt}
                    checked={filters.remoteModes.includes(opt)}
                    onChange={(on) => toggleRemote(opt, on)}
                  >
                    {opt}
                  </Switch>
                ))}
              </div>
            </Field>
          </FormRow>

          <FormRow cols={2}>
            <Field
              label="Minimum salary"
              helper="Annual, USD. Leave blank to skip salary filtering."
            >
              <Input
                type="number"
                min={0}
                step={5000}
                value={filters.minSalary ?? ""}
                onChange={(e) =>
                  set("minSalary", e.target.value === "" ? null : Number(e.target.value))
                }
                placeholder="e.g. 120000"
              />
            </Field>
          </FormRow>
        </div>

        <div className="section-group" style={{ marginTop: "var(--sp-5)" }}>
          <h3 className="section-title">Match Filters</h3>
          <FormRow cols={2}>
            <Field
              label="Required skills"
              helper="Missing these sharply lowers the match score and flags a risk (not a hard reject)."
            >
              <TagInput
                values={filters.requiredSkills}
                onChange={(v) => set("requiredSkills", v)}
                placeholder="e.g. Rust, Kubernetes"
              />
            </Field>
            <Field label="Preferred skills" helper="Boost match score when present.">
              <TagInput
                values={filters.preferredSkills}
                onChange={(v) => set("preferredSkills", v)}
                placeholder="e.g. PostgreSQL, gRPC"
              />
            </Field>
          </FormRow>
          <FormRow cols={2}>
            <Field label="Excluded keywords">
              <TagInput
                values={filters.excludedKeywords}
                onChange={(v) => set("excludedKeywords", v)}
                placeholder="e.g. PHP, unpaid, intern"
              />
            </Field>
            <Field label="Blocked companies">
              <TagInput
                values={filters.blockedCompanies}
                onChange={(v) => set("blockedCompanies", v)}
                placeholder="e.g. AmazingStartup Inc."
              />
            </Field>
          </FormRow>
        </div>

        <div className="section-group" style={{ marginTop: "var(--sp-5)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--sp-3)",
            }}
          >
            <h3 className="section-title" style={{ margin: 0, borderBottom: 0, paddingBottom: 0 }}>
              Search Templates
            </h3>
            {searchTemplates.length > 0 && (
              <span
                aria-live="polite"
                style={{
                  fontSize: "var(--text-xs)",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-muted)",
                }}
              >
                {searchTemplates.length} active
              </span>
            )}
          </div>

          <Field
            label="Query / dork templates"
            helper="Each template runs verbatim as a search query. Supports LinkedIn search strings and Google dork syntax."
          >
            <TagInput
              values={searchTemplates}
              onChange={setSearchTemplates}
              placeholder='e.g. site:linkedin.com/jobs "rust engineer" remote'
            />
          </Field>

          {searchTemplates.length > 0 && (
            <ol
              aria-label="Active templates"
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
                <li key={tpl} className="locked-settings__row">
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
                      flex: 1,
                    }}
                  >
                    {tpl}
                  </code>
                  <button
                    type="button"
                    className="tag-remove"
                    onClick={() => setSearchTemplates(searchTemplates.filter((_, j) => j !== i))}
                    aria-label={`Remove template ${i + 1}`}
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}
