import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Top bar: Upload PDF, Upload DOCX, Import manual profile, Search CVs, Filter by profile/variant/status",
  "CV card grid with first-page preview thumbnails",
  "Active CV badges",
  "Assigned role variant badges",
  "Last analysis score / last used date",
  "Right inspector: metadata, assigned variants, match usage, actions",
  "CV Viewer: toolbar, page thumbnails rail, main PDF/DOCX renderer, metadata panel",
  "Re-parse / Re-analyze / Delete CV",
];

export function CvLibrary() {
  return <PagePlaceholder title="CV Library" widgets={WIDGETS} />;
}
