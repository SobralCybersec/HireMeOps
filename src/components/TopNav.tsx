import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./ui/Icon";
import { NAV_GROUPS } from "../app/routes";
import { useThemeStore } from "../stores/useThemeStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { openSettingsWindow, IS_TAURI } from "../lib/openSettingsWindow";

// Flatten the grouped nav — the bar shows every destination as one icon.
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * Top navigation: a single hamburger pinned top-right on a transparent bar. It
 * expands the destinations into a horizontal line of icons that fan out
 * right-to-left from the button (active route highlighted, labels in the
 * tooltip/aria). Lives as the shell's first grid row so page content sits below
 * it. Closes on Escape or after picking a destination.
 */
export function TopNav() {
  const [open, setOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const isDark = theme !== "light";

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    // Persist through the settings round-trip so the choice survives restarts.
    void useSettingsStore.getState().updateSettings({ theme: next });
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // While open, mark the root so the shell reserves the bar's height (content
  // slides down clear of the icons). Closed → no reserved space, page is full.
  useEffect(() => {
    document.documentElement.classList.toggle("nav-open", open);
    return () => document.documentElement.classList.remove("nav-open");
  }, [open]);

  return (
    <nav className={open ? "topnav topnav--open" : "topnav"} aria-label="Primary navigation">
      <ul className={open ? "topnav__list topnav__list--open" : "topnav__list"} role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              title={item.label}
              aria-label={item.label}
              tabIndex={open ? 0 : -1}
              onClick={(e) => {
                // In the desktop app, Settings opens its own window (1:1 terax);
                // in browser-preview it falls through to the in-app /settings route.
                if (item.to === "/settings" && IS_TAURI) {
                  e.preventDefault();
                  void openSettingsWindow();
                }
                setOpen(false);
              }}
              className={({ isActive }) =>
                isActive ? "topnav__link topnav__link--active" : "topnav__link"
              }
            >
              <Icon icon={item.icon} size={19} />
            </NavLink>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="topnav__theme-toggle"
        onClick={toggleTheme}
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        aria-pressed={isDark}
        title={isDark ? "Light theme" : "Dark theme"}
      >
        <Icon icon={isDark ? Sun01Icon : Moon01Icon} size={16} />
      </button>

      <button
        type="button"
        className={open ? "topnav__burger topnav__burger--open" : "topnav__burger"}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
      >
        <span className="topnav__burger-bar" />
        <span className="topnav__burger-bar" />
        <span className="topnav__burger-bar" />
      </button>
    </nav>
  );
}
