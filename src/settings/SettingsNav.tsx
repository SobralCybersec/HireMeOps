import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { SETTINGS_TAB_GROUPS, SETTINGS_TABS, type SettingsTab } from "./settingsTabModel";

interface SettingsNavProps {
  active: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

function tabIndex(key: SettingsTab) {
  return SETTINGS_TABS.findIndex((tab) => tab.key === key);
}

function useTabNavigation(onChange: SettingsNavProps["onChange"]) {
  return (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % SETTINGS_TABS.length
        : event.key === "ArrowUp"
          ? (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
          : event.key === "Home"
            ? 0
            : SETTINGS_TABS.length - 1;
    const tab = SETTINGS_TABS[next].key;
    onChange(tab);
    document.getElementById(`stab-${tab}`)?.focus();
  };
}

export function SettingsNav({ active, onChange }: SettingsNavProps) {
  const onKeyDown = useTabNavigation(onChange);
  return (
    <nav
      className="w-48 shrink-0 border-r border-border/60 bg-card/35 p-2"
      role="tablist"
      aria-label="Settings sections"
      aria-orientation="vertical"
    >
      <div className="flex flex-col gap-3">
        {SETTINGS_TAB_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            {groupIndex > 0 && (
              <div className="h-px bg-border/50" role="separator" aria-hidden="true" />
            )}
            <span className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
              {group.label}
            </span>
            {group.tabs.map((tab) => (
              <button
                key={tab.key}
                id={`stab-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={active === tab.key}
                aria-controls="settings-panel"
                tabIndex={active === tab.key ? 0 : -1}
                onClick={() => onChange(tab.key)}
                onKeyDown={(event) => onKeyDown(event, tabIndex(tab.key))}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors",
                  active === tab.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/45 hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={tab.icon} size={14} strokeWidth={1.75} />
                <span className="truncate">{tab.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
