import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Variant list (e.g. Java Backend Developer, Fullstack Developer, Rust Developer, Cybersecurity Analyst, DevOps Junior)",
  "Variant editor tab: Headline",
  "Variant editor tab: Summary",
  "Variant editor tab: Keywords",
  "Variant editor tab: Preferred CV",
  "Variant editor tab: Skills order",
  "Variant editor tab: Projects priority",
  "Variant editor tab: Experience bullets",
  "Actions: Create, Duplicate, Generate from CV, Assign preferred CV, Analyze against job, Delete",
];

export function ProfileVariants() {
  return <PagePlaceholder title="Profile Variants" widgets={WIDGETS} />;
}
