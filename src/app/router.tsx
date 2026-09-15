// This module's job is to export the router config, not components. The lazy()
// page consts are route targets, not shared UI — fast-refresh's "only export
// components" rule doesn't apply to a router definition.
/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
// Command Center is the index route (first paint) - keep it eager so the
// landing view has no lazy-chunk round-trip.
import { CommandCenter } from "../pages/command-center/CommandCenter";

// Heavy / non-landing pages are code-split so they don't inflate the initial
// bundle. The named-export → default adapter lets React.lazy consume them.
// A single <Suspense> boundary in AppLayout wraps the routed <Outlet>.
// Merged Profiles + Variants workspace (animated tabs over both surfaces).
const Workspace = lazy(() =>
  import("../pages/workspace/Workspace").then((m) => ({ default: m.Workspace })),
);
const CvLibrary = lazy(() =>
  import("../pages/cv/CvLibrary").then((m) => ({ default: m.CvLibrary })),
);
const CvAnalysis = lazy(() =>
  import("../pages/cv/CvAnalysis").then((m) => ({ default: m.CvAnalysis })),
);
const JobSearch = lazy(() =>
  import("../pages/job-search/JobSearch").then((m) => ({ default: m.JobSearch })),
);
const ApplicationsQueue = lazy(() =>
  import("../pages/applications/ApplicationsQueue").then((m) => ({ default: m.ApplicationsQueue })),
);
const SettingsLogs = lazy(() =>
  import("../pages/settings-logs/SettingsLogs").then((m) => ({ default: m.SettingsLogs })),
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: "profiles", element: <Workspace /> },
      { path: "cv-library", element: <CvLibrary /> },
      { path: "cv-analysis", element: <CvAnalysis /> },
      { path: "job-search", element: <JobSearch /> },
      { path: "applications", element: <ApplicationsQueue /> },
      { path: "settings", element: <SettingsLogs /> },
    ],
  },
]);
