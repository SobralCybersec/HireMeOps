import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import type {
  AiProviderSettings,
  AppSettings,
  ReducedEffectsMode,
  ThemeMode,
} from "@/types/settings";
import { AiProviderForm } from "@/pages/settings/AiProviderForm";
import { ProviderIcon } from "@/pages/settings/ProviderIcon";
import { isProviderConfigured } from "@/pages/settings/providerMeta";
import { BackupRestorePanel } from "@/pages/settings/BackupRestorePanel";
import { DataCleanupPanel } from "@/pages/settings/DataCleanupPanel";
import { BrowserExtensionsPanel } from "@/pages/settings/BrowserExtensionsPanel";
import { DockerStatusPanel } from "@/pages/settings/DockerStatusPanel";
import { SectionHeader } from "./SectionHeader";
import { SettingRow } from "./SettingRow";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { SettingsExportCards, type SettingsExportKey } from "./SettingsExportCards";
import type { SettingsTab } from "./settingsTabModel";

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

function resolveProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
): AiProviderSettings {
  return providers.find((provider) => provider.kind === kind) ?? { ...PROVIDER_DEFAULTS[kind] };
}

function upsertProvider(
  providers: AiProviderSettings[],
  kind: AiProviderSettings["kind"],
  patch: Partial<Omit<AiProviderSettings, "kind">>,
): AiProviderSettings[] {
  const index = providers.findIndex((provider) => provider.kind === kind);
  if (index === -1) return [...providers, { ...PROVIDER_DEFAULTS[kind], ...patch }];
  const next = [...providers];
  next[index] = { ...next[index], ...patch };
  return next;
}

type UpdateSettings = (patch: Partial<AppSettings>) => Promise<void>;

interface GeneralPanelProps {
  settings: AppSettings | null;
  theme: ThemeMode;
  updateSettings: UpdateSettings;
}

function GeneralLocaleFields({
  settings,
  updateSettings,
}: Pick<GeneralPanelProps, "settings" | "updateSettings">) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">App language</span>
        <Select
          value={settings?.appLanguage ?? "en"}
          onValueChange={(value) => void updateSettings({ appLanguage: value ?? "en" })}
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
        <span className="text-[11px] font-medium text-muted-foreground">Startup behavior</span>
        <Select
          value={settings?.startupBehavior ?? "normal"}
          onValueChange={(value) =>
            void updateSettings({ startupBehavior: value as "normal" | "minimized" | "tray" })
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
  );
}

function GeneralThemeField({
  theme,
  updateSettings,
}: Pick<GeneralPanelProps, "theme" | "updateSettings">) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Theme</span>
      <Select
        value={theme}
        onValueChange={(value) => void updateSettings({ theme: value as ThemeMode })}
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
  );
}

function GeneralPanel({ settings, theme, updateSettings }: GeneralPanelProps) {
  return (
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
      <GeneralLocaleFields settings={settings} updateSettings={updateSettings} />
      <GeneralThemeField theme={theme} updateSettings={updateSettings} />
      <SettingRow
        title="Portable mode"
        description="Store all data next to the executable instead of the system data dir."
      >
        <Switch
          checked={settings?.portableMode ?? false}
          onCheckedChange={(checked) => void updateSettings({ portableMode: checked })}
        />
      </SettingRow>
    </div>
  );
}

function EffectsPanel({
  reducedEffects,
  updateSettings,
}: {
  reducedEffects: ReducedEffectsMode;
  updateSettings: UpdateSettings;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Motion and Effects"
        description="Control animations and transitions across the app."
      />
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Motion preference</span>
        <Select
          value={reducedEffects}
          onValueChange={(value) =>
            void updateSettings({ reducedEffects: value as ReducedEffectsMode })
          }
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REDUCED_OPTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          When enabled, adds <code className="font-mono">reduced-effects</code> to{" "}
          <code className="font-mono">&lt;html&gt;</code>, suppressing all CSS transitions
          project-wide.
        </p>
      </div>
    </div>
  );
}

function BrowserProfileInput({ settings }: { settings: AppSettings | null }) {
  return (
    <Input
      type="text"
      value={settings?.browserProfileRootPath ?? ""}
      readOnly
      aria-readonly="true"
      placeholder="Set by backend on first launch"
      className="font-mono text-[11px]"
      onChange={() => {}}
    />
  );
}

type ProviderPatch = Partial<Omit<AiProviderSettings, "kind">>;
type ProviderUpdate = (kind: AiProviderSettings["kind"], patch: ProviderPatch) => void;

interface AiProviderSelectorProps {
  providers: AiProviderSettings[];
  defaultProviderIndex: number;
  onSetDefault: (kind: AiProviderSettings["kind"]) => void;
}

function AiProviderButton({
  kind,
  provider,
  isDefault,
  onSetDefault,
}: {
  kind: AiProviderSettings["kind"];
  provider: AiProviderSettings;
  isDefault: boolean;
  onSetDefault: (kind: AiProviderSettings["kind"]) => void;
}) {
  const configured = isProviderConfigured(provider);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isDefault}
      onClick={() => onSetDefault(kind)}
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
        <HugeiconsIcon icon={Tick02Icon} size={13} strokeWidth={2} className="text-primary" />
      )}
    </button>
  );
}

function AiProviderSelector({
  providers,
  defaultProviderIndex,
  onSetDefault,
}: AiProviderSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Default AI provider">
      {PROVIDER_KINDS.map((kind) => (
        <AiProviderButton
          key={kind}
          kind={kind}
          provider={resolveProvider(providers, kind)}
          isDefault={providers[defaultProviderIndex]?.kind === kind}
          onSetDefault={onSetDefault}
        />
      ))}
    </div>
  );
}

function AiProviderForms({
  providers,
  defaultProviderIndex,
  onUpdate,
  onSetDefault,
}: {
  providers: AiProviderSettings[];
  defaultProviderIndex: number;
  onUpdate: ProviderUpdate;
  onSetDefault: (kind: AiProviderSettings["kind"]) => void;
}) {
  return (
    <>
      {PROVIDER_KINDS.map((kind) => {
        const providerIndex = providers.findIndex((provider) => provider.kind === kind);
        return (
          <AiProviderForm
            key={kind}
            kind={kind}
            value={resolveProvider(providers, kind)}
            isDefault={providerIndex !== -1 && providerIndex === defaultProviderIndex}
            onUpdate={(patch) => onUpdate(kind, patch)}
            onSetDefault={() => onSetDefault(kind)}
          />
        );
      })}
    </>
  );
}

function AiPanel({
  settings,
  updateSettings,
}: {
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}) {
  const providers = settings?.aiProviders ?? [];
  const defaultProviderIndex = settings?.defaultAiProviderIndex ?? 0;
  const updateProvider = (
    kind: AiProviderSettings["kind"],
    patch: Partial<Omit<AiProviderSettings, "kind">>,
  ) => {
    if (!settings) return;
    void updateSettings({ aiProviders: upsertProvider(providers, kind, patch) });
  };
  const setDefaultProvider = (kind: AiProviderSettings["kind"]) => {
    if (!settings) return;
    const next = upsertProvider(providers, kind, {});
    const index = next.findIndex((provider) => provider.kind === kind);
    void updateSettings({
      aiProviders: next,
      defaultAiProviderIndex: index === -1 ? 0 : index,
    });
  };
  return (
    <div className="space-y-4">
      <SectionHeader
        title="AI Providers"
        description="Configure the browser provider, then check its login state. Used for CV analysis, job matching, and cover letter generation."
      />
      <AiProviderSelector
        providers={providers}
        defaultProviderIndex={defaultProviderIndex}
        onSetDefault={setDefaultProvider}
      />
      <AiProviderForms
        providers={providers}
        defaultProviderIndex={defaultProviderIndex}
        onUpdate={updateProvider}
        onSetDefault={setDefaultProvider}
      />
    </div>
  );
}

interface BrowserPanelProps {
  settings: AppSettings | null;
  dockerOptIn: boolean;
  onDockerToggle: (enabled: boolean) => void;
  updateSettings: UpdateSettings;
}

function BrowserProfileRoot({ settings }: Pick<BrowserPanelProps, "settings">) {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        Browser profile root path
      </span>
      <BrowserProfileInput settings={settings} />
      <p className="text-[10.5px] text-muted-foreground">
        Managed by the backend. One sub-folder per profile.
      </p>
    </div>
  );
}

function BrowserSessionActions() {
  return (
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
  );
}

function BrowserSessionPanel({ settings }: Pick<BrowserPanelProps, "settings">) {
  return (
    <>
      <BrowserProfileRoot settings={settings} />
      <BrowserSessionActions />
    </>
  );
}

function BrowserProviderPanel({
  settings,
  updateSettings,
}: Pick<BrowserPanelProps, "settings" | "updateSettings">) {
  return (
    <>
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground/90">AI Provider</h2>
        <SettingRow
          title="Auto-start AI provider on launch"
          description="Warms up the ChatGPT browser session silently at startup so the first AI completion has no cold-start delay."
        >
          <Switch
            checked={settings?.aiAutoInit ?? true}
            onCheckedChange={(checked) => void updateSettings({ aiAutoInit: checked })}
          />
        </SettingRow>
      </div>
      <div className="space-y-3">
        <h2 className="text-[13px] font-semibold text-foreground/90">Extensions</h2>
        <BrowserExtensionsPanel />
      </div>
    </>
  );
}

function BrowserPanel({
  settings,
  dockerOptIn,
  onDockerToggle,
  updateSettings,
}: BrowserPanelProps) {
  return (
    <div className="space-y-6">
      <SectionHeader
        title="Browser"
        description="Engine: Playwright Chromium (bundled via Patchright). Each profile keeps its own cookie jar so sessions are independent."
      />
      <BrowserSessionPanel settings={settings} />
      <DockerPanel dockerOptIn={dockerOptIn} onDockerToggle={onDockerToggle} />
      <AutomationPanel settings={settings} updateSettings={updateSettings} />
      <BrowserProviderPanel settings={settings} updateSettings={updateSettings} />
    </div>
  );
}

function DockerPanel({
  dockerOptIn,
  onDockerToggle,
}: Pick<BrowserPanelProps, "dockerOptIn" | "onDockerToggle">) {
  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-semibold text-foreground/90">Container runtime (Docker)</h2>
      <SettingRow
        title="Run browser worker in Docker"
        description="Uses the hiremeops-worker container image (Node + Patchright + Chromium + Xvfb). Build with npm run build:docker, then toggle here."
      >
        <Switch checked={dockerOptIn} onCheckedChange={onDockerToggle} />
      </SettingRow>
      <DockerStatusPanel />
    </div>
  );
}

interface AutomationOverrideRowProps {
  task: (typeof HEADLESS_TASKS)[number];
  overrides: Record<string, boolean>;
  fallback: boolean;
  updateSettings: UpdateSettings;
}

function AutomationOverrideRow({
  task,
  overrides,
  fallback,
  updateSettings,
}: AutomationOverrideRowProps) {
  const updateOverride = (value: boolean) =>
    updateSettings({
      automationHeadlessOverrides: { ...overrides, [task.key]: value },
    });
  return (
    <SettingRow key={task.key} title={task.label}>
      <Switch checked={overrides[task.key] ?? fallback} onCheckedChange={updateOverride} />
    </SettingRow>
  );
}

function AutomationPanel({
  settings,
  updateSettings,
}: Pick<BrowserPanelProps, "settings" | "updateSettings">) {
  return (
    <div className="space-y-3">
      <h2 className="text-[13px] font-semibold text-foreground/90">Automation</h2>
      <SettingRow
        title="Headless automation"
        description="Hide browser windows during automation runs. The manual LinkedIn login window always opens visible."
      >
        <Switch
          checked={settings?.automationHeadless ?? true}
          onCheckedChange={(checked) => void updateSettings({ automationHeadless: checked })}
        />
      </SettingRow>
      <p className="text-[11px] font-medium text-foreground/70">Per-automation overrides</p>
      <div className="space-y-1.5">
        {HEADLESS_TASKS.map((task) => {
          const overrides = settings?.automationHeadlessOverrides ?? {};
          const fallback = task.defaultHeadless ?? settings?.automationHeadless ?? true;
          return (
            <AutomationOverrideRow
              key={task.key}
              task={task}
              overrides={overrides}
              fallback={fallback}
              updateSettings={updateSettings}
            />
          );
        })}
      </div>
    </div>
  );
}

function DataPanel({ settings }: { settings: AppSettings | null }) {
  const rows = [
    { label: "Audit logs", value: `${settings?.auditLogRetentionDays ?? 30} days` },
    { label: "Evidence", value: `${settings?.automationEvidenceRetentionDays ?? 1} day` },
    { label: "AI cache", value: "Manual clear" },
    { label: "Artifacts", value: "Manual clear" },
  ];
  return (
    <div className="space-y-4">
      <SectionHeader title="Data Storage" />
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Database path</span>
        <code className="block w-full rounded-md border border-border/60 bg-card/60 px-3 py-2 font-mono text-[11px] text-foreground/80">
          {settings?.databasePath || "—"}
        </code>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 rounded-md border border-border/60 bg-card/60 px-3 py-2.5"
          >
            <span className="text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
              {row.label}
            </span>
            <span className="font-mono text-[11px] text-foreground/80">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackupPanel() {
  return (
    <div className="space-y-4">
      <SectionHeader title="Backups" />
      <BackupRestorePanel />
    </div>
  );
}

function CleanupPanel() {
  return (
    <div className="space-y-4">
      <SectionHeader title="Cleanup" />
      <DataCleanupPanel />
    </div>
  );
}

interface SettingsAppContentProps {
  active: SettingsTab;
  settings: AppSettings | null;
  isLoading: boolean;
  theme: ThemeMode;
  reducedEffects: ReducedEffectsMode;
  updateSettings: UpdateSettings;
  dockerOptIn: boolean;
  onDockerToggle: (enabled: boolean) => void;
  exportingKey: SettingsExportKey | null;
  exportError: string | null;
  onExport: (key: SettingsExportKey) => void;
}

export function SettingsAppContent(props: SettingsAppContentProps) {
  const {
    active,
    settings,
    isLoading,
    theme,
    reducedEffects,
    updateSettings,
    dockerOptIn,
    onDockerToggle,
    exportingKey,
    exportError,
    onExport,
  } = props;
  return (
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
            {active === "general" && (
              <GeneralPanel settings={settings} theme={theme} updateSettings={updateSettings} />
            )}
            {active === "effects" && (
              <EffectsPanel reducedEffects={reducedEffects} updateSettings={updateSettings} />
            )}
            {active === "ai" && <AiPanel settings={settings} updateSettings={updateSettings} />}
            {active === "browser" && (
              <BrowserPanel
                settings={settings}
                dockerOptIn={dockerOptIn}
                onDockerToggle={onDockerToggle}
                updateSettings={updateSettings}
              />
            )}
            {active === "data" && <DataPanel settings={settings} />}
            {active === "exports" && (
              <SettingsExportCards
                exportingKey={exportingKey}
                exportError={exportError}
                onExport={onExport}
              />
            )}
            {active === "backups" && <BackupPanel />}
            {active === "cleanup" && <CleanupPanel />}
          </>
        )}
      </div>
    </section>
  );
}
