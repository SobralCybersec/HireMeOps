import { useLocation } from "react-router-dom";
import { EmergencyStopButton } from "./EmergencyStopButton";
import {
  AutomationStatusBadge,
  BrowserSessionBadge,
} from "./ui";
import { routeTitle } from "../app/routes";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useThemeStore } from "../stores/useThemeStore";
import type { ReducedEffectsMode, ThemeMode } from "../types/settings";

const THEME_CYCLE: Record<ThemeMode, ThemeMode> = {
  dark: "light",
  light: "system",
  system: "dark",
};
const THEME_GLYPH: Record<ThemeMode, string> = {
  dark: "◐ dark",
  light: "◑ light",
  system: "◎ system",
};

const FX_CYCLE: Record<ReducedEffectsMode, ReducedEffectsMode> = {
  auto: "on",
  on: "off",
  off: "auto",
};
const FX_LABEL: Record<ReducedEffectsMode, string> = {
  auto: "auto",
  on: "on",
  off: "off",
};

/**
 * The persistent top command bar (frontend spec §3.3): route context on the
 * left, live session/automation status in the middle, global controls on the
 * right. Data-light items (variant / browser / LinkedIn) are presentational
 * seams — they render real state the moment their stores are wired.
 */
export function TopCommandBar() {
  const location = useLocation();

  const autoState = useAutomationStore((s) => s.state);
  const eventCount = useEventStore((s) => s.events.length);

  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const settingsActiveId = useSettingsStore((s) => s.settings?.activeProfileId ?? null);

  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const reducedEffects = useThemeStore((s) => s.reducedEffects);
  const setReducedEffects = useThemeStore((s) => s.setReducedEffects);

  const resolvedProfileId = activeProfileId ?? settingsActiveId;
  const activeProfile = profiles.find((p) => p.id === resolvedProfileId) ?? null;
  const profileName = activeProfile?.name ?? "No profile";

  const pageTitle = routeTitle(location.pathname);

  return (
    <header className="topbar">
      {/* ---- Left: route context ---- */}
      <span className="topbar-route">{pageTitle}</span>
      <span className="topbar-sep" aria-hidden="true">·</span>

      {/* ---- Identity cluster ---- */}
      <div className="topbar-cluster">
        <span className="topbar-chip" title={`Active profile: ${profileName}`}>
          <span className="topbar-chip__key">Profile</span>
          <span className="topbar-chip__val">{profileName}</span>
        </span>
        <span
          className="topbar-chip"
          title="Active variant — wired once the variant store lands"
        >
          <span className="topbar-chip__key">Variant</span>
          <span className="topbar-chip__val">Base</span>
        </span>
      </div>

      {/* ---- Session cluster ---- */}
      <div className="topbar-cluster">
        <BrowserSessionBadge label="Browser" />
        <BrowserSessionBadge label="LinkedIn" />
        <div
          className="topbar-chip"
          aria-label={`Automation state: ${autoState}`}
          style={{ padding: "0 var(--sp-2)" }}
        >
          <AutomationStatusBadge state={autoState} bare />
        </div>
      </div>

      <div className="topbar-spacer" />

      {/* ---- Global controls ---- */}
      <span
        className="topbar-event-badge"
        aria-label={`${eventCount} events logged`}
      >
        {eventCount} evt
      </span>

      <button
        type="button"
        className="topbar-toggle"
        onClick={() => setTheme(THEME_CYCLE[theme])}
        aria-label={`Theme: ${theme}. Activate to switch.`}
        title={`Theme: ${theme} (click to cycle)`}
      >
        {THEME_GLYPH[theme]}
      </button>

      <button
        type="button"
        className="topbar-toggle"
        onClick={() => setReducedEffects(FX_CYCLE[reducedEffects])}
        aria-pressed={reducedEffects === "on"}
        aria-label={`Reduced effects: ${reducedEffects}. Activate to cycle.`}
        title={`Reduced effects: ${reducedEffects} (click to cycle)`}
      >
        FX:{FX_LABEL[reducedEffects]}
      </button>

      <EmergencyStopButton />
    </header>
  );
}
