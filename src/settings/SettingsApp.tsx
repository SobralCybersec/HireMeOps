/** Standalone settings window shell. Content panels live in SettingsAppContent. */

import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useThemeStore } from "@/stores/useThemeStore";
import type { DockerStatus } from "@/types/domain";
import { errMessage, invokeStrict, safeInvoke } from "@/lib/tauriInvoke";
import { WindowControls } from "./WindowControls";
import { SettingsNav } from "./SettingsNav";
import { isSettingsTab, readInitialTab, type SettingsTab } from "./settingsTabModel";
import { SettingsAppContent } from "./SettingsAppContent";
import { type SettingsExportKey } from "./SettingsExportCards";
import { IS_TAURI, IS_MAC } from "./platform";

function useSettingsTabListener(setActive: (tab: SettingsTab) => void) {
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlistenPromise = getCurrentWebviewWindow().listen<string>(
      "hiremeops:settings-tab",
      (event) => {
        if (isSettingsTab(event.payload)) setActive(event.payload);
      },
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [setActive]);
}

function useDockerStatus(
  active: SettingsTab,
  dockerLoaded: boolean,
  setDockerOptIn: (enabled: boolean) => void,
  setDockerLoaded: (loaded: boolean) => void,
) {
  useEffect(() => {
    if (active !== "browser" || dockerLoaded) return;
    void safeInvoke<DockerStatus>("docker_status").then((status) => {
      if (status) setDockerOptIn(status.optIn);
      setDockerLoaded(true);
    });
  }, [active, dockerLoaded, setDockerLoaded, setDockerOptIn]);
}

function useSettingsExport() {
  const [exportingKey, setExportingKey] = useState<SettingsExportKey | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(async (key: SettingsExportKey) => {
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
  }, []);

  return { exportingKey, exportError, handleExport };
}

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

export function SettingsApp() {
  const [active, setActive] = useState<SettingsTab>(readInitialTab);
  const settings = useSettingsStore((state) => state.settings);
  const isLoading = useSettingsStore((state) => state.isLoading);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const reducedEffects = useThemeStore((state) => state.reducedEffects);
  const theme = useThemeStore((state) => state.theme);
  const [dockerOptIn, setDockerOptIn] = useState(false);
  const [dockerLoaded, setDockerLoaded] = useState(false);
  const { exportingKey, exportError, handleExport } = useSettingsExport();

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useSettingsTabListener(setActive);
  useDockerStatus(active, dockerLoaded, setDockerOptIn, setDockerLoaded);

  const handleDockerToggle = useCallback(async (enabled: boolean) => {
    setDockerOptIn(enabled);
    try {
      await invokeStrict<void>("set_docker_worker", { enabled });
    } catch {
      setDockerOptIn(!enabled);
    }
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground select-none">
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
      <main className="flex min-h-0 flex-1 flex-row">
        <SettingsNav active={active} onChange={setActive} />
        <SettingsAppContent
          active={active}
          settings={settings}
          isLoading={isLoading}
          theme={theme}
          reducedEffects={reducedEffects}
          updateSettings={updateSettings}
          dockerOptIn={dockerOptIn}
          onDockerToggle={(enabled) => void handleDockerToggle(enabled)}
          exportingKey={exportingKey}
          exportError={exportError}
          onExport={(key) => void handleExport(key)}
        />
      </main>
    </div>
  );
}
