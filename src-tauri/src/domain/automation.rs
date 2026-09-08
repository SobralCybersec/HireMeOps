//! Browser automation supervisor: drives `automation_tasks` through a real
//! browser via `BrowserDriver`, pausing for human review at captcha walls
//! and before the final submit. Never solves captchas or auto-submits forms.
//!
//! Key: BrowserSupervisor::run_task — loads the task row, opens the browser
//!   session, and hands off to `drive`.
//! Key: BrowserSupervisor::drive — the step machine: navigate, probe, and
//!   either pause (captcha/review), complete, or abort.
//! Key: BrowserDriver — the mockable seam over the Playwright/Chromium
//!   sidecar; `MockDriver`/`HrMockDriver` substitute it in tests.
//! Key: EasyApplyInput / ApplyForm handling in `drive` — fills the Easy
//!   Apply form but always parks at `pending_review`, never auto-submits.
//! Key: generate_form_answers — drafts answers for blank Easy Apply
//!   questions from saved facts + the CV via AI.
//! Key: run_automation_queue — drains queued `apply_job` tasks through the
//!   supervisor, emitting cockpit state as it goes.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::{DomainError, DomainResult};
use crate::util::{new_id, now_iso};

#[path = "automation_answers.rs"]
mod automation_answers;
#[path = "automation_drive.rs"]
mod automation_drive;
#[path = "automation_queue.rs"]
mod automation_queue;

pub(crate) use automation_answers::generate_form_answers;
#[cfg(feature = "real-browser")]
pub use automation_queue::run_automation_queue;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomationStatus {
    Idle,
    Running,
    PausedForCaptcha,
    PausedForReview,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskOutcome {
    Completed,
    PausedForCaptcha,
    PausedForReview,
    Aborted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageState {
    CaptchaWall,
    ApplyForm,
    NoAction,
    DailyLimitReached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceKind {
    Screenshot,
    DomSnapshot,
    ConsoleLog,
    NetworkError,
    FormState,
}

impl EvidenceKind {
    fn as_str(self) -> &'static str {
        match self {
            EvidenceKind::Screenshot => "screenshot",
            EvidenceKind::DomSnapshot => "dom_snapshot",
            EvidenceKind::ConsoleLog => "console_log",
            EvidenceKind::NetworkError => "network_error",
            EvidenceKind::FormState => "form_state",
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionSpec {
    pub profile_id: String,
    pub platform: String,
    pub user_data_dir: String,
    pub extensions: Vec<String>,
    pub headless: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerField {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EasyApplyInput {
    pub url: String,
    #[serde(default = "default_platform")]
    pub platform: String,
    #[serde(default)]
    pub user_data_dir: Option<String>,
    #[serde(default)]
    pub cover_letter: Option<String>,
    #[serde(default)]
    pub cv_path: Option<String>,
    #[serde(default)]
    pub answers: Vec<AnswerField>,
    #[serde(default)]
    pub hr_name: Option<String>,
    #[serde(default)]
    pub hr_link: Option<String>,
    #[serde(default, skip_serializing)]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing)]
    pub session_id: Option<String>,
}

fn default_platform() -> String {
    "linkedin".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchJobsInput {
    pub keywords: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub page_index: u32,
    #[serde(default = "default_true")]
    pub easy_apply_only: bool,
    #[serde(default)]
    pub remote_only: bool,
    #[serde(default)]
    pub date_posted: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobCard {
    pub job_id: Option<String>,
    pub title: Option<String>,
    pub company: Option<String>,
    pub location: Option<String>,
    pub apply_url: Option<String>,
    pub is_easy_apply: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchJobsResult {
    pub jobs: Vec<JobCard>,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleResult {
    pub url: String,
    pub title: String,
    pub snippet: String,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSearchResult {
    pub results: Vec<GoogleResult>,
    #[serde(default)]
    pub blocked: bool,
    #[serde(default)]
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInPost {
    #[serde(default)]
    pub url: Option<String>,
    pub text: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedInPostsResult {
    pub posts: Vec<LinkedInPost>,
    #[serde(default)]
    pub has_next_page: bool,
}

#[allow(async_fn_in_trait)]
pub trait BrowserDriver: Send + Sync {
    async fn open(&self, spec: &SessionSpec) -> DomainResult<String>;
    async fn navigate(&self, handle: &str, url: &str) -> DomainResult<()>;
    async fn probe(&self, handle: &str) -> DomainResult<PageState>;
    async fn fill_easy_apply(&self, handle: &str, input: &EasyApplyInput) -> DomainResult<()>;
    async fn fill_easy_apply_collect(
        &self,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<Vec<serde_json::Value>> {
        self.fill_easy_apply(handle, input).await?;
        Ok(Vec::new())
    }
    async fn answer_easy_apply(
        &self,
        _handle: &str,
        _questions: &serde_json::Value,
    ) -> DomainResult<Vec<serde_json::Value>> {
        Ok(Vec::new())
    }
    async fn confirm_submit(&self, _handle: &str) -> DomainResult<bool> {
        Ok(true)
    }
    async fn screenshot(&self, handle: &str) -> DomainResult<String>;
    async fn dom_snapshot(&self, handle: &str) -> DomainResult<String>;
    async fn close(&self, handle: &str) -> DomainResult<()>;
    async fn extract_hr(&self, handle: &str) -> DomainResult<Option<String>>;
    async fn search_jobs(
        &self,
        handle: &str,
        input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult>;
}

#[allow(async_fn_in_trait)]
pub trait AutomationSupervisor: Send + Sync {
    async fn start_task(&self, automation_task_id: &str) -> DomainResult<()>;
    async fn stop_all(&self) -> DomainResult<()>;
    fn status(&self) -> AutomationStatus;
}

pub struct BrowserSupervisor<D: BrowserDriver> {
    db: SqlitePool,
    driver: D,
    stop: Arc<AtomicBool>,
    status: Mutex<AutomationStatus>,
    data_dir: PathBuf,
}

impl<D: BrowserDriver> BrowserSupervisor<D> {
    pub fn new(db: SqlitePool, driver: D, data_dir: impl Into<PathBuf>) -> Self {
        Self::with_stop_flag(db, driver, Arc::new(AtomicBool::new(false)), data_dir)
    }

    pub fn with_stop_flag(
        db: SqlitePool,
        driver: D,
        stop: Arc<AtomicBool>,
        data_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            db,
            driver,
            stop,
            status: Mutex::new(AutomationStatus::Idle),
            data_dir: data_dir.into(),
        }
    }

    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    fn set_status(&self, s: AutomationStatus) {
        *self.status.lock().expect("status mutex poisoned") = s;
    }

    #[tracing::instrument(target = "hiremeops::automation", skip(self))]
    pub async fn run_task(&self, task_id: &str) -> DomainResult<TaskOutcome> {
        let (profile_id, payload_json) = self.load_task(task_id).await?;

        self.stop.store(false, Ordering::SeqCst);
        self.set_status(AutomationStatus::Running);

        let now = now_iso();
        sqlx::query(
            "UPDATE automation_tasks
             SET status = 'running', started_at = ?1, attempts = attempts + 1, updated_at = ?1
             WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await?;

        let input = parse_payload(payload_json.as_deref())?;

        let session_id = new_id();
        self.open_session_row(&session_id, &profile_id, &input)
            .await?;

        let extensions: Vec<String> = sqlx::query_scalar::<_, String>(
            "SELECT value FROM app_settings WHERE key = 'browser_extensions'",
        )
        .fetch_optional(&self.db)
        .await?
        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default();

        let headless =
            crate::storage::settings::read_automation_headless_for(&self.db, "job_apply", false)
                .await;

        let spec = SessionSpec {
            profile_id: profile_id.clone(),
            platform: input.platform.clone(),
            user_data_dir: input.user_data_dir.clone().unwrap_or_else(|| {
                crate::storage::paths::automation_profile_dir(&self.data_dir, &profile_id)
                    .to_string_lossy()
                    .into_owned()
            }),
            extensions,
            headless,
        };

        let handle = match self.driver.open(&spec).await {
            Ok(h) => h,
            Err(e) => {
                self.fail_session_open(&session_id, task_id, &e.to_string())
                    .await;
                self.set_status(AutomationStatus::Idle);
                return Err(e);
            }
        };

        match self.drive(task_id, &input, &session_id, &handle).await {
            Ok(outcome) => Ok(outcome),
            Err(e) => {
                self.fail(&session_id, task_id, &handle, &e.to_string())
                    .await;
                Err(e)
            }
        }
    }

    async fn load_task(&self, task_id: &str) -> DomainResult<(String, Option<String>)> {
        let row = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT profile_id, payload_json FROM automation_tasks WHERE id = ?1",
        )
        .bind(task_id)
        .fetch_optional(&self.db)
        .await?;

        row.ok_or_else(|| {
            DomainError::InvalidInput(format!("automation task not found: {task_id}"))
        })
    }

    async fn update_application_outcome(
        &self,
        task_id: &str,
        session_id: &str,
        run_status: &str,
        job_status: &str,
    ) -> DomainResult<()> {
        sqlx::query(
            "UPDATE application_runs
             SET status = ?1, browser_session_id = ?2
             WHERE id = (SELECT target_id FROM automation_tasks WHERE id = ?3)",
        )
        .bind(run_status)
        .bind(session_id)
        .bind(task_id)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "UPDATE job_posts SET status = ?1
             WHERE id = (
               SELECT job_id FROM application_runs
               WHERE id = (SELECT target_id FROM automation_tasks WHERE id = ?2)
             )",
        )
        .bind(job_status)
        .bind(task_id)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn open_session_row(
        &self,
        session_id: &str,
        profile_id: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<()> {
        let now = now_iso();
        let user_data_dir = input.user_data_dir.clone().unwrap_or_else(|| {
            crate::storage::paths::automation_profile_dir(&self.data_dir, profile_id)
                .to_string_lossy()
                .into_owned()
        });
        sqlx::query(
            "INSERT INTO browser_sessions
               (id, profile_id, platform, engine, user_data_dir, status, started_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'playwright_chromium', ?4, 'open', ?5, ?5, ?5)",
        )
        .bind(session_id)
        .bind(profile_id)
        .bind(&input.platform)
        .bind(&user_data_dir)
        .bind(&now)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn record_evidence(
        &self,
        task_id: &str,
        kind: EvidenceKind,
        file_path: Option<&str>,
        content: Option<&str>,
    ) -> DomainResult<()> {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO automation_evidence
               (id, task_id, evidence_type, file_path, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(new_id())
        .bind(task_id)
        .bind(kind.as_str())
        .bind(file_path)
        .bind(content)
        .bind(&now)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn abort(&self, session_id: &str, task_id: &str, handle: &str) -> DomainResult<()> {
        let _ = self.driver.close(handle).await;
        let now = now_iso();
        sqlx::query(
            "UPDATE browser_sessions SET status = 'stopped', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "UPDATE automation_tasks
             SET status = 'queued', error = 'aborted by emergency stop', updated_at = ?1
             WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await?;
        self.set_status(AutomationStatus::Stopped);
        Ok(())
    }

    async fn fail(&self, session_id: &str, task_id: &str, handle: &str, msg: &str) {
        let _ = self.driver.close(handle).await;
        let now = now_iso();
        let _ = sqlx::query(
            "UPDATE browser_sessions SET status = 'error', last_error = ?1, ended_at = ?2, updated_at = ?2 WHERE id = ?3",
        )
        .bind(msg)
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await;
        let _ = sqlx::query(
            "UPDATE automation_tasks SET status = 'failed', error = ?1, finished_at = ?2, updated_at = ?2 WHERE id = ?3",
        )
        .bind(msg)
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await;
        self.set_status(AutomationStatus::Idle);
    }

    async fn fail_session_open(&self, session_id: &str, task_id: &str, msg: &str) {
        let now = now_iso();
        let _ = sqlx::query(
            "UPDATE browser_sessions SET status = 'error', last_error = ?1, ended_at = ?2, updated_at = ?2 WHERE id = ?3",
        )
        .bind(msg)
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await;
        let _ = sqlx::query(
            "UPDATE automation_tasks SET status = 'failed', error = ?1, finished_at = ?2, updated_at = ?2 WHERE id = ?3",
        )
        .bind(msg)
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await;
    }
}

impl<D: BrowserDriver> AutomationSupervisor for BrowserSupervisor<D> {
    async fn start_task(&self, automation_task_id: &str) -> DomainResult<()> {
        self.run_task(automation_task_id).await.map(|_| ())
    }

    async fn stop_all(&self) -> DomainResult<()> {
        self.stop.store(true, Ordering::SeqCst);
        let now = now_iso();
        sqlx::query(
            "UPDATE browser_sessions SET status = 'stopped', ended_at = ?1, updated_at = ?1 WHERE ended_at IS NULL",
        )
        .bind(&now)
        .execute(&self.db)
        .await?;
        self.set_status(AutomationStatus::Stopped);
        Ok(())
    }

    fn status(&self) -> AutomationStatus {
        *self.status.lock().expect("status mutex poisoned")
    }
}

fn parse_payload(payload: Option<&str>) -> DomainResult<EasyApplyInput> {
    let raw = payload.ok_or_else(|| {
        DomainError::InvalidInput("automation task has no payload_json".to_string())
    })?;
    serde_json::from_str(raw)
        .map_err(|e| DomainError::InvalidInput(format!("invalid apply payload: {e}")))
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct QueueRunSummary {
    pub ran: usize,
    pub completed: usize,
    pub paused: usize,
    pub aborted: usize,
    pub skipped: usize,
    pub was_empty: bool,
}

#[cfg(test)]
mod tests;
