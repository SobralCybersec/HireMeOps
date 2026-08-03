//! Application event bus: backend features push `AppEvent`s to the frontend
//! over a single Tauri channel (`EVENT_CHANNEL`); the frontend's event store
//! subscribes once and fans out, no polling.
//! Key: `AppEvent` / `AppEventType` — the event envelope and its wire-contract discriminant.
//! Key: `EventEmitter::emit_app_event()` — `AppHandle` extension used by every emitter call site.
//! Key: `EVENT_CHANNEL` — the single Tauri channel name shared with the frontend.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::util::{new_id, now_iso};

pub const EVENT_CHANNEL: &str = "hiremeops://event";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppEventType {
    #[serde(rename = "cv.import.started")]
    CvImportStarted,
    #[serde(rename = "cv.parse.progress")]
    CvParseProgress,
    #[serde(rename = "cv.analysis.done")]
    CvAnalysisDone,
    #[serde(rename = "job.search.started")]
    JobSearchStarted,
    #[serde(rename = "job.search.item_found")]
    JobSearchItemFound,
    #[serde(rename = "job.match.done")]
    JobMatchDone,
    #[serde(rename = "ai.progress")]
    AiProgress,
    #[serde(rename = "application.started")]
    ApplicationStarted,
    #[serde(rename = "application.needs_review")]
    ApplicationNeedsReview,
    #[serde(rename = "application.failed")]
    ApplicationFailed,
    #[serde(rename = "application.completed")]
    ApplicationCompleted,
    #[serde(rename = "automation.paused_for_captcha")]
    AutomationPausedForCaptcha,
    #[serde(rename = "automation.evidence_saved")]
    AutomationEvidenceSaved,
    #[serde(rename = "automation.stopped")]
    AutomationStopped,
    #[serde(rename = "automation.state")]
    AutomationStateChanged,
    #[serde(rename = "log")]
    Log,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: AppEventType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: String,
}

impl AppEvent {
    pub fn new(kind: AppEventType, payload: serde_json::Value) -> Self {
        Self {
            id: new_id(),
            kind,
            profile_id: None,
            task_id: None,
            payload,
            created_at: now_iso(),
        }
    }

    #[allow(dead_code)]
    pub fn with_profile(mut self, profile_id: impl Into<String>) -> Self {
        self.profile_id = Some(profile_id.into());
        self
    }

    #[allow(dead_code)]
    pub fn with_task(mut self, task_id: impl Into<String>) -> Self {
        self.task_id = Some(task_id.into());
        self
    }
}

pub trait EventEmitter {
    fn emit_app_event(&self, event: AppEvent);
}

impl EventEmitter for AppHandle {
    fn emit_app_event(&self, event: AppEvent) {
        if let Err(e) = self.emit(EVENT_CHANNEL, &event) {
            tracing::warn!("failed to emit app event: {e}");
        }
    }
}
