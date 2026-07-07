import { NavLink, Outlet } from "react-router-dom";
import { TopCommandBar } from "./TopCommandBar";
import { EventLogDrawer } from "./EventLogDrawer";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useEventStore } from "../stores/useEventStore";
import { NAV_GROUPS } from "../app/routes";
import { humanizeStatus } from "./ui";

export function AppLayout() {
  const autoState = useAutomationStore((s) => s.state);
  const eventCount = useEventStore((s) => s.events.length);

  return (
    <div className="app-shell">
      {/* ---- Sidebar (frontend spec §3.2) ---- */}
      <nav className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-header">
          <span className="sidebar-brand">HireMeOps</span>
        </div>

        <ul className="sidebar-nav" role="list">
          {NAV_GROUPS.map((group) => (
            <li key={group.label} className="nav-group">
              <span className="nav-group-label" aria-hidden="true">
                {group.label}
              </span>
              <ul role="list">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        isActive ? "nav-link active" : "nav-link"
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* ---- Main area ---- */}
      <div className="app-main">
        <TopCommandBar />

        {/* Body */}
        <div className="app-body">
          <main
            className="page-outlet"
            id="main-content"
            tabIndex={-1}
            aria-label="Page content"
          >
            <Outlet />
          </main>
          <EventLogDrawer />
        </div>

        {/* Status strip */}
        <div
          className="status-strip"
          role="status"
          aria-live="polite"
          aria-atomic="false"
        >
          <span>STATE: {humanizeStatus(autoState)}</span>
          <span className="status-strip-sep" aria-hidden="true">|</span>
          <span>{eventCount} events</span>
          <span className="status-strip-sep" aria-hidden="true">|</span>
          <span>
            <kbd className="status-strip-kbd">Ctrl+Shift+S</kbd>
            {" "}emergency stop
          </span>
        </div>
      </div>
    </div>
  );
}
