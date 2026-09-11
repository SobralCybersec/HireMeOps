import { Fragment, type KeyboardEvent } from "react";
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
import { Icon } from "../../components/ui";

export type Tab =
  "general" | "effects" | "ai" | "browser" | "data" | "exports" | "backups" | "cleanup";

interface TabGroup {
  label: string;
  tabs: { key: Tab; label: string }[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: "Preferences",
    tabs: [
      { key: "general", label: "General" },
      { key: "effects", label: "Motion" },
    ],
  },
  {
    label: "Integrations",
    tabs: [
      { key: "ai", label: "AI Providers" },
      { key: "browser", label: "Browser" },
    ],
  },
  {
    label: "Data",
    tabs: [
      { key: "data", label: "Data Storage" },
      { key: "exports", label: "Exports" },
      { key: "backups", label: "Backups" },
      { key: "cleanup", label: "Cleanup" },
    ],
  },
];

const TABS = TAB_GROUPS.flatMap((group) => group.tabs);

const TAB_ICON_MAP: Record<Tab, IconSvgElement> = {
  general: Settings01Icon,
  effects: Moon01Icon,
  ai: Globe02Icon,
  browser: BrowserIcon,
  data: Analytics01Icon,
  exports: Download01Icon,
  backups: InboxIcon,
  cleanup: Cancel01Icon,
};

interface SettingsLogsNavigationProps {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

export function SettingsLogsNavigation({ activeTab, onChange }: SettingsLogsNavigationProps) {
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % TABS.length
        : event.key === "ArrowUp"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : TABS.length - 1;
    const nextTab = TABS[next].key;
    onChange(nextTab);
    document.getElementById(`settings-tab-${nextTab}`)?.focus();
  }

  return (
    <nav
      className="settings-shell__nav"
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
    >
      {TAB_GROUPS.map((group, groupIndex) => (
        <Fragment key={group.label}>
          {groupIndex > 0 && (
            <div className="settings-shell__nav-sep" role="separator" aria-hidden="true" />
          )}
          <div className="settings-shell__nav-group">
            <span className="settings-shell__nav-group-label">{group.label}</span>
            {group.tabs.map((tab) => {
              const tabIndex = TABS.findIndex((item) => item.key === tab.key);
              return (
                <button
                  key={tab.key}
                  id={`settings-tab-${tab.key}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  aria-controls="settings-panel"
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  className={activeTab === tab.key ? "settings-tab-btn active" : "settings-tab-btn"}
                  onClick={() => onChange(tab.key)}
                  onKeyDown={(event) => handleTabKey(event, tabIndex)}
                >
                  <span className="settings-tab-btn__icon" aria-hidden="true">
                    <Icon icon={TAB_ICON_MAP[tab.key]} size={13} strokeWidth={1.75} />
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}
    </nav>
  );
}
