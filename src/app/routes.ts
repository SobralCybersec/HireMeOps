// Single source of truth for the app's navigation + human route titles.
// The sidebar (<AppLayout>) reads NAV_GROUPS; page components own their own
// header. `icon` is a Hugeicons SVG element - required so the collapsed rail
// still communicates each destination.

import {
  DashboardBrowsingIcon,
  UserGroupIcon,
  Layers01Icon,
  Book02Icon,
  Analytics01Icon,
  FilterIcon,
  Search01Icon,
  InboxIcon,
  BotIcon,
  Settings01Icon,
  Idea01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export interface NavItem {
  to: string;
  label: string;
  icon: IconSvgElement;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Field Desk", icon: DashboardBrowsingIcon }],
  },
  {
    label: "Identity",
    items: [
      { to: "/profiles", label: "Profiles", icon: UserGroupIcon },
      { to: "/profile-variants", label: "Variants", icon: Layers01Icon },
      { to: "/cv-library", label: "CV Library", icon: Book02Icon },
      { to: "/cv-analysis", label: "CV Analysis", icon: Analytics01Icon },
    ],
  },
  {
    label: "Search",
    items: [
      { to: "/job-preferences", label: "Preferences", icon: FilterIcon },
      { to: "/job-search", label: "Job Search", icon: Search01Icon },
    ],
  },
  {
    label: "Pipeline",
    items: [
      { to: "/applications", label: "Applications", icon: InboxIcon },
      { to: "/automation", label: "Automation", icon: BotIcon },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/settings", label: "Settings", icon: Settings01Icon },
      { to: "/tutorial", label: "Tutorial", icon: Idea01Icon },
    ],
  },
];

// Longer, page-header-friendly titles keyed by pathname.
export const ROUTE_TITLES: Record<string, string> = {
  "/": "Application Field Desk",
  "/profiles": "Profiles",
  "/profile-variants": "Profile Variants",
  "/cv-library": "CV Library",
  "/cv-analysis": "CV Analysis",
  "/job-preferences": "Job Preferences",
  "/job-search": "Job Search",
  "/applications": "Applications Queue",
  "/automation": "Automation Cockpit",
  "/settings": "Settings & Logs",
  "/tutorial": "Tutorial",
};

export function routeTitle(pathname: string): string {
  return ROUTE_TITLES[pathname] ?? "HireMeOps";
}
