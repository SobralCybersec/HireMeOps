import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./ui/Icon";
import { NAV_GROUPS } from "../app/routes";
import { useThemeStore } from "../stores/useThemeStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { openSettingsWindow, IS_TAURI } from "../lib/openSettingsWindow";
import "./TopNav.css";

/**
 * Primary navigation rail. Keeps route, theme, and settings behavior in one
 * place while exposing labels beside the existing Hugeicons.
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

  useEffect(() => {
    document.documentElement.classList.toggle("nav-open", open);
    document.documentElement.classList.toggle("sidebar-collapsed", open);
    return () => {
      document.documentElement.classList.remove("nav-open");
      document.documentElement.classList.remove("sidebar-collapsed");
    };
  }, [open]);

  return (
    <nav
      className={open ? "hud-rail hud-rail--collapsed" : "hud-rail"}
      aria-label="Primary navigation"
    >
      <header className="hud-rail__head">
        <button
          type="button"
          className={open ? "hud-burger hud-burger--open" : "hud-burger"}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!open}
        >
          <span className="hud-burger__bar" />
          <span className="hud-burger__bar" />
          <span className="hud-burger__bar" />
        </button>
        {!open && <span className="hud-rail__brand">HireMeOps</span>}
      </header>

      {!open && (
        <div className="hud-rail__ident">
          <span className="hud-rail__ident-key">Workspace</span>
          <span className="hud-rail__ident-val">Command Center</span>
        </div>
      )}

      <div className="hud-nav">
        {NAV_GROUPS.map((group) => (
          <section className="hud-nav__group" key={group.label}>
            {!open && <span className="hud-nav__label">{group.label}</span>}
            <ul>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    title={item.label}
                    aria-label={item.label}
                    onClick={(e) => {
                      if (item.to === "/settings" && IS_TAURI) {
                        e.preventDefault();
                        void openSettingsWindow();
                      }
                      setOpen(false);
                    }}
                    className={({ isActive }) =>
                      isActive ? "hud-nav__link hud-nav__link--active" : "hud-nav__link"
                    }
                  >
                    <Icon icon={item.icon} size={18} />
                    {!open && <span>{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className="hud-rail__foot">
        <button
          type="button"
          className="hud-rail__theme"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={isDark}
          title={isDark ? "Light theme" : "Dark theme"}
        >
          <Icon icon={isDark ? Sun01Icon : Moon01Icon} size={16} />
          {!open && <span>{isDark ? "Light theme" : "Dark theme"}</span>}
        </button>
      </footer>
    </nav>
  );
}
