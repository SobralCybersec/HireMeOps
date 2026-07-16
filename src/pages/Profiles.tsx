import { useEffect, useState } from "react";
import { Tick01Icon } from "@hugeicons/core-free-icons";
import { useProfileStore } from "../stores/useProfileStore";
import { Badge, Button, Field, FormRow, Icon, Input, Select } from "../components/ui";
import type { Profile } from "../types/domain";

// ---------------------------------------------------------------------------
// Local profile facts - persisted to backend once connection is wired (Phase 2)
// ---------------------------------------------------------------------------
interface ProfileFacts {
  salaryMin: string;
  salaryCurrency: string;
  salaryPeriod: string;
  brazilWorkAuth: string;
  euWorkAuth: string;
  visaSponsorship: string;
  startDate: string;
  relocation: string;
  englishLevel: string;
}

interface ProfileLinks {
  linkedin: string;
  github: string;
  portfolio: string;
}

const BLANK_FACTS: ProfileFacts = {
  salaryMin: "",
  salaryCurrency: "USD",
  salaryPeriod: "Annual",
  brazilWorkAuth: "",
  euWorkAuth: "",
  visaSponsorship: "",
  startDate: "",
  relocation: "",
  englishLevel: "",
};

const BLANK_LINKS: ProfileLinks = { linkedin: "", github: "", portfolio: "" };
// ---------------------------------------------------------------------------

export function Profiles() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const isLoading = useProfileStore((s) => s.isLoading);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);
  const setActive = useProfileStore((s) => s.setActiveProfile);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Effective selection: honour an explicit pick while it still exists,
  // otherwise fall back to the first profile. Derived during render, so no
  // auto-select effect (and no setState-in-effect) is needed.
  const selected: Profile | null = profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null;

  return (
    <div className="page page--fill" style={{ padding: 0 }}>
      {/* ── Page header ── */}
      <div
        style={{
          padding: "var(--sp-4)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          flexShrink: 0,
        }}
      >
        <h1 className="page-title">Profiles</h1>
        <span className="page-subtitle">
          {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
        </span>
        <div className="toolbar-spacer" />
        <Button variant="primary" size="sm" disabled>
          + New Profile
        </Button>
      </div>

      {isLoading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p className="empty-state__title">Loading profiles...</p>
        </div>
      ) : (
        <div
          className="two-pane"
          style={{
            flex: 1,
            borderRadius: 0,
            border: "none",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {/* ── Profile list ── */}
          <div className="two-pane__list">
            <div className="two-pane__list-header">
              <span
                style={{
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--fw-semibold)",
                  letterSpacing: "0.10em",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                }}
              >
                All Profiles
              </span>
            </div>

            {profiles.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state__title">No profiles</p>
                <p className="empty-state__body">Create your first profile to get started.</p>
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {profiles.map((p) => (
                  <li
                    key={p.id}
                    className={selected?.id === p.id ? "list-item selected" : "list-item"}
                    onClick={() => setSelectedId(p.id)}
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected?.id === p.id}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedId(p.id);
                    }}
                  >
                    <div>
                      <div className="list-item__name">{p.name}</div>
                      <div className="list-item__meta">{p.id.slice(0, 8)}</div>
                    </div>
                    {p.id === activeProfileId && <Badge variant="success">Active</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Profile detail ── */}
          <div className="two-pane__detail">
            {selected === null ? (
              <div className="empty-state">
                <div className="empty-state__label">Select</div>
                <p className="empty-state__title">No profile selected</p>
                <p className="empty-state__body">
                  Pick a profile from the list, or create a new one.
                </p>
              </div>
            ) : (
              // Keyed by profile id: switching profile remounts this subtree,
              // which resets its local form state - no reset effect required.
              <ProfileDetail
                key={selected.id}
                profile={selected}
                activeProfileId={activeProfileId}
                onSetActive={setActive}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail pane - owns the editable form state for a single profile. Because the
// parent mounts it with `key={profile.id}`, selecting a different profile gives
// a fresh instance with blank form state automatically.
// ---------------------------------------------------------------------------
function ProfileDetail({
  profile,
  activeProfileId,
  onSetActive,
}: {
  profile: Profile;
  activeProfileId: string | null;
  onSetActive: (id: string) => void | Promise<void>;
}) {
  const [facts, setFacts] = useState<ProfileFacts>(BLANK_FACTS);
  const [links, setLinks] = useState<ProfileLinks>(BLANK_LINKS);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function patchFact<K extends keyof ProfileFacts>(k: K, v: ProfileFacts[K]) {
    setFacts((prev) => ({ ...prev, [k]: v }));
  }
  function patchLink<K extends keyof ProfileLinks>(k: K, v: string) {
    setLinks((prev) => ({ ...prev, [k]: v }));
  }

  return (
    <>
      {/* ── §1 Identity ── */}
      <div className="section-group">
        <h2 className="section-title">Identity</h2>
        <FormRow>
          <Field label="Name" htmlFor="prof-name" helper="Editing requires backend connection.">
            <Input
              id="prof-name"
              type="text"
              defaultValue={profile.name}
              readOnly
              aria-readonly="true"
            />
          </Field>
          <Field label="Profile ID">
            <code
              style={{
                display: "block",
                padding: "var(--sp-2) var(--sp-3)",
                background: "var(--color-surface-2)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-2)",
                wordBreak: "break-all",
              }}
            >
              {profile.id}
            </code>
          </Field>
        </FormRow>
      </div>

      {/* ── §2 Status ── */}
      <div className="section-group">
        <h2 className="section-title">Status</h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--sp-3) var(--sp-4)",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--color-text)",
                fontWeight: "var(--fw-medium)",
              }}
            >
              {profile.id === activeProfileId ? "Active profile" : "Inactive"}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {profile.id === activeProfileId
                ? "This profile is used for all automation runs."
                : "Activate to use this profile in automation."}
            </div>
          </div>
          {profile.id !== activeProfileId ? (
            <Button variant="primary" size="sm" onClick={() => void onSetActive(profile.id)}>
              Set Active
            </Button>
          ) : (
            <Badge variant="success">
              <Icon icon={Tick01Icon} size={12} /> Active
            </Badge>
          )}
        </div>
      </div>

      {/* ── §3 Profile Facts ── */}
      <div className="section-group">
        <h2 className="section-title">Profile Facts</h2>

        {/* Salary trio */}
        <FormRow cols={3}>
          <Field label="Salary Minimum" htmlFor="prof-salary-min">
            <Input
              id="prof-salary-min"
              type="number"
              min={0}
              step={1000}
              value={facts.salaryMin}
              onChange={(e) => patchFact("salaryMin", e.target.value)}
              placeholder="e.g. 120000"
            />
          </Field>
          <Field label="Currency" htmlFor="prof-currency">
            <Select
              id="prof-currency"
              value={facts.salaryCurrency}
              options={["USD", "EUR", "BRL", "GBP", "CAD", "AUD"].map((c) => ({
                value: c,
                label: c,
              }))}
              onChange={(e) => patchFact("salaryCurrency", e.target.value)}
            />
          </Field>
          <Field label="Period" htmlFor="prof-period">
            <Select
              id="prof-period"
              value={facts.salaryPeriod}
              options={[
                { value: "Annual", label: "Annual" },
                { value: "Monthly", label: "Monthly" },
                { value: "Hourly", label: "Hourly" },
              ]}
              onChange={(e) => patchFact("salaryPeriod", e.target.value)}
            />
          </Field>
        </FormRow>

        {/* Work authorization trio */}
        <FormRow cols={3}>
          <Field label="Brazil Work Authorization" htmlFor="prof-br-auth">
            <Select
              id="prof-br-auth"
              value={facts.brazilWorkAuth}
              placeholder="- select -"
              options={[
                { value: "citizen", label: "Brazilian Citizen" },
                { value: "permanent_resident", label: "Permanent Resident" },
                { value: "work_visa", label: "Work Visa" },
                { value: "not_authorized", label: "Not Authorized" },
              ]}
              onChange={(e) => patchFact("brazilWorkAuth", e.target.value)}
            />
          </Field>
          <Field label="EU Work Authorization" htmlFor="prof-eu-auth">
            <Select
              id="prof-eu-auth"
              value={facts.euWorkAuth}
              placeholder="- select -"
              options={[
                { value: "eu_citizen", label: "EU Citizen" },
                { value: "eu_resident", label: "EU Resident Permit" },
                { value: "work_visa", label: "Work Visa Required" },
                { value: "not_authorized", label: "Not Authorized" },
              ]}
              onChange={(e) => patchFact("euWorkAuth", e.target.value)}
            />
          </Field>
          <Field label="Visa Sponsorship" htmlFor="prof-visa">
            <Select
              id="prof-visa"
              value={facts.visaSponsorship}
              placeholder="- select -"
              options={[
                { value: "not_required", label: "Not Required" },
                { value: "required", label: "Required" },
                { value: "open", label: "Open to Sponsorship" },
              ]}
              onChange={(e) => patchFact("visaSponsorship", e.target.value)}
            />
          </Field>
        </FormRow>

        {/* Logistics trio */}
        <FormRow cols={3}>
          <Field label="Available Start Date" htmlFor="prof-start">
            <Input
              id="prof-start"
              type="date"
              value={facts.startDate}
              onChange={(e) => patchFact("startDate", e.target.value)}
            />
          </Field>
          <Field label="Relocation" htmlFor="prof-relocation">
            <Select
              id="prof-relocation"
              value={facts.relocation}
              placeholder="- select -"
              options={[
                { value: "no", label: "Not open to relocation" },
                { value: "yes", label: "Open to relocation" },
                { value: "domestic", label: "Domestic only" },
                { value: "international", label: "International" },
              ]}
              onChange={(e) => patchFact("relocation", e.target.value)}
            />
          </Field>
          <Field label="English Level" htmlFor="prof-english">
            <Select
              id="prof-english"
              value={facts.englishLevel}
              placeholder="- select -"
              options={[
                { value: "native", label: "Native" },
                { value: "fluent", label: "Fluent" },
                { value: "advanced", label: "Advanced (C1)" },
                {
                  value: "upper_intermediate",
                  label: "Upper Intermediate (B2)",
                },
                { value: "intermediate", label: "Intermediate (B1)" },
                { value: "basic", label: "Basic" },
              ]}
              onChange={(e) => patchFact("englishLevel", e.target.value)}
            />
          </Field>
        </FormRow>

        <p
          style={{
            margin: "var(--sp-3) 0 0",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Facts are per-profile and used as answers during form automation. Persisted to backend
          once connection is wired.
        </p>
      </div>

      {/* ── §4 Links ── */}
      <div className="section-group">
        <h2 className="section-title">Links</h2>
        <FormRow cols={3}>
          <Field label="LinkedIn" htmlFor="prof-linkedin">
            <Input
              id="prof-linkedin"
              type="url"
              value={links.linkedin}
              onChange={(e) => patchLink("linkedin", e.target.value)}
              placeholder="https://linkedin.com/in/username"
            />
          </Field>
          <Field label="GitHub" htmlFor="prof-github">
            <Input
              id="prof-github"
              type="url"
              value={links.github}
              onChange={(e) => patchLink("github", e.target.value)}
              placeholder="https://github.com/username"
            />
          </Field>
          <Field label="Portfolio" htmlFor="prof-portfolio">
            <Input
              id="prof-portfolio"
              type="url"
              value={links.portfolio}
              onChange={(e) => patchLink("portfolio", e.target.value)}
              placeholder="https://yoursite.com"
            />
          </Field>
        </FormRow>
      </div>

      {/* ── §5 Browser Session ── */}
      <div className="section-group">
        <h2 className="section-title">Browser Session</h2>
        <FormRow>
          <Field
            label="Browser Profile Folder"
            span="full"
            helper="Each profile has its own isolated browser session. The folder is deleted when the profile is deleted."
          >
            <code
              style={{
                display: "block",
                padding: "var(--sp-2) var(--sp-3)",
                background: "var(--color-surface-2)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-xs)",
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-2)",
                wordBreak: "break-all",
              }}
            >
              {`~/.hiremeops/profiles/${profile.id}/browser`}
            </code>
          </Field>
        </FormRow>
      </div>

      {/* ── §6 Danger Zone ── */}
      <div className="danger-zone">
        <p className="danger-zone__title">Danger Zone</p>
        <p className="danger-zone__body">
          Deleting this profile permanently removes all associated database rows, copied CVs,
          evidence files, and the browser profile folder. This cannot be undone.
        </p>
        {!confirmDelete ? (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete Profile
          </Button>
        ) : (
          <div
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Button
              variant="danger"
              size="sm"
              disabled
              aria-label="Confirm delete - backend connection required"
            >
              Confirm Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-text-muted)",
              }}
            >
              Backend connection required to delete.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
