import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
// Dashboard is the index route (first paint) - keep it eager so the landing
// view has no lazy-chunk round-trip.
import { Dashboard } from "../pages/Dashboard";

// Heavy / non-landing pages are code-split so they don't inflate the initial
// bundle. The named-export → default adapter lets React.lazy consume them.
// A single <Suspense> boundary in AppLayout wraps the routed <Outlet>.
const Profiles = lazy(() => import("../pages/Profiles").then((m) => ({ default: m.Profiles })));
const CvLibrary = lazy(() => import("../pages/CvLibrary").then((m) => ({ default: m.CvLibrary })));
const CvAnalysis = lazy(() =>
  import("../pages/CvAnalysis").then((m) => ({ default: m.CvAnalysis })),
);
const ProfileVariants = lazy(() =>
  import("../pages/ProfileVariants").then((m) => ({ default: m.ProfileVariants })),
);
const JobPreferences = lazy(() =>
  import("../pages/JobPreferences").then((m) => ({ default: m.JobPreferences })),
);
const JobSearch = lazy(() => import("../pages/JobSearch").then((m) => ({ default: m.JobSearch })));
const ApplicationsQueue = lazy(() =>
  import("../pages/ApplicationsQueue").then((m) => ({ default: m.ApplicationsQueue })),
);
const AutomationCockpit = lazy(() =>
  import("../pages/AutomationCockpit").then((m) => ({ default: m.AutomationCockpit })),
);
const SettingsLogs = lazy(() =>
  import("../pages/SettingsLogs").then((m) => ({ default: m.SettingsLogs })),
);
const Tutorial = lazy(() => import("../pages/Tutorial").then((m) => ({ default: m.Tutorial })));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "profiles", element: <Profiles /> },
      { path: "cv-library", element: <CvLibrary /> },
      { path: "cv-analysis", element: <CvAnalysis /> },
      { path: "profile-variants", element: <ProfileVariants /> },
      { path: "job-preferences", element: <JobPreferences /> },
      { path: "job-search", element: <JobSearch /> },
      { path: "applications", element: <ApplicationsQueue /> },
      { path: "automation", element: <AutomationCockpit /> },
      { path: "settings", element: <SettingsLogs /> },
      { path: "tutorial", element: <Tutorial /> },
    ],
  },
]);
