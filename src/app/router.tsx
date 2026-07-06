import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { Dashboard } from "../pages/Dashboard";
import { Profiles } from "../pages/Profiles";
import { CvLibrary } from "../pages/CvLibrary";
import { CvAnalysis } from "../pages/CvAnalysis";
import { ProfileVariants } from "../pages/ProfileVariants";
import { JobPreferences } from "../pages/JobPreferences";
import { JobSearch } from "../pages/JobSearch";
import { ApplicationsQueue } from "../pages/ApplicationsQueue";
import { AutomationCockpit } from "../pages/AutomationCockpit";
import { SettingsLogs } from "../pages/SettingsLogs";

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
    ],
  },
]);
