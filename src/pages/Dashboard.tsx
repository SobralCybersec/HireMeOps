import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Active Profile",
  "Browser Session Status",
  "Automation Status",
  "Applications Today",
  "Jobs Discovered",
  "Needs Review",
  "Duplicate URL Skips",
  "Failed Applications",
  "Chart: Applications/day",
  "Chart: Match score distribution",
  "Chart: Platform success rate",
  "Chart: Failure reasons",
  "Primary actions: Start / Pause / Emergency stop / Open needs-review / Open latest failure evidence",
  "Live event feed",
];

export function Dashboard() {
  return <PagePlaceholder title="Dashboard" widgets={WIDGETS} />;
}
