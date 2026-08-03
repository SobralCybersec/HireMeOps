// Shape of events streamed from the Rust backend over the "hiremeops://event"
// Tauri event channel (see lib/eventBridge.ts). The backend does not need to
// emit ALL of these on day one - the frontend just needs the union kept in
// sync as automation/CV/job features land.
export type AppEventType =
  | "profile.updated"
  | "cv.uploaded"
  | "cv.analysis.done"
  | "job.search.started"
  | "job.search.item_found"
  | "job.match.done"
  | "ai.progress"
  | "job.duplicate_skipped"
  | "application.started"
  | "application.needs_review"
  | "application.failed"
  | "application.completed"
  | "application.retry_scheduled"
  | "automation.started"
  | "automation.paused"
  | "automation.paused_for_captcha"
  | "automation.resumed"
  | "automation.evidence_saved"
  | "automation.stopped"
  | "automation.state"
  | "log";

export interface AppEvent {
  id: string;
  type: AppEventType;
  profileId?: string;
  taskId?: string;
  payload: unknown;
  createdAt: string;
}
