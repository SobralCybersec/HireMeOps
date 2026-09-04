import {
  Analytics01Icon,
  BrowserIcon,
  Cancel01Icon,
  Download01Icon,
  Globe02Icon,
  InboxIcon,
  Moon01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export type SettingsTab =
  "general" | "effects" | "ai" | "browser" | "data" | "exports" | "backups" | "cleanup";

interface TabDef {
  key: SettingsTab;
  label: string;
  icon: IconSvgElement;
}

interface TabGroup {
  label: string;
  tabs: TabDef[];
}

export const SETTINGS_TAB_GROUPS: TabGroup[] = [
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

export const SETTINGS_TABS = SETTINGS_TAB_GROUPS.flatMap((group) => group.tabs);

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

export function readInitialTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const tab = new URL(window.location.href).searchParams.get("tab");
  return tab && isSettingsTab(tab) ? tab : "general";
}
