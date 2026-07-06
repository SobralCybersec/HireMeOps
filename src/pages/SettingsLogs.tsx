import { PagePlaceholder } from "./PagePlaceholder";

const WIDGETS = [
  "Tab: General (active profile, app language, startup behavior, portable mode)",
  "Tab: Theme & Effects (dark/light/system, reduced effects on/off/auto)",
  "Tab: AI Providers (OpenAI/Anthropic/Ollama/custom endpoint, API key storage, default model, test provider)",
  "Tab: Browser (Playwright engine, per-profile browser folder, LinkedIn session health, manual login, clear session)",
  "Tab: Data Storage (DB location/size, profiles/jobs/applications counts, open data folder)",
  "Tab: Exports (profile JSON, jobs CSV, applications CSV, audit CSV)",
  "Tab: Backups (create/restore DB backup, backup history)",
  "Tab: Cleanup (AI cache, audit logs, evidence, screenshots, DOM snapshots, unused artifacts, factory reset)",
  "Tab: Audit Logs",
  "Tab: Automation Evidence",
];

export function SettingsLogs() {
  return <PagePlaceholder title="Settings & Logs" widgets={WIDGETS} />;
}
