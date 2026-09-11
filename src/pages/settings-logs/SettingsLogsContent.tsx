import {
  Button,
  Field,
  FormRow,
  Icon,
  Input,
  RadioGroup,
  Select,
  Switch,
  Toolbar,
  ToolbarSep,
} from "../../components/ui";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { AiProviderForm } from "../settings/AiProviderForm";
import { ProviderIcon } from "../settings/ProviderIcon";
import { isProviderConfigured } from "../settings/providerMeta";
import { BackupRestorePanel } from "../settings/BackupRestorePanel";
import { BrowserExtensionsPanel } from "../settings/BrowserExtensionsPanel";
import { DataCleanupPanel } from "../settings/DataCleanupPanel";
import { DockerStatusPanel } from "../settings/DockerStatusPanel";
import { SectionHeader } from "../settings/SectionHeader";
import { SettingRow } from "../settings/SettingRow";
import type {
  AiProviderSettings,
  AppSettings,
  ReducedEffectsMode,
  ThemeMode,
} from "../../types/settings";
import { SettingsLogsExports, type ExportKey } from "./SettingsLogsExports";
import type { Tab } from "./SettingsLogsNavigation";
import { GeneralPortableRow } from "./SettingsLogsGeneralPortableRow";
import { HeadlessAutomationSection } from "./SettingsLogsHeadlessAutomation";

const REDUCED_OPTS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto - follow OS prefers-reduced-motion" },
  { value: "off", label: "Off - allow all transitions" },
  { value: "on", label: "On - disable all transitions" },
];

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
  return (
    providers.find((provider) => provider.kind === kind) ?? {
      ...PROVIDER_DEFAULTS[kind],
    }
  );
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

interface GeneralSettingsProps {
  settings: AppSettings | null;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  updateSettings: UpdateSettings;
}

function GeneralProfileField({ settings }: Pick<GeneralSettingsProps, "settings">) {
  return (
    <Field label="Active profile" helper="Switch the active profile on the Profiles page.">
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
  );
}

function GeneralLanguageField({
  settings,
  updateSettings,
}: Pick<GeneralSettingsProps, "settings" | "updateSettings">) {
  return (
    <Field label="App language" htmlFor="app-lang">
      <Select
        id="app-lang"
        value={settings?.appLanguage ?? "en"}
        options={[
          { value: "en", label: "English" },
          { value: "de", label: "Deutsch" },
          { value: "fi", label: "Suomi" },
        ]}
        onChange={(event) => void updateSettings({ appLanguage: event.target.value })}
      />
    </Field>
  );
}

function GeneralStartupField({
  settings,
  updateSettings,
}: Pick<GeneralSettingsProps, "settings" | "updateSettings">) {
  return (
    <Field label="Startup behavior" htmlFor="startup-behavior">
      <Select
        id="startup-behavior"
        value={settings?.startupBehavior ?? "normal"}
        options={[
          { value: "normal", label: "Normal window" },
          { value: "minimized", label: "Start minimized" },
          { value: "tray", label: "Start in system tray" },
        ]}
        onChange={(event) =>
          void updateSettings({
            startupBehavior: event.target.value as "normal" | "minimized" | "tray",
          })
        }
      />
    </Field>
  );
}

function GeneralThemeField({
  theme,
  onThemeChange,
  updateSettings,
}: Pick<GeneralSettingsProps, "theme" | "onThemeChange" | "updateSettings">) {
  return (
    <Field label="Theme" htmlFor="app-theme">
      <Select
        id="app-theme"
        value={theme}
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
          { value: "system", label: "System (follow OS)" },
        ]}
        onChange={(event) => {
          const next = event.target.value as ThemeMode;
          onThemeChange(next);
          void updateSettings({ theme: next });
        }}
      />
    </Field>
  );
}

function GeneralDockerSection() {
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <SectionHeader level={3} title="Container runtime (Docker)" />
      <div style={{ marginTop: "var(--sp-2)" }}>
        <DockerStatusPanel />
      </div>
    </div>
  );
}

function GeneralSettings({ settings, theme, onThemeChange, updateSettings }: GeneralSettingsProps) {
  return (
    <div className="section-group">
      <SectionHeader
        title="General"
        description="Profile, language, startup, and runtime preferences."
      />
      <GeneralProfileField settings={settings} />
      <FormRow>
        <GeneralLanguageField settings={settings} updateSettings={updateSettings} />
        <GeneralStartupField settings={settings} updateSettings={updateSettings} />
      </FormRow>
      <FormRow>
        <GeneralThemeField
          theme={theme}
          onThemeChange={onThemeChange}
          updateSettings={updateSettings}
        />
      </FormRow>
      <div className="settings-rows">
        <GeneralPortableRow settings={settings} updateSettings={updateSettings} />
      </div>
      <GeneralDockerSection />
    </div>
  );
}

interface MotionSettingsProps {
  reducedEffects: ReducedEffectsMode;
  onReducedEffectsChange: (mode: ReducedEffectsMode) => void;
}

function MotionSettings({ reducedEffects, onReducedEffectsChange }: MotionSettingsProps) {
  return (
    <div className="section-group">
      <SectionHeader
        title="Motion and Effects"
        description="Control animation and transitions across the app."
      />
      <RadioGroup
        name="reduced-effects"
        value={reducedEffects}
        options={REDUCED_OPTS}
        onChange={(value) => onReducedEffectsChange(value as ReducedEffectsMode)}
        label="Motion and effects"
      />
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          lineHeight: 1.5,
        }}
      >
        When enabled, adds <code className="code">reduced-effects</code> to{" "}
        <code className="code">&lt;html&gt;</code>, suppressing all CSS transitions and animations
        project-wide. HireMeOps ships one dark neutral HUD theme.
      </p>
    </div>
  );
}

interface AiSettingsProps {
  providers: AiProviderSettings[];
  defaultProviderIndex: number;
  updateSettings: UpdateSettings;
}

function LogsProviderButton({
  kind,
  provider,
  selected,
  onSelect,
}: {
  kind: AiProviderSettings["kind"];
  provider: AiProviderSettings;
  selected: boolean;
  onSelect: (kind: AiProviderSettings["kind"]) => void;
}) {
  return (
    <button
      key={kind}
      type="button"
      role="radio"
      aria-checked={selected}
      className={`ai-provider-picker__item${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(kind)}
    >
      <ProviderIcon kind={kind} size={20} />
      <span className="ai-provider-picker__label">{PROVIDER_DEFAULTS[kind].label}</span>
      <span
        className={`ai-provider-picker__dot${isProviderConfigured(provider) ? " is-configured" : ""}`}
        aria-hidden="true"
      />
      {selected && <Icon icon={CheckmarkCircle02Icon} size={14} />}
    </button>
  );
}

function LogsProviderPicker({
  providers,
  defaultProviderIndex,
  onSelect,
}: {
  providers: AiProviderSettings[];
  defaultProviderIndex: number;
  onSelect: (kind: AiProviderSettings["kind"]) => void;
}) {
  return (
    <div className="ai-provider-picker" role="radiogroup" aria-label="Default AI provider">
      {PROVIDER_KINDS.map((kind) => (
        <LogsProviderButton
          key={kind}
          kind={kind}
          provider={resolveProvider(providers, kind)}
          selected={providers[defaultProviderIndex]?.kind === kind}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function LogsProviderForms({
  providers,
  defaultProviderIndex,
  updateProvider,
  setDefaultProvider,
}: {
  providers: AiProviderSettings[];
  defaultProviderIndex: number;
  updateProvider: (
    kind: AiProviderSettings["kind"],
    patch: Partial<Omit<AiProviderSettings, "kind">>,
  ) => void;
  setDefaultProvider: (kind: AiProviderSettings["kind"]) => void;
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
            onUpdate={(patch) => updateProvider(kind, patch)}
            onSetDefault={() => setDefaultProvider(kind)}
          />
        );
      })}
    </>
  );
}

function AiSettings({ providers, defaultProviderIndex, updateSettings }: AiSettingsProps) {
  const updateProvider = (
    kind: AiProviderSettings["kind"],
    patch: Partial<Omit<AiProviderSettings, "kind">>,
  ) => {
    void updateSettings({
      aiProviders: upsertProvider(providers, kind, patch),
      defaultAiProviderIndex: 0,
    });
  };

  const setDefaultProvider = (kind: AiProviderSettings["kind"]) => {
    const next = upsertProvider(providers, kind, {});
    const index = next.findIndex((provider) => provider.kind === kind);
    void updateSettings({
      aiProviders: next,
      defaultAiProviderIndex: index === -1 ? 0 : index,
    });
  };

  return (
    <div className="section-group">
      <SectionHeader
        title="AI Providers"
        description="Configure one or more provider endpoints, then pick the active one below. The default provider is used for CV analysis, job matching, and cover letter generation."
      />
      <LogsProviderPicker
        providers={providers}
        defaultProviderIndex={defaultProviderIndex}
        onSelect={setDefaultProvider}
      />
      <LogsProviderForms
        providers={providers}
        defaultProviderIndex={defaultProviderIndex}
        updateProvider={updateProvider}
        setDefaultProvider={setDefaultProvider}
      />
    </div>
  );
}

interface BrowserSettingsProps {
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}

function BrowserProfileInput({ settings }: Pick<BrowserSettingsProps, "settings">) {
  return (
    <Input
      id="browser-root"
      type="text"
      value={settings?.browserProfileRootPath ?? ""}
      readOnly
      aria-readonly="true"
      placeholder="Set by backend on first launch"
      style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
      onChange={() => {}}
    />
  );
}

function BrowserAiProviderSection({ settings, updateSettings }: BrowserSettingsProps) {
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <SectionHeader level={3} title="AI Provider" />
      <div className="settings-rows" style={{ marginTop: "var(--sp-2)" }}>
        <BrowserAiProviderRow settings={settings} updateSettings={updateSettings} />
      </div>
    </div>
  );
}

function BrowserExtensionsSection() {
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <SectionHeader level={3} title="Extensions" />
      <div style={{ marginTop: "var(--sp-2)" }}>
        <BrowserExtensionsPanel />
      </div>
    </div>
  );
}

function BrowserAutomationSettings({ settings, updateSettings }: BrowserSettingsProps) {
  return (
    <>
      <HeadlessAutomationSection settings={settings} updateSettings={updateSettings} />
      <BrowserAiProviderSection settings={settings} updateSettings={updateSettings} />
      <BrowserExtensionsSection />
    </>
  );
}

function BrowserProfileField({ settings }: Pick<BrowserSettingsProps, "settings">) {
  return (
    <Field
      label="Browser profile root path"
      htmlFor="browser-root"
      helper="Path is managed by the backend. One sub-folder per profile."
    >
      <BrowserProfileInput settings={settings} />
    </Field>
  );
}

function BrowserSessionToolbar() {
  return (
    <Toolbar aria-label="Browser session actions">
      <Button variant="ghost" aria-disabled="true" aria-label="Check LinkedIn session health">
        Check LinkedIn session
      </Button>
      <Button variant="ghost" aria-disabled="true" aria-label="Open manual login setup">
        Manual login setup
      </Button>
      <ToolbarSep />
      <Button
        variant="danger"
        size="sm"
        aria-disabled="true"
        aria-label="Clear browser session data"
      >
        Clear session
      </Button>
    </Toolbar>
  );
}

function BrowserSessionControls({ settings }: Pick<BrowserSettingsProps, "settings">) {
  return (
    <>
      <BrowserProfileField settings={settings} />
      <BrowserSessionToolbar />
    </>
  );
}

function BrowserSettings({ settings, updateSettings }: BrowserSettingsProps) {
  return (
    <div className="section-group">
      <SectionHeader
        title="Browser"
        description="Engine: Playwright Chromium (bundled). Each HireMeOps profile keeps its own browser profile in the path below, preserving login sessions independently."
      />
      <BrowserSessionControls settings={settings} />
      <BrowserAutomationSettings settings={settings} updateSettings={updateSettings} />
    </div>
  );
}

function DataSettings({ settings }: { settings: AppSettings | null }) {
  return (
    <div className="section-group">
      <SectionHeader title="Data Storage" />
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
    </div>
  );
}

function BackupsSettings() {
  return (
    <div className="section-group">
      <SectionHeader title="Backups" />
      <BackupRestorePanel />
    </div>
  );
}

function CleanupSettings({ settings }: { settings: AppSettings | null }) {
  const rows = [
    { label: "Audit logs", value: `${settings?.auditLogRetentionDays ?? 30} days` },
    { label: "Evidence", value: `${settings?.automationEvidenceRetentionDays ?? 1} day` },
    { label: "AI cache", value: "Manual clear" },
    { label: "Artifacts", value: "Manual clear" },
  ];
  return (
    <div className="section-group">
      <SectionHeader title="Cleanup" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "var(--sp-2)",
          padding: "var(--sp-3) var(--sp-4)",
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        {rows.map((row) => (
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
  );
}

interface SettingsLogsContentProps {
  activeTab: Tab;
  settings: AppSettings | null;
  isLoading: boolean;
  reducedEffects: ReducedEffectsMode;
  onReducedEffectsChange: (mode: ReducedEffectsMode) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  updateSettings: UpdateSettings;
  exportingKey: ExportKey | null;
  exportError: string | null;
  onExport: (key: ExportKey) => void;
}

export function SettingsLogsContent(props: SettingsLogsContentProps) {
  const {
    activeTab,
    settings,
    isLoading,
    reducedEffects,
    onReducedEffectsChange,
    theme,
    onThemeChange,
    updateSettings,
    exportingKey,
    exportError,
    onExport,
  } = props;
  const providers = (settings?.aiProviders ?? []).filter((provider) => provider.kind === "browser");
  const needsSettings = activeTab !== "effects";
  const selectDefaultProvider = 0;

  return (
    <div
      id="settings-panel"
      className="settings-shell__content"
      role="tabpanel"
      aria-labelledby={`settings-tab-${activeTab}`}
      tabIndex={0}
    >
      {isLoading && needsSettings ? (
        <div className="empty-state">
          <p className="empty-state__title">Loading settings...</p>
        </div>
      ) : (
        <div className="settings-shell__inner">
          {activeTab === "general" && (
            <GeneralSettings
              settings={settings}
              theme={theme}
              onThemeChange={onThemeChange}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "effects" && (
            <MotionSettings
              reducedEffects={reducedEffects}
              onReducedEffectsChange={onReducedEffectsChange}
            />
          )}
          {activeTab === "ai" && (
            <AiSettings
              providers={providers}
              defaultProviderIndex={selectDefaultProvider}
              updateSettings={updateSettings}
            />
          )}
          {activeTab === "browser" && (
            <BrowserSettings settings={settings} updateSettings={updateSettings} />
          )}
          {activeTab === "data" && <DataSettings settings={settings} />}
          {activeTab === "exports" && (
            <SettingsLogsExports
              exportingKey={exportingKey}
              exportError={exportError}
              onExport={onExport}
            />
          )}
          {activeTab === "backups" && <BackupsSettings />}
          {activeTab === "cleanup" && <CleanupSettings settings={settings} />}
        </div>
      )}
    </div>
  );
}
