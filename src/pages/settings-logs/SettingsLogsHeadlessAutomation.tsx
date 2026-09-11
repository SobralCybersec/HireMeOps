import { SectionHeader } from "../settings/SectionHeader";
import { SettingRow } from "../settings/SettingRow";
import { Switch } from "../../components/ui";
import type { AppSettings } from "../../types/settings";

const HEADLESS_TASKS: { key: string; label: string; defaultHeadless?: boolean }[] = [
  { key: "linkedin_search", label: "LinkedIn job search" },
  { key: "google_search", label: "Web / board search" },
  { key: "linkedin_posts", label: "LinkedIn posts search" },
  { key: "linkedin_push", label: "LinkedIn profile sync" },
  { key: "linkedin_connect", label: "LinkedIn auto-connect" },
  { key: "job_apply", label: "Job apply (Easy Apply)" },
  { key: "catho_search", label: "Catho job search (hidden window when on)" },
  { key: "infojobs_search", label: "InfoJobs job search" },
  { key: "infojobs_apply", label: "InfoJobs — apply to job", defaultHeadless: false },
  { key: "gupy_search", label: "Gupy job search" },
  { key: "catho_apply", label: "Catho — apply to job", defaultHeadless: false },
  { key: "catho_fill", label: "Catho resume fill", defaultHeadless: false },
  { key: "gmail_send", label: "Gmail — send application" },
];

type UpdateSettings = (patch: Partial<AppSettings>) => Promise<void>;

function AutomationTaskRow({
  task,
  settings,
  updateSettings,
}: {
  task: (typeof HEADLESS_TASKS)[number];
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}) {
  const overrides = settings?.automationHeadlessOverrides ?? {};
  const fallback = task.defaultHeadless ?? settings?.automationHeadless ?? true;
  const updateOverride = (value: boolean) =>
    updateSettings({
      automationHeadlessOverrides: { ...overrides, [task.key]: value },
    });
  return (
    <SettingRow key={task.key} title={task.label}>
      <Switch
        checked={overrides[task.key] ?? fallback}
        onChange={updateOverride}
        aria-label={task.label}
      />
    </SettingRow>
  );
}

export function HeadlessAutomationSection({
  settings,
  updateSettings,
}: {
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}) {
  return (
    <div style={{ marginTop: "var(--sp-2)" }}>
      <SectionHeader level={3} title="Automation" />
      <div className="settings-rows" style={{ marginTop: "var(--sp-2)" }}>
        <SettingRow
          title="Headless automation"
          description="Hide browser windows during automation runs. The manual LinkedIn login window always opens visible."
        >
          <Switch
            checked={settings?.automationHeadless ?? true}
            onChange={(checked) => void updateSettings({ automationHeadless: checked })}
            aria-label="Headless automation"
          />
        </SettingRow>
      </div>
      <p
        style={{
          margin: "var(--sp-3) 0 var(--sp-2)",
          fontSize: "var(--text-xs)",
          fontWeight: "var(--fw-semibold)",
          color: "var(--color-text-2)",
        }}
      >
        Per automation — override the setting above for individual tasks
      </p>
      <div className="settings-rows">
        {HEADLESS_TASKS.map((task) => (
          <AutomationTaskRow
            key={task.key}
            task={task}
            settings={settings}
            updateSettings={updateSettings}
          />
        ))}
      </div>
    </div>
  );
}
