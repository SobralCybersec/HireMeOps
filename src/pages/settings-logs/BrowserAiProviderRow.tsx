import type { AppSettings } from "../../types/settings";
import { Switch } from "../../components/ui";
import { SettingRow } from "../settings/SettingRow";

type UpdateSettings = (patch: Partial<AppSettings>) => Promise<void>;

export function BrowserAiProviderRow({
  settings,
  updateSettings,
}: {
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}) {
  return (
    <SettingRow
      title="Auto-start AI provider on launch"
      description="Warms up the ChatGPT browser session silently at startup so the first AI completion has no cold-start delay."
    >
      <Switch
        checked={settings?.aiAutoInit ?? true}
        onChange={(checked) => void updateSettings({ aiAutoInit: checked })}
        aria-label="Auto-start AI provider on launch"
      />
    </SettingRow>
  );
}
