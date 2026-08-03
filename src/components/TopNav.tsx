import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "./ui/Icon";
import { NAV_GROUPS } from "../app/routes";

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
              onClick={() => setOpen(false)}
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
