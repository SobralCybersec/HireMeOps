// Single source of truth for the app's navigation + human route titles.
// Both the sidebar (<AppLayout>) and the top command bar (<TopCommandBar>)
// read from here so a new page is wired in exactly one place.

export interface NavItem {
  to: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard" }],
  },
  {
    label: "Identity",
    items: [
      { to: "/profiles", label: "Profiles" },
      { to: "/profile-variants", label: "Variants" },
      { to: "/cv-library", label: "CV Library" },
      { to: "/cv-analysis", label: "CV Analysis" },
    ],
  },
  {
    label: "Search",
    items: [
      { to: "/job-preferences", label: "Preferences" },
      { to: "/job-search", label: "Job Search" },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { to: "/applications", label: "Applications" },
      { to: "/automation", label: "Automation" },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings" }],
  },
];

// Longer, page-header-friendly titles keyed by pathname.
export const ROUTE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/profiles": "Profiles",
  "/profile-variants": "Profile Variants",
  "/cv-library": "CV Library",
  "/cv-analysis": "CV Analysis",
  "/job-preferences": "Job Preferences",
  "/job-search": "Job Search",
  "/applications": "Applications Queue",
  "/automation": "Automation Cockpit",
  "/settings": "Settings & Logs",
};

export function routeTitle(pathname: string): string {
  return ROUTE_TITLES[pathname] ?? "HireMeOps";
}
