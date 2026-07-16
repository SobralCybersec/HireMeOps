//! Application event bus.
//!
//! Backend features push [`AppEvent`]s to the frontend over a single Tauri
//! channel ([`EVENT_CHANNEL`]). The frontend's event store subscribes once and
//! fans out — no polling. The wire shape is deliberately transport-agnostic so
//! an SSE/WebSocket adapter can replace the Tauri channel later.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::util::{new_id, now_iso};

/// The single Tauri event name every [`AppEvent`] is emitted on.
pub const EVENT_CHANNEL: &str = "hiremeops://event";

/// Discriminant for every kind of event the backend can raise. The string
/// forms are the contract shared verbatim with the frontend's `AppEventType`.
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
    /// Authoritative automation lifecycle state for the cockpit, driven by the
    /// backend engine (never guessed optimistically by the frontend). Payload:
    /// `{ state: "<AutomationState>", taskId?: string, detail?: string }`.
    #[serde(rename = "automation.state")]
    AutomationStateChanged,
    #[serde(rename = "log")]
    Log,
}

/// A single event delivered to the UI. Field names serialize to camelCase to
/// match the TypeScript `AppEvent` interface.
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

/// Emit an [`AppEvent`] from any Tauri handle.
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
