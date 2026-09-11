import type { AppSettings } from "../../types/settings";
import { SettingRow } from "../settings/SettingRow";
import { Switch } from "../../components/ui";

type UpdateSettings = (patch: Partial<AppSettings>) => Promise<void>;

export function GeneralPortableRow({
  settings,
  updateSettings,
}: {
  settings: AppSettings | null;
  updateSettings: UpdateSettings;
}) {
  return (
    <SettingRow title="Portable mode" description="Store all data next to the executable.">
      <Switch
        checked={settings?.portableMode ?? false}
        onChange={(checked) => void updateSettings({ portableMode: checked })}
        aria-label="Portable mode"
      />
    </SettingRow>
  );
}
