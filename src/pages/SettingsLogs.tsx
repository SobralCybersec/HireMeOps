import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useThemeStore } from "../stores/useThemeStore";
import { useEventStore } from "../stores/useEventStore";
import {
  Button,
  EmptyState,
  KpiCard,
  Toolbar,
  ToolbarSep,
} from "../components/ui";
import type {
  ThemeMode,
  ReducedEffectsMode,
  AiProviderSettings,
} from "../types/settings";
import { AiProviderForm } from "./settings/AiProviderForm";
import { BackupRestorePanel } from "./settings/BackupRestorePanel";
import { DataCleanupPanel } from "./settings/DataCleanupPanel";

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

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "theme", label: "Theme & Effects" },
  { key: "ai", label: "AI Providers" },
  { key: "browser", label: "Browser" },
  { key: "data", label: "Data Storage" },
  { key: "exports", label: "Exports" },
  { key: "backups", label: "Backups" },
  { key: "cleanup", label: "Cleanup" },
  { key: "auditlogs", label: "Audit Logs" },
  { key: "evidence", label: "Evidence" },
];

// ── Theme option tables ────────────────────────────────────────────────────
const THEME_OPTS: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System (follow OS)" },
];

const REDUCED_OPTS: { value: ReducedEffectsMode; label: string }[] = [
  { value: "auto", label: "Auto — follow OS prefers-reduced-motion" },
  { value: "off", label: "Off — allow all transitions" },
  { value: "on", label: "On — disable all transitions" },
];

// ── AI provider helpers ────────────────────────────────────────────────────
const PROVIDER_KINDS: AiProviderSettings["kind"][] = [
  "openai",
  "anthropic",
  "ollama",
  "custom",
];

const PROVIDER_DEFAULTS: Record<
  AiProviderSettings["kind"],
  AiProviderSettings
> = {
  openai: {
    kind: "openai",
    label: "OpenAI",
    endpointUrl: "",
    apiKeyStored: false,
    defaultModel: "",
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic",
    endpointUrl: "",
    apiKeyStored: false,
    defaultModel: "",
  },
  ollama: {
    kind: "ollama",
    label: "Ollama",
    endpointUrl: "http://localhost:11434",
    apiKeyStored: false,
    defaultModel: "",
  },
  custom: {
    kind: "custom",
    label: "Custom proxy",
    endpointUrl: "",
    apiKeyStored: false,
    defaultModel: "",
  },
};

/** Return the configured provider of `kind`, or a blank default. */
function resolveProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"]
): AiProviderSettings {
  return providers.find((p) => p.kind === kind) ?? { ...PROVIDER_DEFAULTS[kind] };
}

/** Return a new array with `kind` updated (or appended if missing). */
function upsertProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
  patch: Partial<Omit<AiProviderSettings, "kind">>
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

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // ── AI provider helpers ──────────────────────────────────────────────────
  const providers = settings?.aiProviders ?? [];
  const defaultProviderIdx = settings?.defaultAiProviderIndex ?? 0;

  function handleProviderUpdate(
    kind: AiProviderSettings["kind"],
    patch: Partial<Omit<AiProviderSettings, "kind">>
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
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div
          className="settings-sidebar"
          role="tablist"
          aria-label="Settings sections"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeTab === t.key}
              className={
                activeTab === t.key
                  ? "settings-tab-btn active"
                  : "settings-tab-btn"
              }
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <div className="settings-content" role="tabpanel">
          {isLoading && needsSettings ? (
            <div className="empty-state">
              <p className="empty-state__title">Loading settings…</p>
            </div>
          ) : (
            <>
              {/* ════ GENERAL ═══════════════════════════════════════════ */}
              {activeTab === "general" && (
                <div className="section-group">
                  <h2 className="section-title">General</h2>

                  <div className="form-grid">
                    {/* Active profile (read-only; managed on Profiles page) */}
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <span className="field__label">Active profile</span>
                      <code
                        className="code"
                        style={{
                          display: "block",
                          padding: "var(--sp-2) var(--sp-3)",
                          borderRadius: "var(--radius)",
                          fontSize: "var(--text-xs)",
                          color: settings?.activeProfileId
                            ? "var(--color-text)"
                            : "var(--color-text-muted)",
                        }}
                      >
                        {settings?.activeProfileId ?? "No profile selected"}
                      </code>
                      <span className="field__helper">
                        Switch the active profile on the Profiles page.
                      </span>
                    </div>

                    {/* App language */}
                    <div className="field">
                      <label className="field__label" htmlFor="app-lang">
                        App language
                      </label>
                      <select
                        id="app-lang"
                        className="field__select"
                        value={settings?.appLanguage ?? "en"}
                        onChange={(e) =>
                          void updateSettings({ appLanguage: e.target.value })
                        }
                      >
                        <option value="en">English</option>
                        <option value="de">Deutsch</option>
                        <option value="fi">Suomi</option>
                      </select>
                    </div>

                    {/* Startup behavior */}
                    <div className="field">
                      <label
                        className="field__label"
                        htmlFor="startup-behavior"
                      >
                        Startup behavior
                      </label>
                      <select
                        id="startup-behavior"
                        className="field__select"
                        value={settings?.startupBehavior ?? "normal"}
                        onChange={(e) =>
                          void updateSettings({
                            startupBehavior: e.target.value as
                              | "normal"
                              | "minimized"
                              | "tray",
                          })
                        }
                      >
                        <option value="normal">Normal window</option>
                        <option value="minimized">Start minimized</option>
                        <option value="tray">Start in system tray</option>
                      </select>
                    </div>
                  </div>

                  {/* Portable mode */}
                  <div style={{ marginTop: "var(--sp-4)" }}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={settings?.portableMode ?? false}
                        onChange={(e) =>
                          void updateSettings({ portableMode: e.target.checked })
                        }
                      />
                      Portable mode — store all data next to the executable
                    </label>
                  </div>
                </div>
              )}

              {/* ════ THEME & EFFECTS ════════════════════════════════════ */}
              {activeTab === "theme" && (
                <>
                  <div className="section-group">
                    <h2 className="section-title">Color theme</h2>
                    <div className="check-group">
                      {THEME_OPTS.map((opt) => (
                        <label key={opt.value} className="check-label">
                          <input
                            type="radio"
                            name="theme-mode"
                            value={opt.value}
                            checked={theme === opt.value}
                            onChange={() => setTheme(opt.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="section-group">
                    <h2 className="section-title">Motion &amp; effects</h2>
                    <div className="check-group">
                      {REDUCED_OPTS.map((opt) => (
                        <label key={opt.value} className="check-label">
                          <input
                            type="radio"
                            name="reduced-effects"
                            value={opt.value}
                            checked={reducedEffects === opt.value}
                            onChange={() => setReducedEffects(opt.value)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        marginTop: "var(--sp-3)",
                        fontSize: "var(--text-xs)",
                        color: "var(--color-text-muted)",
                        lineHeight: 1.5,
                      }}
                    >
                      When enabled, adds{" "}
                      <code className="code">reduced-effects</code> to{" "}
                      <code className="code">&lt;html&gt;</code>, suppressing
                      all CSS transitions and animations project-wide.
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
                    Configure one or more provider endpoints. The default
                    provider is used for CV analysis, job matching, and cover
                    letter generation.
                  </p>
                  {PROVIDER_KINDS.map((kind) => {
                    const providerIdx = providers.findIndex(
                      (p) => p.kind === kind
                    );
                    const isDefault =
                      providerIdx !== -1 &&
                      providerIdx === defaultProviderIdx;
                    return (
                      <AiProviderForm
                        key={kind}
                        kind={kind}
                        value={resolveProvider(providers, kind)}
                        isDefault={isDefault}
                        onUpdate={(patch) =>
                          handleProviderUpdate(kind, patch)
                        }
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
                    Engine: Playwright Chromium (bundled). Each HireMeOps
                    profile keeps its own browser profile in the path below,
                    preserving login sessions independently.
                  </p>

                  <div className="form-grid">
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label
                        className="field__label"
                        htmlFor="browser-root"
                      >
                        Browser profile root path
                      </label>
                      <input
                        id="browser-root"
                        type="text"
                        className="field__input"
                        value={settings?.browserProfileRootPath ?? ""}
                        readOnly
                        aria-readonly="true"
                        placeholder="Set by backend on first launch"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--text-xs)",
                          opacity: 0.7,
                          cursor: "not-allowed",
                        }}
                        onChange={() => {
                          /* read-only; path set by backend */
                        }}
                      />
                      <span className="field__helper">
                        Path is managed by the backend. One sub-folder per
                        profile.
                      </span>
                    </div>
                  </div>

                  <div style={{ marginTop: "var(--sp-3)" }}>
                    <Toolbar aria-label="Browser session actions">
                      <Button
                        variant="ghost"
                        disabled
                        aria-label="Check LinkedIn session health"
                      >
                        Check LinkedIn session
                      </Button>
                      <Button
                        variant="ghost"
                        disabled
                        aria-label="Open manual login setup"
                      >
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
                </div>
              )}

              {/* ════ DATA STORAGE ═══════════════════════════════════════ */}
              {activeTab === "data" && (
                <div className="section-group">
                  <h2 className="section-title">Data Storage</h2>

                  <div
                    className="stat-grid"
                    style={{ marginBottom: "var(--sp-4)" }}
                  >
                    <KpiCard
                      label="Profiles"
                      value="–"
                      meta="backend not connected"
                    />
                    <KpiCard
                      label="Jobs"
                      value="–"
                      meta="backend not connected"
                    />
                    <KpiCard
                      label="Applications"
                      value="–"
                      meta="backend not connected"
                    />
                    <KpiCard
                      label="DB size"
                      value="–"
                      meta="backend not connected"
                    />
                  </div>

                  <div className="form-grid">
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <span className="field__label">Database path</span>
                      <code
                        className="code"
                        style={{
                          display: "block",
                          padding: "var(--sp-2) var(--sp-3)",
                          borderRadius: "var(--radius)",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        {settings?.databasePath || "–"}
                      </code>
                    </div>
                  </div>

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
                    Export your data as files. Available once backend export
                    commands are wired.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(200px, 1fr))",
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
                        <Button variant="ghost" size="sm" disabled>
                          Export
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
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(160px, 1fr))",
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

                  {events.length === 0 ? (
                    <EmptyState
                      label="Audit logs"
                      title="No events this session"
                      body="Events are written here as automation runs, job searches, and CV analysis complete. Persistent logs (30-day retention) are stored in the database."
                    />
                  ) : (
                    <div className="table-wrapper">
                      <table
                        className="data-table"
                        aria-label="Session audit log"
                      >
                        <thead>
                          <tr>
                            <th scope="col" style={{ width: "8rem" }}>
                              Time
                            </th>
                            <th scope="col">Event type</th>
                            <th scope="col" style={{ width: "5rem" }}>
                              Profile
                            </th>
                            <th
                              scope="col"
                              style={{ width: "6rem" }}
                              className="cell-mono"
                            >
                              ID
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {events.map((e) => (
                            <tr key={e.id}>
                              <td className="cell-mono">
                                <time dateTime={e.createdAt}>
                                  {new Date(
                                    e.createdAt
                                  ).toLocaleTimeString()}
                                </time>
                              </td>
                              <td className="cell-primary">{e.type}</td>
                              <td
                                className="cell-mono"
                                style={{
                                  color: "var(--color-text-muted)",
                                  fontSize: "var(--text-xs)",
                                }}
                              >
                                {e.profileId
                                  ? e.profileId.slice(0, 6)
                                  : "–"}
                              </td>
                              <td
                                className="cell-mono"
                                style={{
                                  color: "var(--color-text-muted)",
                                  fontSize: "var(--text-xs)",
                                }}
                              >
                                {e.id.slice(0, 8)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ════ EVIDENCE ═══════════════════════════════════════════ */}
              {activeTab === "evidence" && (
                <div className="section-group">
                  <h2 className="section-title">Automation Evidence</h2>
                  <EmptyState
                    label="Evidence"
                    title="No evidence files"
                    body="Screenshots, DOM snapshots, and form-fill evidence are stored here during automation runs. Evidence retention defaults to 1 day — configure in Cleanup."
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
