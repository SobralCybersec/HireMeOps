import { NavLink, Outlet } from "react-router-dom";
import { EmergencyStopButton } from "./EmergencyStopButton";
import { EventLogDrawer } from "./EventLogDrawer";

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/profiles", label: "Profiles" },
  { to: "/cv-library", label: "CV Library" },
  { to: "/cv-analysis", label: "CV Analysis" },
  { to: "/profile-variants", label: "Profile Variants" },
  { to: "/job-preferences", label: "Job Preferences" },
  { to: "/job-search", label: "Job Search" },
  { to: "/applications", label: "Applications Queue" },
  { to: "/automation", label: "Automation Cockpit" },
  { to: "/settings", label: "Settings & Logs" },
];

/** Persistent shell: sidebar nav + topbar (with Emergency Stop) + routed page + event log drawer. */
export function AppLayout() {
  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="sidebar-brand">HireMeOps</div>
        <ul className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="app-main">
        <header className="topbar">
          <span className="topbar-title">Job Application Automation</span>
          <EmergencyStopButton />
        </header>

        <div className="app-body">
          <main className="page-outlet">
            <Outlet />
          </main>
          <EventLogDrawer />
        </div>
      </div>
    </div>
  );
}
