import React, { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useThemeStore } from "../stores/useThemeStore";
import { useEventStore } from "../stores/useEventStore";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FormRow,
  Icon,
  Input,
  KpiCard,
  RadioGroup,
  Select,
  Switch,
  Toolbar,
  ToolbarSep,
} from "../components/ui";
import type { Column } from "../components/ui";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import type { ThemeMode, ReducedEffectsMode, AiProviderSettings } from "../types/settings";
import type { AppEvent } from "../types/events";
import { errMessage, invokeStrict } from "../lib/tauriInvoke";
import { AiProviderForm } from "./settings/AiProviderForm";
import { ProviderIcon } from "./settings/ProviderIcon";
import { isProviderConfigured } from "./settings/providerMeta";
import { BackupRestorePanel } from "./settings/BackupRestorePanel";
import { DataCleanupPanel } from "./settings/DataCleanupPanel";
import { BrowserExtensionsPanel } from "./settings/BrowserExtensionsPanel";

// ── Tab catalogue ──────────────────────────────────────────────────────────
type Tab =
  | "general"
  | "theme"
  | "ai"
  | "browser"
  | "data"
  | "exports"
  | "backups"
  | "cleanup"
  | "auditlogs"
  | "evidence";

interface TabGroup {
  label: string;
  tabs: { key: Tab; label: string }[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: "Preferences",
    tabs: [
      { key: "general", label: "General" },
      { key: "theme", label: "Theme & Effects" },
    ],
  },
  {
    label: "Integrations",
    tabs: [
      { key: "ai", label: "AI Providers" },
      { key: "browser", label: "Browser" },
    ],
  },
  {
    label: "Data",
    tabs: [
      { key: "data", label: "Data Storage" },
      { key: "exports", label: "Exports" },
      { key: "backups", label: "Backups" },
      { key: "cleanup", label: "Cleanup" },
    ],
  },
  {
    label: "Diagnostics",
    tabs: [
      { key: "auditlogs", label: "Audit Logs" },
      { key: "evidence", label: "Evidence" },
    ],
  },
];

// Flat list for keyboard nav index calculations
const TABS = TAB_GROUPS.flatMap((g) => g.tabs);

// ── Theme option tables ────────────────────────────────────────────────────
const THEME_OPTS: { value: string; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System (follow OS)" },
  { value: "red", label: "Crimson - dark with red accent" },
  { value: "solo-leveling", label: "Solo Leveling - anime system UI" },
];

const REDUCED_OPTS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto - follow OS prefers-reduced-motion" },
  { value: "off", label: "Off - allow all transitions" },
  { value: "on", label: "On - disable all transitions" },
];

// ── Audit log columns (DataTable) ─────────────────────────────────────────
const AUDIT_COLUMNS: Column<AppEvent>[] = [
  {
    key: "createdAt",
    header: "Time",
    width: "8rem",
    mono: true,
    render: (e) => <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleTimeString()}</time>,
  },
  {
    key: "type",
    header: "Event type",
    primary: true,
    render: (e) => e.type,
  },
  {
    key: "profileId",
    header: "Profile",
    width: "5rem",
    mono: true,
    render: (e) => (
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        {e.profileId ? e.profileId.slice(0, 6) : "-"}
      </span>
    ),
  },
  {
    key: "id",
    header: "ID",
    width: "6rem",
    mono: true,
    render: (e) => (
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--text-xs)" }}>
        {e.id.slice(0, 8)}
      </span>
    ),
  },
];

// ── AI provider helpers ────────────────────────────────────────────────────
const PROVIDER_KINDS: AiProviderSettings["kind"][] = ["browser"];

const PROVIDER_DEFAULTS: Record<AiProviderSettings["kind"], AiProviderSettings> = {
  browser: {
    kind: "browser",
    label: "Browser (free)",
    // No endpoint or API key: the target site + optional model live in
    // defaultModel as "<site>/<model>". Starts empty → "Not configured"
    // until the user picks a site in BrowserProviderPanel.
    endpointUrl: "",
    apiKeyStored: false,
    authKind: "api_key",
    defaultModel: "",
  },
};

/** Return the configured provider of `kind`, or a blank default. */
function resolveProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
): AiProviderSettings {
  return providers.find((p) => p.kind === kind) ?? { ...PROVIDER_DEFAULTS[kind] };
}

/** Return a new array with `kind` updated (or appended if missing). */
function upsertProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
  patch: Partial<Omit<AiProviderSettings, "kind">>,
): AiProviderSettings[] {
  const idx = providers.findIndex((p) => p.kind === kind);
  if (idx === -1) {
    return [...providers, { ...PROVIDER_DEFAULTS[kind], ...patch }];
  }
  const next = [...providers];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

// ── Export catalogue ───────────────────────────────────────────────────────
const EXPORTS = [
  {
    key: "profiles",
    label: "Export profiles JSON",
    body: "All profile configs and CV references",
  },
  {
    key: "jobs",
    label: "Export jobs CSV",
    body: "Job listings, match scores, and statuses",
  },
  {
    key: "applications",
    label: "Export applications CSV",
    body: "Application history, outcomes, and retry counts",
  },
  {
    key: "audit",
    label: "Export audit CSV",
    body: "Full audit log with timestamps and event types",
  },
] as const;

// ── Component ──────────────────────────────────────────────────────────────
export function SettingsLogs() {
  // Settings store
  const settings = useSettingsStore((s) => s.settings);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // Theme store
  const theme = useThemeStore((s) => s.theme);
  const reducedEffects = useThemeStore((s) => s.reducedEffects);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setReducedEffects = useThemeStore((s) => s.setReducedEffects);

  // Event store (audit log)
  const events = useEventStore((s) => s.events);

  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // ── AI provider helpers ──────────────────────────────────────────────────
  // Only the browser provider kind is supported now. Drop any persisted legacy
  // cloud/API provider entries so they are never re-emitted to the backend
  // (which rejects every non-`browser` kind). The next settings write persists
  // the sanitized, browser-only array.
  const providers = (settings?.aiProviders ?? []).filter((p) => p.kind === "browser");
  // With a browser-only list the default is always index 0 (or none yet).
  const defaultProviderIdx = 0;

  function handleProviderUpdate(
    kind: AiProviderSettings["kind"],
    patch: Partial<Omit<AiProviderSettings, "kind">>,
  ) {
    if (!settings) return;
    void updateSettings({ aiProviders: upsertProvider(providers, kind, patch) });
  }

  function handleSetDefaultProvider(kind: AiProviderSettings["kind"]) {
    if (!settings) return;
    const next = upsertProvider(providers, kind, {});
    const idx = next.findIndex((p) => p.kind === kind);
    void updateSettings({
      aiProviders: next,
      defaultAiProviderIndex: idx === -1 ? 0 : idx,
    });
  }

  // Keyboard nav for the vertical settings tablist (ArrowUp/Down + Home/End).
  function handleTabKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else next = TABS.length - 1;
    setActiveTab(TABS[next].key);
    document.getElementById(`settings-tab-${TABS[next].key}`)?.focus();
  }

  // ── Export helpers ───────────────────────────────────────────────────────
  function downloadString(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExport(key: (typeof EXPORTS)[number]["key"]) {
    setExportingKey(key);
    setExportError(null);
    try {
      const commands = {
        profiles: () => invokeStrict<string>("export_profiles_json"),
        jobs: () => invokeStrict<string>("export_jobs_csv"),
        applications: () => invokeStrict<string>("export_applications_csv"),
        audit: () => invokeStrict<string>("export_audit_csv"),
      } as const;
      const content = await commands[key]();
      const isJson = key === "profiles";
      downloadString(
        content,
        `hiremeops-${key}.${isJson ? "json" : "csv"}`,
        isJson ? "application/json" : "text/csv",
      );
    } catch (e) {
      setExportError(`Export failed: ${errMessage(e)}`);
    } finally {
      setExportingKey(null);
    }
  }

  // Tabs that need settings from the backend to render meaningfully
  const needsSettings =
    activeTab === "general" ||
    activeTab === "ai" ||
    activeTab === "browser" ||
    activeTab === "data" ||
    activeTab === "exports" ||
    activeTab === "backups" ||
    activeTab === "cleanup";

  return (
    <div className="page page--fill" style={{ padding: 0 }}>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "var(--sp-4)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          flexShrink: 0,
        }}
      >
        <h1 className="page-title">Settings &amp; Logs</h1>
      </div>

      {/* ── Settings layout ─────────────────────────────────────────────── */}
      <div
        className="settings-layout"
        style={{
          borderRadius: 0,
          borderLeft: "none",
          borderRight: "none",
          borderBottom: "none",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ── Sidebar (grouped navigation rail) ────────────────────── */}
        <div
          className="settings-sidebar"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          {TAB_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && (
                <div
                  style={{
                    height: 1,
                    background: "var(--color-border)",
                    margin: "var(--sp-2) var(--sp-3)",
                  }}
                  role="separator"
                  aria-hidden="true"
                />
              )}
              <div
                style={{
                  padding: "var(--sp-2) var(--sp-3) var(--sp-1)",
                  fontSize: "var(--text-2xs)",
                  fontWeight: "var(--fw-semibold)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-text-muted)",
                  userSelect: "none",
                }}
              >
                {group.label}
              </div>
              {group.tabs.map((t) => {
                const flatIdx = TABS.findIndex((ft) => ft.key === t.key);
                return (
                  <button
                    key={t.key}
                    id={`settings-tab-${t.key}`}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === t.key}
                    aria-controls="settings-panel"
                    tabIndex={activeTab === t.key ? 0 : -1}
                    className={activeTab === t.key ? "settings-tab-btn active" : "settings-tab-btn"}
                    onClick={() => setActiveTab(t.key)}
                    onKeyDown={(e) => handleTabKey(e, flatIdx)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <div
          id="settings-panel"
          className="settings-content"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
        >
          {isLoading && needsSettings ? (
            <div className="empty-state">
              <p className="empty-state__title">Loading settings...</p>
            </div>
          ) : (
            <>
              {/* ════ GENERAL ═══════════════════════════════════════════ */}
              {activeTab === "general" && (
                <div className="section-group">
                  <h2 className="section-title">General</h2>

                  {/* Active profile (read-only; managed on Profiles page) */}
                  <Field
                    label="Active profile"
                    helper="Switch the active profile on the Profiles page."
                  >
                    <code
                      className="code"
                      style={{
                        display: "block",
                        padding: "var(--sp-2) var(--sp-3)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      {settings?.activeProfileId ?? "No profile selected"}
                    </code>
                  </Field>

                  <FormRow>
                    <Field label="App language" htmlFor="app-lang">
                      <Select
                        id="app-lang"
                        value={settings?.appLanguage ?? "en"}
                        options={[
                          { value: "en", label: "English" },
                          { value: "de", label: "Deutsch" },
                          { value: "fi", label: "Suomi" },
                        ]}
                        onChange={(e) => void updateSettings({ appLanguage: e.target.value })}
                      />
                    </Field>

                    <Field label="Startup behavior" htmlFor="startup-behavior">
                      <Select
                        id="startup-behavior"
                        value={settings?.startupBehavior ?? "normal"}
                        options={[
                          { value: "normal", label: "Normal window" },
                          { value: "minimized", label: "Start minimized" },
                          { value: "tray", label: "Start in system tray" },
                        ]}
                        onChange={(e) =>
                          void updateSettings({
                            startupBehavior: e.target.value as "normal" | "minimized" | "tray",
                          })
                        }
                      />
                    </Field>
                  </FormRow>

                  {/* Portable mode */}
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <Switch
                      checked={settings?.portableMode ?? false}
                      onChange={(checked) => void updateSettings({ portableMode: checked })}
                    >
                      Portable mode - store all data next to the executable
                    </Switch>
                  </div>
                </div>
              )}

              {/* ════ THEME & EFFECTS ════════════════════════════════════ */}
              {activeTab === "theme" && (
                <>
                  <div className="section-group">
                    <h2 className="section-title">Color theme</h2>
                    <RadioGroup
                      name="theme-mode"
                      value={theme}
                      options={THEME_OPTS}
                      onChange={(v) => setTheme(v as ThemeMode)}
                      label="Color theme"
                    />
                  </div>

                  <div className="section-group">
                    <h2 className="section-title">Motion and effects</h2>
                    <RadioGroup
                      name="reduced-effects"
                      value={reducedEffects}
                      options={REDUCED_OPTS}
                      onChange={(v) => setReducedEffects(v as ReducedEffectsMode)}
                      label="Motion and effects"
                    />
                    <p
                      style={{
                        margin: 0,
                        marginTop: "var(--sp-3)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-muted)",
                        lineHeight: 1.5,
                      }}
                    >
                      When enabled, adds <code className="code">reduced-effects</code> to{" "}
                      <code className="code">&lt;html&gt;</code>, suppressing all CSS transitions
                      and animations project-wide.
                    </p>
                  </div>
                </>
              )}

              {/* ════ AI PROVIDERS ═══════════════════════════════════════ */}
              {activeTab === "ai" && (
                <div className="section-group">
                  <h2 className="section-title">AI Providers</h2>
                  <p
                    style={{
                      margin: 0,
                      marginBottom: "var(--sp-4)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Configure one or more provider endpoints, then pick the active one below. The
                    default provider is used for CV analysis, job matching, and cover letter
                    generation.
                  </p>

                  <div
                    className="ai-provider-picker"
                    role="radiogroup"
                    aria-label="Default AI provider"
                  >
                    {PROVIDER_KINDS.map((kind) => {
                      const provider = resolveProvider(providers, kind);
                      const configured = isProviderConfigured(provider);
                      const selected = providers[defaultProviderIdx]?.kind === kind;
                      return (
                        <button
                          key={kind}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`ai-provider-picker__item${selected ? " is-selected" : ""}`}
                          onClick={() => handleSetDefaultProvider(kind)}
                        >
                          <ProviderIcon kind={kind} size={20} />
                          <span className="ai-provider-picker__label">
                            {PROVIDER_DEFAULTS[kind].label}
                          </span>
                          <span
                            className={`ai-provider-picker__dot${
                              configured ? " is-configured" : ""
                            }`}
                            aria-hidden="true"
                          />
                          {selected && <Icon icon={CheckmarkCircle02Icon} size={14} />}
                        </button>
                      );
                    })}
                  </div>

                  {PROVIDER_KINDS.map((kind) => {
                    const providerIdx = providers.findIndex((p) => p.kind === kind);
                    const isDefault = providerIdx !== -1 && providerIdx === defaultProviderIdx;
                    return (
                      <AiProviderForm
                        key={kind}
                        kind={kind}
                        value={resolveProvider(providers, kind)}
                        isDefault={isDefault}
                        onUpdate={(patch) => handleProviderUpdate(kind, patch)}
                        onSetDefault={() => handleSetDefaultProvider(kind)}
                      />
                    );
                  })}
                </div>
              )}

              {/* ════ BROWSER ════════════════════════════════════════════ */}
              {activeTab === "browser" && (
                <div className="section-group">
                  <h2 className="section-title">Browser</h2>
                  <p
                    style={{
                      margin: 0,
                      marginBottom: "var(--sp-4)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    Engine: Playwright Chromium (bundled). Each HireMeOps profile keeps its own
                    browser profile in the path below, preserving login sessions independently.
                  </p>

                  <Field
                    label="Browser profile root path"
                    htmlFor="browser-root"
                    helper="Path is managed by the backend. One sub-folder per profile."
                  >
                    <Input
                      id="browser-root"
                      type="text"
                      value={settings?.browserProfileRootPath ?? ""}
                      readOnly
                      aria-readonly="true"
                      placeholder="Set by backend on first launch"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--text-xs)",
                      }}
                      onChange={() => {
                        /* read-only; path set by backend */
                      }}
                    />
                  </Field>

                  <div style={{ marginTop: "var(--sp-3)" }}>
                    <Toolbar aria-label="Browser session actions">
                      <Button variant="ghost" disabled aria-label="Check LinkedIn session health">
                        Check LinkedIn session
                      </Button>
                      <Button variant="ghost" disabled aria-label="Open manual login setup">
                        Manual login setup
                      </Button>
                      <ToolbarSep />
                      <Button
                        variant="danger"
                        size="sm"
                        disabled
                        aria-label="Clear browser session data"
                      >
                        Clear session
                      </Button>
                    </Toolbar>
                  </div>

                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <h2 className="section-title">Extensions</h2>
                    <BrowserExtensionsPanel />
                  </div>
                </div>
              )}

              {/* ════ DATA STORAGE ═══════════════════════════════════════ */}
              {activeTab === "data" && (
                <div className="section-group">
                  <h2 className="section-title">Data Storage</h2>

                  <div className="stat-grid" style={{ marginBottom: "var(--sp-4)" }}>
                    <KpiCard label="Profiles" value="-" meta="backend not connected" />
                    <KpiCard label="Jobs" value="-" meta="backend not connected" />
                    <KpiCard label="Applications" value="-" meta="backend not connected" />
                    <KpiCard label="DB size" value="-" meta="backend not connected" />
                  </div>

                  <Field label="Database path">
                    <code
                      className="code"
                      style={{
                        display: "block",
                        padding: "var(--sp-2) var(--sp-3)",
                        borderRadius: "var(--radius)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      {settings?.databasePath || "-"}
                    </code>
                  </Field>

                  <div style={{ marginTop: "var(--sp-3)" }}>
                    <Button variant="ghost" disabled>
                      Open data folder
                    </Button>
                  </div>
                </div>
              )}

              {/* ════ EXPORTS ════════════════════════════════════════════ */}
              {activeTab === "exports" && (
                <div className="section-group">
                  <h2 className="section-title">Exports</h2>
                  <p
                    style={{
                      margin: 0,
                      marginBottom: "var(--sp-4)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    Export your data as files. Each export downloads to your default Downloads
                    folder.
                  </p>

                  {exportError && (
                    <p
                      style={{
                        margin: 0,
                        marginBottom: "var(--sp-3)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-danger)",
                      }}
                    >
                      {exportError}
                    </p>
                  )}

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: "var(--sp-3)",
                    }}
                  >
                    {EXPORTS.map((ex) => (
                      <div
                        key={ex.key}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "var(--sp-2)",
                          padding: "var(--sp-3) var(--sp-4)",
                          background: "var(--color-surface-2)",
                          border: "1px solid var(--color-border)",
                          borderRadius: "var(--radius-md)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "var(--text-sm)",
                            fontWeight: "var(--fw-medium)",
                            color: "var(--color-text)",
                          }}
                        >
                          {ex.label}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            fontSize: "var(--text-xs)",
                            color: "var(--color-text-muted)",
                          }}
                        >
                          {ex.body}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={exportingKey !== null}
                          onClick={() => void handleExport(ex.key)}
                        >
                          {exportingKey === ex.key ? "Exporting..." : "Export"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ════ BACKUPS ════════════════════════════════════════════ */}
              {activeTab === "backups" && (
                <div className="section-group">
                  <h2 className="section-title">Backups</h2>
                  <BackupRestorePanel />
                </div>
              )}

              {/* ════ CLEANUP ════════════════════════════════════════════ */}
              {activeTab === "cleanup" && (
                <div className="section-group">
                  <h2 className="section-title">Cleanup</h2>

                  {/* Retention defaults reference */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: "var(--sp-2)",
                      marginBottom: "var(--sp-4)",
                      padding: "var(--sp-3) var(--sp-4)",
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                    }}
                  >
                    {[
                      {
                        label: "Audit logs",
                        value: `${settings?.auditLogRetentionDays ?? 30} days`,
                      },
                      {
                        label: "Evidence",
                        value: `${settings?.automationEvidenceRetentionDays ?? 1} day`,
                      },
                      { label: "AI cache", value: "Manual clear" },
                      { label: "Artifacts", value: "Manual clear" },
                    ].map((row) => (
                      <div key={row.label}>
                        <div
                          style={{
                            fontSize: "var(--text-2xs)",
                            color: "var(--color-text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "var(--sp-1)",
                          }}
                        >
                          {row.label}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "var(--text-xs)",
                            color: "var(--color-accent-text)",
                          }}
                        >
                          {row.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <DataCleanupPanel />
                </div>
              )}

              {/* ════ AUDIT LOGS ═════════════════════════════════════════ */}
              {activeTab === "auditlogs" && (
                <div className="section-group">
                  <h2 className="section-title">
                    Audit Logs
                    <span
                      style={{
                        marginLeft: "var(--sp-2)",
                        fontSize: "var(--text-xs)",
                        fontWeight: "var(--fw-regular)",
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {events.length} session events
                    </span>
                  </h2>

                  <DataTable
                    columns={AUDIT_COLUMNS}
                    rows={events}
                    getRowKey={(e) => e.id}
                    empty={
                      <EmptyState
                        label="Audit logs"
                        title="No events this session"
                        body="Events are written here as automation runs, job searches, and CV analysis complete. Persistent logs (30-day retention) are stored in the database."
                      />
                    }
                  />
                </div>
              )}

              {/* ════ EVIDENCE ═══════════════════════════════════════════ */}
              {activeTab === "evidence" && (
                <div className="section-group">
                  <h2 className="section-title">Automation Evidence</h2>
                  <EmptyState
                    label="Evidence"
                    title="No evidence files"
                    body="Screenshots, DOM snapshots, and form-fill evidence are stored here during automation runs. Evidence retention defaults to 1 day. Configure in Cleanup."
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
