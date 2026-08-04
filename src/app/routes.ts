// Single source of truth for the app's navigation + human route titles.
// The sidebar (<AppLayout>) reads NAV_GROUPS; page components own their own
// header. `icon` is a Hugeicons SVG element - required so the collapsed rail
// still communicates each destination.

import {
  DashboardBrowsingIcon,
  UserGroupIcon,
  Book02Icon,
  Analytics01Icon,
  Search01Icon,
  InboxIcon,
  Settings01Icon,
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
    items: [{ to: "/", label: "Command Center", icon: DashboardBrowsingIcon }],
  },
  {
    label: "Identity",
    items: [
      { to: "/profiles", label: "Profiles", icon: UserGroupIcon },
      { to: "/cv-library", label: "CV Library", icon: Book02Icon },
      { to: "/cv-analysis", label: "CV Analysis", icon: Analytics01Icon },
    ],
  },
  {
    label: "Search",
    items: [{ to: "/job-search", label: "Job Search", icon: Search01Icon }],
  },
  {
    label: "Pipeline",
    items: [{ to: "/applications", label: "Applications", icon: InboxIcon }],
  },
  {
    label: "System",
    items: [{ to: "/settings", label: "Settings", icon: Settings01Icon }],
  },
];

// Longer, page-header-friendly titles keyed by pathname.
export const ROUTE_TITLES: Record<string, string> = {
  "/": "Command Center",
  "/profiles": "Profiles & Variants",
  "/cv-library": "CV Library",
  "/cv-analysis": "CV Analysis",
  "/job-search": "Job Search",
  "/applications": "Applications Queue",
  "/settings": "Settings",
};

export function routeTitle(pathname: string): string {
  return ROUTE_TITLES[pathname] ?? "HireMeOps";
}
