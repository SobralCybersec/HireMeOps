import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Left: search filters and saved queries",
  "Center: job list",
  "Right: selected job details and match explanation",
  "Bottom: live search progress",
  "Job card fields: title, company, location, remote mode, platform, source query, dates, match score, duplicate warning, status",
  "Actions: Run LinkedIn search, Run Google dork search, Score selected, Queue selected, Skip selected, Open source URL",
];

export function JobSearch() {
  return <PagePlaceholder title="Job Search" widgets={WIDGETS} />;
}
