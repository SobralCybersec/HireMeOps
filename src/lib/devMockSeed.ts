import type { JobFilters } from "../types/domain";
import type { AppEvent, AppEventType } from "../types/events";
import { useAutomationStore } from "../stores/automation/useAutomationStore";
import { useEventStore } from "../stores/system/useEventStore";
import { useJobFiltersStore } from "../stores/jobs/useJobFiltersStore";
import { isMockEnabled } from "./devMocks";

const MOCK_JOB_FILTERS: JobFilters = {
  targetRoles: ["Frontend Engineer", "Full-Stack Engineer", "UI Engineer"],
  seniority: ["Senior", "Staff"],
  locations: ["Berlin", "Amsterdam", "Remote (EU)"],
  remoteModes: ["Remote", "Hybrid"],
  minSalary: 85000,
  requiredSkills: ["TypeScript", "React", "Rust"],
  preferredSkills: ["Tauri", "GraphQL", "WebAssembly"],
  excludedKeywords: ["unpaid", "internship", "clearance required"],
  blockedCompanies: ["Acme Staffing", "QuickHire Recruiting"],
};

function event(
  type: AppEventType,
  payload: unknown,
  minutesAgo: number,
  extra?: Partial<AppEvent>,
): AppEvent {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ...extra,
  };
}

const MOCK_EVENTS: AppEvent[] = [
  event("automation.started", { message: "Automation run started" }, 12, { taskId: "task-9f3a" }),
  event("job.search.started", { platform: "LinkedIn", query: "Frontend Engineer" }, 11),
  event("job.search.item_found", { title: "Senior Frontend Engineer", company: "Vercel" }, 10),
  event("job.match.done", { title: "Senior Frontend Engineer", score: 0.91 }, 9),
  event("cv.analysis.done", { fileName: "resume-frontend.pdf", score: 0.87 }, 8),
  event("application.started", { company: "Vercel" }, 6, { taskId: "task-9f3a" }),
  event("application.needs_review", { company: "Linear", reason: "Custom question" }, 4),
  event("automation.paused_for_captcha", { platform: "Workday" }, 3),
  event("automation.resumed", { message: "Resumed after captcha" }, 2),
  event("application.completed", { company: "Vercel" }, 1, { taskId: "task-9f3a" }),
];

let seeded = false;

export function seedDevState(): void {
  if (!isMockEnabled() || seeded) return;
  seeded = true;

  const addEvent = useEventStore.getState().addEvent;
  for (const item of MOCK_EVENTS) addEvent(item);

  useAutomationStore.setState({ state: "Searching", currentTaskId: "task-9f3a" });
  useJobFiltersStore.setState({ filters: MOCK_JOB_FILTERS });
}
