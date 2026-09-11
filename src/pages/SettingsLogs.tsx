import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useThemeStore } from "../stores/useThemeStore";
import { Icon } from "../components/ui";
import { Settings01Icon } from "@hugeicons/core-free-icons";
import { errMessage, invokeStrict } from "../lib/tauriInvoke";
import { SettingsLogsContent } from "./settings-logs/SettingsLogsContent";
import { SettingsLogsNavigation, type Tab } from "./settings-logs/SettingsLogsNavigation";
import type { ExportKey } from "./settings-logs/SettingsLogsExports";

function downloadString(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 0);
}

export function SettingsLogs() {
  const settings = useSettingsStore((state) => state.settings);
  const isLoading = useSettingsStore((state) => state.isLoading);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const reducedEffects = useThemeStore((state) => state.reducedEffects);
  const setReducedEffects = useThemeStore((state) => state.setReducedEffects);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [exportingKey, setExportingKey] = useState<ExportKey | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleExport(key: ExportKey) {
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
    } catch (error) {
      setExportError(`Export failed: ${errMessage(error)}`);
    } finally {
      setExportingKey(null);
    }
  }

  return (
    <div className="settings-shell">
      <header className="settings-shell__header">
        <Icon
          icon={Settings01Icon}
          size={14}
          strokeWidth={1.75}
          style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
        />
        <span className="settings-shell__title">Settings</span>
      </header>
      <div className="settings-shell__body">
        <SettingsLogsNavigation activeTab={activeTab} onChange={setActiveTab} />
        <SettingsLogsContent
          activeTab={activeTab}
          settings={settings}
          isLoading={isLoading}
          reducedEffects={reducedEffects}
          onReducedEffectsChange={setReducedEffects}
          theme={theme}
          onThemeChange={setTheme}
          updateSettings={updateSettings}
          exportingKey={exportingKey}
          exportError={exportError}
          onExport={(key) => void handleExport(key)}
        />
      </div>
    </div>
  );
}
