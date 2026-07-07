import { useEffect, useState } from "react";
import { useProfileStore } from "../stores/useProfileStore";
import type { Profile } from "../types/domain";

// ---------------------------------------------------------------------------
// Local profile facts — persisted to backend once connection is wired (Phase 2)
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
  const profiles        = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const isLoading       = useProfileStore((s) => s.isLoading);
  const loadProfiles    = useProfileStore((s) => s.loadProfiles);
  const setActive       = useProfileStore((s) => s.setActiveProfile);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  // Effective selection: honour an explicit pick while it still exists,
  // otherwise fall back to the first profile. Derived during render, so no
  // auto-select effect (and no setState-in-effect) is needed.
  const selected: Profile | null =
    profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null;

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
        <button type="button" className="btn btn--primary btn--sm" disabled>
          + New Profile
        </button>
      </div>

      {isLoading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p className="empty-state__title">Loading profiles…</p>
        </div>
      ) : (
        <div
          className="two-pane"
          style={{ flex: 1, borderRadius: 0, border: "none", borderTop: "1px solid var(--color-border)" }}
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
                    onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(p.id); }}
                  >
                    <div>
                      <div className="list-item__name">{p.name}</div>
                      <div className="list-item__meta">{p.id.slice(0, 8)}</div>
                    </div>
                    {p.id === activeProfileId && (
                      <span className="badge badge--success">Active</span>
                    )}
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
              // which resets its local form state — no reset effect required.
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
// Detail pane — owns the editable form state for a single profile. Because the
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
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="prof-name">Name</label>
            <input
              id="prof-name"
              type="text"
              className="field__input"
              defaultValue={profile.name}
              readOnly
              style={{ cursor: "not-allowed", opacity: 0.7 }}
            />
            <span className="field__helper">Editing requires backend connection.</span>
          </div>
          <div className="field">
            <label className="field__label">Profile ID</label>
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
          </div>
        </div>
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
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void onSetActive(profile.id)}
            >
              Set Active
            </button>
          ) : (
            <span className="badge badge--success">✓ Active</span>
          )}
        </div>
      </div>

      {/* ── §3 Profile Facts ── */}
      <div className="section-group">
        <h2 className="section-title">Profile Facts</h2>
        <div className="form-grid">
          {/* Salary */}
          <div className="field">
            <label className="field__label" htmlFor="prof-salary-min">
              Salary Minimum
            </label>
            <input
              id="prof-salary-min"
              type="number"
              className="field__input"
              min={0}
              step={1000}
              value={facts.salaryMin}
              onChange={(e) => patchFact("salaryMin", e.target.value)}
              placeholder="e.g. 120000"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-currency">Currency</label>
            <select
              id="prof-currency"
              className="field__input"
              value={facts.salaryCurrency}
              onChange={(e) => patchFact("salaryCurrency", e.target.value)}
            >
              {["USD", "EUR", "BRL", "GBP", "CAD", "AUD"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-period">Period</label>
            <select
              id="prof-period"
              className="field__input"
              value={facts.salaryPeriod}
              onChange={(e) => patchFact("salaryPeriod", e.target.value)}
            >
              {["Annual", "Monthly", "Hourly"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {/* Work authorization */}
          <div className="field">
            <label className="field__label" htmlFor="prof-br-auth">
              Brazil Work Authorization
            </label>
            <select
              id="prof-br-auth"
              className="field__input"
              value={facts.brazilWorkAuth}
              onChange={(e) => patchFact("brazilWorkAuth", e.target.value)}
            >
              <option value="">— select —</option>
              <option value="citizen">Brazilian Citizen</option>
              <option value="permanent_resident">Permanent Resident</option>
              <option value="work_visa">Work Visa</option>
              <option value="not_authorized">Not Authorized</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-eu-auth">
              EU Work Authorization
            </label>
            <select
              id="prof-eu-auth"
              className="field__input"
              value={facts.euWorkAuth}
              onChange={(e) => patchFact("euWorkAuth", e.target.value)}
            >
              <option value="">— select —</option>
              <option value="eu_citizen">EU Citizen</option>
              <option value="eu_resident">EU Resident Permit</option>
              <option value="work_visa">Work Visa Required</option>
              <option value="not_authorized">Not Authorized</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-visa">
              Visa Sponsorship
            </label>
            <select
              id="prof-visa"
              className="field__input"
              value={facts.visaSponsorship}
              onChange={(e) => patchFact("visaSponsorship", e.target.value)}
            >
              <option value="">— select —</option>
              <option value="not_required">Not Required</option>
              <option value="required">Required</option>
              <option value="open">Open to Sponsorship</option>
            </select>
          </div>

          {/* Logistics */}
          <div className="field">
            <label className="field__label" htmlFor="prof-start">
              Available Start Date
            </label>
            <input
              id="prof-start"
              type="date"
              className="field__input"
              value={facts.startDate}
              onChange={(e) => patchFact("startDate", e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-relocation">Relocation</label>
            <select
              id="prof-relocation"
              className="field__input"
              value={facts.relocation}
              onChange={(e) => patchFact("relocation", e.target.value)}
            >
              <option value="">— select —</option>
              <option value="no">Not open to relocation</option>
              <option value="yes">Open to relocation</option>
              <option value="domestic">Domestic only</option>
              <option value="international">International</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-english">English Level</label>
            <select
              id="prof-english"
              className="field__input"
              value={facts.englishLevel}
              onChange={(e) => patchFact("englishLevel", e.target.value)}
            >
              <option value="">— select —</option>
              <option value="native">Native</option>
              <option value="fluent">Fluent</option>
              <option value="advanced">Advanced (C1)</option>
              <option value="upper_intermediate">Upper Intermediate (B2)</option>
              <option value="intermediate">Intermediate (B1)</option>
              <option value="basic">Basic</option>
            </select>
          </div>
        </div>
        <p
          style={{
            margin: "var(--sp-3) 0 0",
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
          }}
        >
          Facts are per-profile and used as answers during form automation. Persisted to
          backend once connection is wired.
        </p>
      </div>

      {/* ── §4 Links ── */}
      <div className="section-group">
        <h2 className="section-title">Links</h2>
        <div className="form-grid">
          <div className="field">
            <label className="field__label" htmlFor="prof-linkedin">LinkedIn</label>
            <input
              id="prof-linkedin"
              type="url"
              className="field__input"
              value={links.linkedin}
              onChange={(e) => patchLink("linkedin", e.target.value)}
              placeholder="https://linkedin.com/in/username"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-github">GitHub</label>
            <input
              id="prof-github"
              type="url"
              className="field__input"
              value={links.github}
              onChange={(e) => patchLink("github", e.target.value)}
              placeholder="https://github.com/username"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="prof-portfolio">Portfolio</label>
            <input
              id="prof-portfolio"
              type="url"
              className="field__input"
              value={links.portfolio}
              onChange={(e) => patchLink("portfolio", e.target.value)}
              placeholder="https://yoursite.com"
            />
          </div>
        </div>
      </div>

      {/* ── §5 Browser Session ── */}
      <div className="section-group">
        <h2 className="section-title">Browser Session</h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field__label">Browser Profile Folder</label>
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
            <span className="field__helper">
              Each profile has its own isolated browser session. The folder is
              deleted when the profile is deleted.
            </span>
          </div>
        </div>
      </div>

      {/* ── §6 Danger Zone ── */}
      <div className="danger-zone">
        <p className="danger-zone__title">Danger Zone</p>
        <p className="danger-zone__body">
          Deleting this profile permanently removes all associated database rows,
          copied CVs, evidence files, and the browser profile folder. This cannot
          be undone.
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setConfirmDelete(true)}
          >
            Delete Profile
          </button>
        ) : (
          <div
            style={{
              display: "flex",
              gap: "var(--sp-2)",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled
              aria-label="Confirm delete — backend connection required"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
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
