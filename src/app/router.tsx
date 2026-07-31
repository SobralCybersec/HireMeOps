import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
// Command Center is the index route (first paint) - keep it eager so the
// landing view has no lazy-chunk round-trip.
import { CommandCenter } from "../pages/CommandCenter";

// Heavy / non-landing pages are code-split so they don't inflate the initial
// bundle. The named-export → default adapter lets React.lazy consume them.
// A single <Suspense> boundary in AppLayout wraps the routed <Outlet>.
// Merged Profiles + Variants workspace (animated tabs over both surfaces).
const Workspace = lazy(() => import("../pages/Workspace").then((m) => ({ default: m.Workspace })));
const CvLibrary = lazy(() => import("../pages/CvLibrary").then((m) => ({ default: m.CvLibrary })));
const CvAnalysis = lazy(() =>
  import("../pages/CvAnalysis").then((m) => ({ default: m.CvAnalysis })),
);
const JobSearch = lazy(() => import("../pages/JobSearch").then((m) => ({ default: m.JobSearch })));
const ApplicationsQueue = lazy(() =>
  import("../pages/ApplicationsQueue").then((m) => ({ default: m.ApplicationsQueue })),
);
const SettingsLogs = lazy(() =>
  import("../pages/SettingsLogs").then((m) => ({ default: m.SettingsLogs })),
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
