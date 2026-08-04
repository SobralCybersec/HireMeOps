import type { JobFilters, Profile } from "../types/domain";
import type { AppSettings } from "../types/settings";
import type { AppEvent, AppEventType } from "../types/events";
import { useEventStore } from "../stores/useEventStore";
import { useAutomationStore } from "../stores/useAutomationStore";
import { useJobFiltersStore } from "../stores/useJobFiltersStore";
import { MOCK_LIBRARY, MOCK_HISTORY } from "../pages/cv/mockData";

/**
 * Dev-only mock data layer used for capturing UI screenshots in a plain
 * browser (Vite dev) where no Tauri backend exists. Every store-backed page
 * would otherwise render empty because `safeInvoke` returns null off-Tauri.
 *
 * ENTIRELY inert in production and inside the real Tauri runtime - see
 * `isMockEnabled()`. Nothing here ships to the desktop app.
 */

export function isMockEnabled(): boolean {
  return (
    import.meta.env.DEV &&
    import.meta.env.VITE_ENABLE_MOCKS === "true" &&
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in window)
  );
}

const MOCK_PROFILES: Profile[] = [
  { id: "prof-1", name: "Senior Frontend Engineer", isActive: true },
  { id: "prof-2", name: "Full-Stack Engineer - Remote EU", isActive: false },
  { id: "prof-3", name: "Staff Engineer - Platform", isActive: false },
];

const MOCK_SETTINGS: AppSettings = {
  activeProfileId: "prof-1",
  appLanguage: "en",
  startupBehavior: "normal",
  portableMode: false,
  theme: "dark",
  reducedEffects: "auto",
  aiProviders: [
    {
      kind: "browser",
      label: "Browser (free)",
      endpointUrl: "",
      apiKeyStored: false,
      authKind: "api_key",
      defaultModel: "chatgpt/gpt-5",
    },
  ],
  defaultAiProviderIndex: 0,
  browserProfileRootPath: "/home/satu/.hiremeops/browser-profiles",
  databasePath: "/home/satu/.hiremeops/hiremeops.db",
  auditLogRetentionDays: 90,
  automationEvidenceRetentionDays: 30,
  browserExtensions: [],
  automationHeadless: true,
  automationHeadlessOverrides: {},
  aiAutoInit: true,
};

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

// Search / dork templates. The page keeps these in local state until the store
// grows a field for them, so it reads this seed via `mockSearchTemplates()`.
const MOCK_SEARCH_TEMPLATES: string[] = [
  'site:linkedin.com/jobs ("Senior Frontend" OR "Staff Engineer") (React OR TypeScript) Berlin',
  'site:boards.greenhouse.io "Rust" remote europe -clearance',
  '("Frontend Engineer" OR "UI Engineer") Tauri OR WebAssembly -internship',
];

/** Seed for JobPreferences' local template state - `[]` unless mocks are on. */
export function mockSearchTemplates(): string[] {
  return isMockEnabled() ? [...MOCK_SEARCH_TEMPLATES] : [];
}

/**
 * Builds a tiny but structurally-valid single-page PDF (with a correct xref
 * table computed from real byte offsets) so pdf.js has something to render for
 * the CV preview off-Tauri. ASCII-only to keep byte offsets == string indices.
 */
function buildMockPdf(title: string): Uint8Array {
  const enc = new TextEncoder();
  const stream =
    `BT /F1 28 Tf 60 720 Td (${title}) Tj ` +
    `0 -40 Td /F1 14 Tf (Mock CV preview - dev screenshot build) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets[i] = enc.encode(pdf).length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = enc.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;

  return enc.encode(pdf);
}

// CV bytes keyed by id - only the `.pdf` doc (`cv1`) has a renderable preview;
// the `.docx` (`cv2`) intentionally has none, matching real-world behavior.
const MOCK_CV_BYTES: Record<string, Uint8Array> = {
  cv1: buildMockPdf("cv_rust_2025.pdf"),
};

/**
 * Returns a mocked response for a backend command, or `undefined` if the
 * command has no mock (in which case `safeInvoke` falls through to the real
 * invoke, which off-Tauri simply returns null).
 */
export function getMockResponse<T>(command: string, args?: Record<string, unknown>): T | undefined {
  switch (command) {
    case "list_profiles":
      return MOCK_PROFILES as unknown as T;
    case "get_settings":
      return MOCK_SETTINGS as unknown as T;
    case "list_cv_documents":
      return MOCK_LIBRARY as unknown as T;
    case "list_cv_analysis_reports":
      return MOCK_HISTORY as unknown as T;
    case "cv_read_bytes": {
      const cvId = typeof args?.cvId === "string" ? args.cvId : "";
      const bytes = MOCK_CV_BYTES[cvId];
      // Known-but-previewless ids resolve to null; unknown ids fall through.
      if (cvId === "cv1" || cvId === "cv2") {
        return (bytes ?? null) as unknown as T;
      }
      return undefined;
    }
    case "update_settings":
    case "automation_start":
    case "automation_pause":
    case "automation_resume":
    case "automation_stop":
    case "automation_emergency_stop":
      return null as unknown as T;
    default:
      return undefined;
  }
}

function evt(
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

// Oldest last so that the store's newest-first buffer reads naturally.
const MOCK_EVENTS: AppEvent[] = [
  evt("automation.started", { message: "Automation run started" }, 12, { taskId: "task-9f3a" }),
  evt("job.search.started", { platform: "LinkedIn", query: "Frontend Engineer" }, 11),
  evt("job.search.item_found", { title: "Senior Frontend Engineer", company: "Vercel" }, 10),
  evt("job.match.done", { title: "Senior Frontend Engineer", score: 0.91 }, 9),
  evt("cv.analysis.done", { fileName: "resume-frontend.pdf", score: 0.87 }, 8),
  evt("application.started", { company: "Vercel" }, 6, { taskId: "task-9f3a" }),
  evt("application.needs_review", { company: "Linear", reason: "Custom question" }, 4),
  evt("automation.paused_for_captcha", { platform: "Workday" }, 3),
  evt("automation.resumed", { message: "Resumed after captcha" }, 2),
  evt("application.completed", { company: "Vercel" }, 1, { taskId: "task-9f3a" }),
];

let seeded = false;

/** Seeds the event buffer and automation state so live-data pages look real. */
export function seedDevState(): void {
  if (!isMockEnabled() || seeded) return;
  seeded = true;

  const addEvent = useEventStore.getState().addEvent;
  for (const e of MOCK_EVENTS) addEvent(e);

  useAutomationStore.setState({
    state: "Searching",
    currentTaskId: "task-9f3a",
  });

  // Populate the Job Preferences form so its filter fields render non-empty.
  useJobFiltersStore.setState({ filters: MOCK_JOB_FILTERS });
}
