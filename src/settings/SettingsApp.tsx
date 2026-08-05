/**
 * SettingsApp — standalone settings window shell.
 *
 * Shell replicates terax-ai's SettingsApp:
 *   full-height column
 *   → 44 px drag-region header (icon + mono title + WindowControls)
 *   → flex row: 192 px left nav rail + scrolling content area (max-w-[1280px])
 *
 * Tabs mirror SettingsLogs.tsx exactly: general / effects / ai / browser /
 * data / exports / backups / cleanup. All store hooks and invokeStrict calls
 * are identical to the original page.
 *
 * Heavy sub-panels (AiProviderForm, BrowserExtensionsPanel, BackupRestorePanel,
 * DataCleanupPanel, DockerStatusPanel) are reused inside shadcn wrappers.
 * They depend on theme.css CSS vars; globals.css imports theme.css as a compat
 * bridge so they render correctly in this isolated window.
 */

import React, { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Settings01Icon,
  Moon01Icon,
  Globe02Icon,
  BrowserIcon,
  Analytics01Icon,
  Download01Icon,
  InboxIcon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useThemeStore } from "@/stores/useThemeStore";
import type { AiProviderSettings, ThemeMode, ReducedEffectsMode } from "@/types/settings";
import type { DockerStatus } from "@/types/domain";
import { invokeStrict, safeInvoke, errMessage } from "@/lib/tauriInvoke";

// Reused heavy sub-panels — these use old CSS class system (theme.css vars).
// They render fine here because globals.css @imports theme.css as a compat bridge.
import { AiProviderForm } from "@/pages/settings/AiProviderForm";
import { ProviderIcon } from "@/pages/settings/ProviderIcon";
import { isProviderConfigured } from "@/pages/settings/providerMeta";
import { BackupRestorePanel } from "@/pages/settings/BackupRestorePanel";
import { DataCleanupPanel } from "@/pages/settings/DataCleanupPanel";
import { BrowserExtensionsPanel } from "@/pages/settings/BrowserExtensionsPanel";
import { DockerStatusPanel } from "@/pages/settings/DockerStatusPanel";

// Settings-window shadcn primitives (scoped, never imported by main.tsx)
import { SectionHeader } from "./SectionHeader";
import { SettingRow } from "./SettingRow";
import { WindowControls } from "./WindowControls";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { IS_TAURI, IS_MAC } from "./platform";

// ── Tab catalogue ─────────────────────────────────────────────────────────────
type Tab = "general" | "effects" | "ai" | "browser" | "data" | "exports" | "backups" | "cleanup";

interface TabDef {
  key: Tab;
  label: string;
  icon: IconSvgElement;
}

interface TabGroup {
  label: string;
  tabs: TabDef[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: "Preferences",
    tabs: [
      { key: "general", label: "General", icon: Settings01Icon },
      { key: "effects", label: "Motion", icon: Moon01Icon },
    ],
  },
  {
    label: "Integrations",
    tabs: [
      { key: "ai", label: "AI Providers", icon: Globe02Icon },
      { key: "browser", label: "Browser", icon: BrowserIcon },
    ],
  },
  {
    label: "Data",
    tabs: [
      { key: "data", label: "Data Storage", icon: Analytics01Icon },
      { key: "exports", label: "Exports", icon: Download01Icon },
      { key: "backups", label: "Backups", icon: InboxIcon },
      { key: "cleanup", label: "Cleanup", icon: Cancel01Icon },
    ],
  },
];

const TABS: TabDef[] = TAB_GROUPS.flatMap((g) => g.tabs);

// Read initial tab from ?tab= query string (Rust open_settings_window passes this).
function readInitialTab(): Tab {
  if (typeof window === "undefined") return "general";
  const t = new URL(window.location.href).searchParams.get("tab");
  if (t && TABS.some((x) => x.key === t)) return t as Tab;
  return "general";
}

// ── AI provider helpers ────────────────────────────────────────────────────────
// Kind is always "browser" — the only provider left after cloud removal.
const PROVIDER_KINDS: AiProviderSettings["kind"][] = ["browser"];

const PROVIDER_DEFAULTS: Record<AiProviderSettings["kind"], AiProviderSettings> = {
  browser: {
    kind: "browser",
    label: "Browser (free)",
    endpointUrl: "",
    apiKeyStored: false,
    authKind: "api_key",
    defaultModel: "",
  },
};

function resolveProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
): AiProviderSettings {
  return providers.find((p) => p.kind === kind) ?? { ...PROVIDER_DEFAULTS[kind] };
}

function upsertProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
  patch: Partial<Omit<AiProviderSettings, "kind">>,
): AiProviderSettings[] {
  const idx = providers.findIndex((p) => p.kind === kind);
  if (idx === -1) return [...providers, { ...PROVIDER_DEFAULTS[kind], ...patch }];
  const next = [...providers];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

// ── Export catalogue (mirrors SettingsLogs.tsx) ───────────────────────────────
const EXPORTS = [
  {
    key: "profiles" as const,
    label: "Export profiles JSON",
    body: "All profile configs and CV references.",
  },
  {
    key: "jobs" as const,
    label: "Export jobs CSV",
    body: "Job listings, match scores, and statuses.",
  },
  {
    key: "applications" as const,
    label: "Export applications CSV",
    body: "Application history, outcomes, and retry counts.",
  },
  {
    key: "audit" as const,
    label: "Export audit CSV",
    body: "Full audit log with timestamps and event types.",
  },
];

// ── Per-automation headless overrides (mirrors SettingsLogs.tsx) ──────────────
const HEADLESS_TASKS: { key: string; label: string; defaultHeadless?: boolean }[] = [
  { key: "linkedin_search", label: "LinkedIn job search" },
  { key: "google_search", label: "Web / board search" },
  { key: "linkedin_posts", label: "LinkedIn posts search" },
  { key: "linkedin_push", label: "LinkedIn profile sync" },
  { key: "linkedin_connect", label: "LinkedIn auto-connect" },
  { key: "job_apply", label: "Job apply (Easy Apply)" },
  { key: "catho_search", label: "Catho job search" },
  { key: "infojobs_search", label: "InfoJobs job search" },
  { key: "infojobs_apply", label: "InfoJobs — apply to job", defaultHeadless: false },
  { key: "gupy_search", label: "Gupy job search" },
  { key: "catho_apply", label: "Catho — apply to job", defaultHeadless: false },
  { key: "catho_fill", label: "Catho resume fill", defaultHeadless: false },
  { key: "gmail_send", label: "Gmail — send application" },
];

const REDUCED_OPTS: { value: ReducedEffectsMode; label: string }[] = [
  { value: "auto", label: "Auto — follow OS prefers-reduced-motion" },
  { value: "off", label: "Off — allow all transitions" },
  { value: "on", label: "On — disable all transitions" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export function SettingsApp() {
  const [active, setActive] = useState<Tab>(readInitialTab);

  // Settings store
  const settings = useSettingsStore((s) => s.settings);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // Theme store — reads only.
  // updateSettings bridges mutations to the theme store via its own internal logic.
  const reducedEffects = useThemeStore((s) => s.reducedEffects);
  const theme = useThemeStore((s) => s.theme);

  // Export state
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Docker toggle — seeded from docker_status() when the browser tab first opens.
  const [dockerOptIn, setDockerOptIn] = useState(false);
  const [dockerLoaded, setDockerLoaded] = useState(false);

  // Load settings on mount (settings window has its own React root and store instance).
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Listen for tab-switch events emitted by the Rust open_settings_window command.
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "hiremeops:settings-tab",
      (e) => {
        const t = e.payload;
        if (TABS.some((x) => x.key === t)) setActive(t as Tab);
      },
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Load docker opt-in state once when the browser tab becomes active.
  useEffect(() => {
    if (active !== "browser" || dockerLoaded) return;
    void safeInvoke<DockerStatus>("docker_status").then((s) => {
      if (s) setDockerOptIn(s.optIn);
      setDockerLoaded(true);
    });
  }, [active, dockerLoaded]);

  // ── AI provider helpers ────────────────────────────────────────────────────
  const providers = settings?.aiProviders ?? [];
  const defaultProviderIdx = settings?.defaultAiProviderIndex ?? 0;

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

  // ── WAI-ARIA keyboard nav in the tab rail ──────────────────────────────────
  function handleTabKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    let next: number;
    if (e.key === "ArrowDown") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowUp") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else next = TABS.length - 1;
    setActive(TABS[next].key);
    document.getElementById(`stab-${TABS[next].key}`)?.focus();
  }

  // ── Export helpers ────────────────────────────────────────────────────────
  function downloadString(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
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

  // ── Docker toggle ─────────────────────────────────────────────────────────
  const handleDockerToggle = useCallback(async (enabled: boolean) => {
    setDockerOptIn(enabled);
    try {
      await invokeStrict<void>("set_docker_worker", { enabled });
    } catch {
      setDockerOptIn(!enabled); // rollback on failure
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">

      {/* ── Drag-region header ──────────────────────────────────────────────── */}
      <header
        data-tauri-drag-region
        className={cn(
          "flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-card/60",
          IS_MAC ? "pr-3 pl-[88px]" : "pr-0 pl-3",
        )}
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Settings
          </span>
        </div>
        <WindowControls />
      </header>

      {/* ── Body: nav rail + content ────────────────────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-row">

        {/* ── Left nav rail ──────────────────────────────────────────────────── */}
        <nav
          className="w-48 shrink-0 border-r border-border/60 bg-card/35 p-2"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          <div className="flex flex-col gap-3">
            {TAB_GROUPS.map((group, gi) => (
              <React.Fragment key={group.label}>
                {gi > 0 && (
                  <div className="h-px bg-border/50" role="separator" aria-hidden="true" />
                )}
                <div className="flex flex-col gap-0.5">
                  <span className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                    {group.label}
                  </span>
                  {group.tabs.map((t) => {
                    const flatIdx = TABS.findIndex((ft) => ft.key === t.key);
                    return (
                      <button
                        key={t.key}
                        id={`stab-${t.key}`}
                        type="button"
                        role="tab"
                        aria-selected={active === t.key}
                        aria-controls="settings-panel"
                        tabIndex={active === t.key ? 0 : -1}
                        onClick={() => setActive(t.key)}
                        onKeyDown={(e) => handleTabKey(e, flatIdx)}
                        className={cn(
                          "flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors",
                          active === t.key
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/45 hover:text-foreground",
                        )}
                      >
                        <HugeiconsIcon icon={t.icon} size={14} strokeWidth={1.75} />
                        <span className="truncate">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>
        </nav>

        {/* ── Scrolling content panel ────────────────────────────────────────── */}
        <section
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`stab-${active}`}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4"
        >
          <div className="mx-auto w-full max-w-[1280px] space-y-4">
            {isLoading ? (
              <p className="text-[12px] text-muted-foreground">Loading settings...</p>
            ) : (
              <>
                {/* ════ GENERAL ══════════════════════════════════════════════ */}
                {active === "general" && (
                  <div className="space-y-4">
                    <SectionHeader
                      title="General"
                      description="Profile, language, startup, and runtime preferences."
                    />

                    <SettingRow
                      title="Active profile"
                      description="Switch the active profile on the Profiles page."
                    >
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {settings?.activeProfileId ?? "—"}
                      </code>
                    </SettingRow>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          App language
                        </span>
                        <Select
                          value={settings?.appLanguage ?? "en"}
                          onValueChange={(v) => void updateSettings({ appLanguage: v })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">English</SelectItem>
                            <SelectItem value="de">Deutsch</SelectItem>
                            <SelectItem value="fi">Suomi</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Startup behavior
                        </span>
                        <Select
                          value={settings?.startupBehavior ?? "normal"}
                          onValueChange={(v) =>
                            void updateSettings({
                              startupBehavior: v as "normal" | "minimized" | "tray",
                            })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="normal">Normal window</SelectItem>
                            <SelectItem value="minimized">Start minimized</SelectItem>
                            <SelectItem value="tray">Start in system tray</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">Theme</span>
                      <Select
                        value={theme}
                        onValueChange={(v) => void updateSettings({ theme: v as ThemeMode })}
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="system">System (follow OS)</SelectItem>
                          <SelectItem value="red">Red</SelectItem>
                          <SelectItem value="solo-leveling">Solo Leveling</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <SettingRow
                      title="Portable mode"
                      description="Store all data next to the executable instead of the system data dir."
                    >
                      <Switch
                        checked={settings?.portableMode ?? false}
                        onCheckedChange={(checked) =>
                          void updateSettings({ portableMode: checked })
                        }
                      />
                    </SettingRow>
                  </div>
                )}

                {/* ════ MOTION ═══════════════════════════════════════════════ */}
                {active === "effects" && (
                  <div className="space-y-4">
                    <SectionHeader
                      title="Motion and Effects"
                      description="Control animations and transitions across the app."
                    />

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Motion preference
                      </span>
                      <Select
                        value={reducedEffects}
                        onValueChange={(v) =>
                          void updateSettings({ reducedEffects: v as ReducedEffectsMode })
                        }
                      >
                        <SelectTrigger className="w-full max-w-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {REDUCED_OPTS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                        When enabled, adds{" "}
                        <code className="font-mono">reduced-effects</code> to{" "}
                        <code className="font-mono">&lt;html&gt;</code>, suppressing all CSS
                        transitions project-wide.
                      </p>
                    </div>
                  </div>
                )}

                {/* ════ AI PROVIDERS ════════════════════════════════════════ */}
                {active === "ai" && (
                  <div className="space-y-4">
                    <SectionHeader
                      title="AI Providers"
                      description="Configure the browser provider, then check its login state. Used for CV analysis, job matching, and cover letter generation."
                    />

                    {/* Provider selector row */}
                    <div
                      className="flex flex-wrap gap-2"
                      role="radiogroup"
                      aria-label="Default AI provider"
                    >
                      {PROVIDER_KINDS.map((kind) => {
                        const provider = resolveProvider(providers, kind);
                        const configured = isProviderConfigured(provider);
                        const isDefault = providers[defaultProviderIdx]?.kind === kind;
                        return (
                          <button
                            key={kind}
                            type="button"
                            role="radio"
                            aria-checked={isDefault}
                            onClick={() => handleSetDefaultProvider(kind)}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] transition-colors",
                              isDefault
                                ? "border-primary/60 bg-primary/10 text-foreground"
                                : "border-border/60 bg-card/40 text-muted-foreground hover:bg-accent/40",
                            )}
                          >
                            <ProviderIcon kind={kind} size={16} />
                            <span>{PROVIDER_DEFAULTS[kind].label}</span>
                            <span
                              aria-hidden="true"
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                configured ? "bg-green-400" : "bg-muted-foreground/40",
                              )}
                            />
                            {isDefault && (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                size={13}
                                strokeWidth={2}
                                className="text-primary"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Provider config forms */}
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

                {/* ════ BROWSER ══════════════════════════════════════════════ */}
                {active === "browser" && (
                  <div className="space-y-6">
                    <SectionHeader
                      title="Browser"
                      description="Engine: Playwright Chromium (bundled via Patchright). Each profile keeps its own cookie jar so sessions are independent."
                    />

                    {/* Profile root path */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Browser profile root path
                      </span>
                      <Input
                        type="text"
                        value={settings?.browserProfileRootPath ?? ""}
                        readOnly
                        aria-readonly="true"
                        placeholder="Set by backend on first launch"
                        className="font-mono text-[11px]"
                        onChange={() => {/* read-only field */}}
                      />
                      <p className="text-[10.5px] text-muted-foreground">
                        Managed by the backend. One sub-folder per profile.
                      </p>
                    </div>

                    {/* Quick session actions */}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" disabled>
                        Check LinkedIn session
                      </Button>
                      <Button variant="ghost" size="sm" disabled>
                        Manual login setup
                      </Button>
                      <Button variant="destructive" size="sm" disabled>
                        Clear session
                      </Button>
                    </div>

                    {/* Docker container runtime */}
                    <div className="space-y-3">
                      <h2 className="text-[13px] font-semibold text-foreground/90">
                        Container runtime (Docker)
                      </h2>
                      <SettingRow
                        title="Run browser worker in Docker"
                        description="Uses the hiremeops-worker container image (Node + Patchright + Chromium + Xvfb). Build with npm run build:docker, then toggle here."
                      >
                        <Switch
                          checked={dockerOptIn}
                          onCheckedChange={(checked) => void handleDockerToggle(checked)}
                        />
                      </SettingRow>
                      <DockerStatusPanel />
                    </div>

                    {/* Automation headless */}
                    <div className="space-y-3">
                      <h2 className="text-[13px] font-semibold text-foreground/90">
                        Automation
                      </h2>
                      <SettingRow
                        title="Headless automation"
                        description="Hide browser windows during automation runs. The manual LinkedIn login window always opens visible."
                      >
                        <Switch
                          checked={settings?.automationHeadless ?? true}
                          onCheckedChange={(checked) =>
                            void updateSettings({ automationHeadless: checked })
                          }
                        />
                      </SettingRow>

                      <p className="text-[11px] font-medium text-foreground/70">
                        Per-automation overrides
                      </p>
                      <div className="space-y-1.5">
                        {HEADLESS_TASKS.map((task) => {
                          const overrides = settings?.automationHeadlessOverrides ?? {};
                          const fallback =
                            task.defaultHeadless ?? settings?.automationHeadless ?? true;
                          const checked = overrides[task.key] ?? fallback;
                          return (
                            <SettingRow key={task.key} title={task.label}>
                              <Switch
                                checked={checked}
                                onCheckedChange={(value) =>
                                  void updateSettings({
                                    automationHeadlessOverrides: {
                                      ...overrides,
                                      [task.key]: value,
                                    },
                                  })
                                }
                              />
                            </SettingRow>
                          );
                        })}
                      </div>
                    </div>

                    {/* AI auto-init */}
                    <div className="space-y-3">
                      <h2 className="text-[13px] font-semibold text-foreground/90">
                        AI Provider
                      </h2>
                      <SettingRow
                        title="Auto-start AI provider on launch"
                        description="Warms up the ChatGPT browser session silently at startup so the first AI completion has no cold-start delay."
                      >
                        <Switch
                          checked={settings?.aiAutoInit ?? true}
                          onCheckedChange={(checked) =>
                            void updateSettings({ aiAutoInit: checked })
                          }
                        />
                      </SettingRow>
                    </div>

                    {/* Extensions */}
                    <div className="space-y-3">
                      <h2 className="text-[13px] font-semibold text-foreground/90">
                        Extensions
                      </h2>
                      <BrowserExtensionsPanel />
                    </div>
                  </div>
                )}

                {/* ════ DATA STORAGE ════════════════════════════════════════ */}
                {active === "data" && (
                  <div className="space-y-4">
                    <SectionHeader title="Data Storage" />

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Database path
                      </span>
                      <code className="block w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 font-mono text-[11px] text-foreground/80">
                        {settings?.databasePath || "—"}
                      </code>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                        <div
                          key={row.label}
                          className="flex flex-col gap-1 rounded-md border border-border/60 bg-card/60 px-3 py-2.5"
                        >
                          <span className="text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
                            {row.label}
                          </span>
                          <span className="font-mono text-[11px] text-foreground/80">
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ════ EXPORTS ══════════════════════════════════════════════ */}
                {active === "exports" && (
                  <div className="space-y-4">
                    <SectionHeader
                      title="Exports"
                      description="Export your data as files. Each export downloads to your default Downloads folder."
                    />

                    {exportError && (
                      <p className="text-[11px] text-destructive">{exportError}</p>
                    )}

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {EXPORTS.map((ex) => (
                        <div
                          key={ex.key}
                          className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-3"
                        >
                          <div className="text-[12.5px] font-medium">{ex.label}</div>
                          <div className="flex-1 text-[11px] text-muted-foreground">{ex.body}</div>
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

                {/* ════ BACKUPS ══════════════════════════════════════════════ */}
                {active === "backups" && (
                  <div className="space-y-4">
                    <SectionHeader title="Backups" />
                    <BackupRestorePanel />
                  </div>
                )}

                {/* ════ CLEANUP ══════════════════════════════════════════════ */}
                {active === "cleanup" && (
                  <div className="space-y-4">
                    <SectionHeader title="Cleanup" />
                    <DataCleanupPanel />
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
