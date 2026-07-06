import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "CV selector",
  "Variant selector",
  "Analysis score",
  "Optimization needed / not needed",
  "Strengths",
  "Weaknesses",
  "Missing keywords",
  "Recommended changes",
  "Role compatibility",
  "AI provider used",
  "Analysis history",
  "Actions: Run analysis, Compare analyses, Generate optimization suggestions, Accept suggestion, Export analysis JSON",
];

export function CvAnalysis() {
  return <PagePlaceholder title="CV Analysis" widgets={WIDGETS} />;
}
