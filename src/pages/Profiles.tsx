import { useEffect, useState } from "react";
import { Tick01Icon } from "@hugeicons/core-free-icons";
import { safeInvoke, invokeStrict } from "../lib/tauriInvoke";
import { useProfileStore } from "../stores/useProfileStore";
import { Badge, Button, Dropdown, Field, FormRow, Icon, Input, Select } from "../components/ui";
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
  location: string;
  yearsExperience: string;
}

interface ProfileLinks {
  phone: string;
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
  location: "",
  yearsExperience: "",
};

const BLANK_LINKS: ProfileLinks = { phone: "", linkedin: "", github: "", portfolio: "" };

// The Profiles form is one flat key→value store (profile_facts). Facts + links
// live under the SAME keys the Easy Apply injector reads (see contact_fact_answers).
type FactMap = Record<string, string>;
function splitFacts(all: FactMap): { facts: ProfileFacts; links: ProfileLinks } {
  const g = (k: string, d = "") => all[k] ?? d;
  return {
    facts: {
      salaryMin: g("salaryMin"),
      salaryCurrency: g("salaryCurrency", "USD"),
      salaryPeriod: g("salaryPeriod", "Annual"),
      brazilWorkAuth: g("brazilWorkAuth"),
      euWorkAuth: g("euWorkAuth"),
      visaSponsorship: g("visaSponsorship"),
      startDate: g("startDate"),
      relocation: g("relocation"),
      englishLevel: g("englishLevel"),
      location: g("location"),
      yearsExperience: g("yearsExperience"),
    },
    links: {
      phone: g("phone"),
      linkedin: g("linkedin"),
      github: g("github"),
      portfolio: g("portfolio"),
    },
  };
}
// ---------------------------------------------------------------------------

export function Profiles() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const isLoading = useProfileStore((s) => s.isLoading);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);
  const setActive = useProfileStore((s) => s.setActiveProfile);
  const createProfile = useProfileStore((s) => s.createProfile);
  const renameProfile = useProfileStore((s) => s.renameProfile);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createProfile(`Profile ${profiles.length + 1}`);
      setSelectedId(id);
    } finally {
      setCreating(false);
    }
  };

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
          flexWrap: "wrap",
          gap: "var(--sp-3)",
          flexShrink: 0,
        }}
      >
        <h1 className="page-title">Profiles</h1>
        <span className="page-subtitle">
          {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
        </span>
        {profiles.length > 0 && (
          <Dropdown
            aria-label="Select profile"
            title="Profiles"
            value={selected?.id ?? ""}
            onChange={(id) => setSelectedId(id)}
            style={{ flex: "1 1 12rem", minWidth: 0 }}
            options={profiles.map((p) => ({
              value: p.id,
              label: p.id === activeProfileId ? `${p.name} (active)` : p.name,
            }))}
          />
        )}
        <div className="toolbar-spacer" />
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={creating}
        >
          {creating ? "Creating…" : "+ New Profile"}
        </Button>
      </div>

      {isLoading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p className="empty-state__title">Loading profiles...</p>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          {/* ── Profile detail (full-width; profile picked from the header dropdown) ── */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
                onRename={renameProfile}
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
  onRename,
}: {
  profile: Profile;
  activeProfileId: string | null;
  onSetActive: (id: string) => void | Promise<void>;
  onRename: (id: string, name: string) => void | Promise<void>;
}) {
  const [facts, setFacts] = useState<ProfileFacts>(BLANK_FACTS);
  const [links, setLinks] = useState<ProfileLinks>(BLANK_LINKS);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(profile.name);
  const [savingName, setSavingName] = useState(false);
  const [savingFacts, setSavingFacts] = useState(false);
  const [factsMsg, setFactsMsg] = useState<string | null>(null);

  // Load this profile's saved identity facts + links.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = await safeInvoke<FactMap>("get_profile_facts", { profileId: profile.id });
      if (cancelled) return;
      const split = splitFacts(all ?? {});
      setFacts(split.facts);
      setLinks(split.links);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  function patchFact<K extends keyof ProfileFacts>(k: K, v: ProfileFacts[K]) {
    setFacts((prev) => ({ ...prev, [k]: v }));
  }
  function patchLink<K extends keyof ProfileLinks>(k: K, v: string) {
    setLinks((prev) => ({ ...prev, [k]: v }));
  }

  async function saveFacts() {
    if (savingFacts) return;
    setSavingFacts(true);
    setFactsMsg(null);
    try {
      // One flat map — same keys the Easy Apply injector reads.
      await invokeStrict("save_profile_facts", {
        profileId: profile.id,
        facts: { ...facts, ...links },
      });
      setFactsMsg("Saved.");
    } catch (e) {
      setFactsMsg(String(e));
    } finally {
      setSavingFacts(false);
    }
  }

  return (
    <>
      {/* ── §1 Identity ── */}
      <div className="section-group">
        <h2 className="section-title">Identity</h2>
        <FormRow>
          <Field label="Name" htmlFor="prof-name" helper="Rename this profile.">
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <Input
                id="prof-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                size="sm"
                disabled={savingName || !name.trim() || name.trim() === profile.name}
                onClick={() => {
                  void (async () => {
                    setSavingName(true);
                    try {
                      await onRename(profile.id, name.trim());
                    } finally {
                      setSavingName(false);
                    }
                  })();
                }}
              >
                {savingName ? "Saving…" : "Save"}
              </Button>
            </div>
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

        {/* Location + experience — fill "current location" and years-of-experience
            / skill questions during Easy Apply. */}
        <FormRow cols={3}>
          <Field label="Location (city)" htmlFor="prof-location">
            <Input
              id="prof-location"
              placeholder="e.g. Rio de Janeiro, Brazil"
              value={facts.location}
              onChange={(e) => patchFact("location", e.target.value)}
            />
          </Field>
          <Field label="Years of experience" htmlFor="prof-years">
            <Input
              id="prof-years"
              type="number"
              min="0"
              placeholder="e.g. 2"
              value={facts.yearsExperience}
              onChange={(e) => patchFact("yearsExperience", e.target.value)}
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
          Facts are per-profile and used as answers during Easy Apply automation (phone, salary,
          links fill the form). Click Save below to persist.
        </p>
      </div>

      {/* ── §4 Links ── */}
      <div className="section-group">
        <h2 className="section-title">Links &amp; Contact</h2>
        <FormRow cols={3}>
          <Field
            label="Phone"
            htmlFor="prof-phone"
            helper="Used to fill the Easy Apply contact page."
          >
            <Input
              id="prof-phone"
              type="tel"
              value={links.phone}
              onChange={(e) => patchLink("phone", e.target.value)}
              placeholder="+55 21 91234-5678"
            />
          </Field>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            marginTop: "var(--sp-3)",
          }}
        >
          <Button size="sm" disabled={savingFacts} onClick={() => void saveFacts()}>
            {savingFacts ? "Saving…" : "Save facts & links"}
          </Button>
          {factsMsg && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              {factsMsg}
            </span>
          )}
        </div>
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
