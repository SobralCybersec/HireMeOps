import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Current state",
  "Current task",
  "Browser session",
  "Queue",
  "Retry queue",
  "Needs-review panel",
  "Captcha/manual handoff panel",
  "Evidence viewer (screenshots, DOM snapshots, console logs, network errors, form state)",
  "Live logs",
  "Controls: Start, Pause, Resume, Stop, Emergency Stop, Run once, Dry run, Clear completed, Clear failed",
];

export function AutomationCockpit() {
  return <PagePlaceholder title="Automation Cockpit" widgets={WIDGETS} />;
}
