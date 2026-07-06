import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Queued applications",
  "Needs-review applications",
  "Submitted applications",
  "Failed applications",
  "Skipped duplicates",
  "Application detail drawer (job, company, platform, CV, variant, match score, generated answers, retry count, evidence)",
  "Actions: Approve needs-review, Edit answer, Retry now, Cancel, Open evidence, Export CSV",
];

export function ApplicationsQueue() {
  return <PagePlaceholder title="Applications Queue" widgets={WIDGETS} />;
}
