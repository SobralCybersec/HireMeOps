import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Profile list",
  "Profile editor",
  "Profile facts (salary min/currency/period, work authorization, visa sponsorship, start date, relocation, English level)",
  "Links",
  "Work authorization",
  "Salary expectations",
  "Language levels",
  "Browser session binding",
  "Delete profile (cascades: DB rows, copied CVs, evidence files, browser profile folder)",
];

export function Profiles() {
  return <PagePlaceholder title="Profiles" widgets={WIDGETS} />;
}
