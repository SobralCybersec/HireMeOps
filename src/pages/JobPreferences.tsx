import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Target roles",
  "Seniority",
  "Locations",
  "Remote modes",
  "Minimum salary",
  "Required skills",
  "Preferred skills",
  "Excluded keywords",
  "Blocked companies",
  "Auto-submit rules (locked defaults: 60% min score, 50% needs-review threshold)",
  "Retry rules (retry transient failures, limit 10)",
  "Search query / dork templates",
  "Rule builder (match score, duplicate URL, captcha state, required facts, answer confidence)",
];

export function JobPreferences() {
  return <PagePlaceholder title="Job Preferences" widgets={WIDGETS} />;
}
