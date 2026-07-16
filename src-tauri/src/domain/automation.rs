//! Browser automation supervisor (Phase 5).
//!
//! Owns `browser_sessions`, captures `automation_evidence`, and pauses for
//! human intervention on captcha/anti-bot walls and before the final submit
//! (assist-and-pause). The supervisor subscribes to an emergency-stop latch so
//! an in-flight task can be aborted immediately.
//!
//! # Non-negotiable safety rule
//! This code **never** attempts to solve, bypass, or defeat a captcha or
//! anti-bot wall. When one is detected it captures evidence, marks the session
//! `paused_captcha`, leaves the browser open, and hands control to the human.
//! Likewise, a filled LinkedIn "Easy Apply" form is **never** submitted
//! automatically — the flow stops at `pending_review` for the user to confirm.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::{DomainError, DomainResult};
use crate::util::{new_id, now_iso};

/// Supervisor lifecycle state, surfaced to the UI status indicator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomationStatus {
    Idle,
    Running,
    /// Stopped at a captcha/anti-bot wall — waiting for the human. Never bypassed.
    PausedForCaptcha,
    /// A form is filled and waiting for the user to confirm the final submit.
    PausedForReview,
    Stopped,
}

/// Terminal outcome of running a single automation task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskOutcome {
    /// Reached a terminal, non-submit end (e.g. a read/navigate task).
    Completed,
    /// Hit a captcha/anti-bot wall — paused, evidence captured, never solved.
    PausedForCaptcha,
    /// Form filled and sitting at the submit button — paused for user review.
    PausedForReview,
    /// Aborted by the emergency-stop latch.
    Aborted,
}

/// What the driver reports about the current page after acting on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageState {
    /// A captcha or anti-bot challenge is present. The driver MUST NOT solve it.
    CaptchaWall,
    /// An Easy-Apply form is present and fillable.
    ApplyForm,
    /// Nothing left to do on this page.
    NoAction,
    /// LinkedIn returned the "exceeded the daily Easy Apply limit" feedback.
    /// The entire run must stop — retrying will keep hitting the same wall.
    DailyLimitReached,
}

/// The kinds of evidence persisted to `automation_evidence`.
///
/// Mirrors the `evidence_type` CHECK constraint in the schema.
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

/// How to open a browser session for a profile.
#[derive(Debug, Clone)]
pub struct SessionSpec {
    pub profile_id: String,
    pub platform: String,
    pub user_data_dir: String,
    /// Filesystem paths to unpacked Chrome extensions to side-load. Empty by
    /// default; populated from `AppSettings.browser_extensions`.
    pub extensions: Vec<String>,
}

/// One answer to a form question, produced upstream by the application draft.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerField {
    pub label: String,
    pub value: String,
}

/// The payload of an `apply_job` automation task (stored as `payload_json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EasyApplyInput {
    /// Job posting / apply URL to drive.
    pub url: String,
    #[serde(default = "default_platform")]
    pub platform: String,
    /// Persistent per-profile browser data dir; derived if omitted.
    #[serde(default)]
    pub user_data_dir: Option<String>,
    #[serde(default)]
    pub cover_letter: Option<String>,
    #[serde(default)]
    pub answers: Vec<AnswerField>,
    /// Hiring-manager name scraped from the job page (filled in by `drive`).
    #[serde(default)]
    pub hr_name: Option<String>,
    /// Hiring-manager LinkedIn profile URL scraped from the job page (filled in by `drive`).
    #[serde(default)]
    pub hr_link: Option<String>,
}

fn default_platform() -> String {
    "linkedin".to_string()
}

/// The mockable seam over the real Playwright/Chromium sidecar. The production
/// implementation talks to the sidecar over IPC; tests substitute a mock so the
/// supervisor's orchestration and persistence logic is exercised directly.
#[allow(async_fn_in_trait)]
pub trait BrowserDriver: Send + Sync {
    /// Launch a browser session and return an opaque handle.
    async fn open(&self, spec: &SessionSpec) -> DomainResult<String>;
    /// Navigate the session to a URL.
    async fn navigate(&self, handle: &str, url: &str) -> DomainResult<()>;
    /// Inspect the current page and classify it.
    async fn probe(&self, handle: &str) -> DomainResult<PageState>;
    /// Fill the Easy-Apply form — but never submit it.
    async fn fill_easy_apply(&self, handle: &str, input: &EasyApplyInput) -> DomainResult<()>;
    /// Capture a screenshot; returns the written file path.
    async fn screenshot(&self, handle: &str) -> DomainResult<String>;
    /// Capture the DOM as text.
    async fn dom_snapshot(&self, handle: &str) -> DomainResult<String>;
    /// Close the session and release the browser.
    async fn close(&self, handle: &str) -> DomainResult<()>;
    /// Extract hiring-manager card from the current page.
    /// Returns a JSON string `{"name":"…","profile_url":"…"}` or `None` if
    /// no hirer card is present. Never navigates; reads the current DOM only.
    async fn extract_hr(&self, handle: &str) -> DomainResult<Option<String>>;
}

/// Drives `automation_tasks` through a real browser while never bypassing
/// captcha/anti-bot defenses and never auto-submitting an application.
#[allow(async_fn_in_trait)]
pub trait AutomationSupervisor: Send + Sync {
    async fn start_task(&self, automation_task_id: &str) -> DomainResult<()>;
    async fn stop_all(&self) -> DomainResult<()>;
    fn status(&self) -> AutomationStatus;
}

/// Concrete supervisor backed by a [`BrowserDriver`] and the SQLite store.
pub struct BrowserSupervisor<D: BrowserDriver> {
    db: SqlitePool,
    driver: D,
    stop: Arc<AtomicBool>,
    status: Mutex<AutomationStatus>,
}

impl<D: BrowserDriver> BrowserSupervisor<D> {
    pub fn new(db: SqlitePool, driver: D) -> Self {
        Self::with_stop_flag(db, driver, Arc::new(AtomicBool::new(false)))
    }

    /// Construct sharing an existing emergency-stop latch, so an external
    /// signal (or a mock driver, in tests) can trip the stop mid-task.
    pub fn with_stop_flag(db: SqlitePool, driver: D, stop: Arc<AtomicBool>) -> Self {
        Self {
            db,
            driver,
            stop,
            status: Mutex::new(AutomationStatus::Idle),
        }
    }

    /// A clone of the shared emergency-stop latch.
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    fn set_status(&self, s: AutomationStatus) {
        *self.status.lock().expect("status mutex poisoned") = s;
    }

    /// Run one task end-to-end, returning its terminal outcome. `start_task`
    /// delegates here; the outcome is also persisted to the task row.
    pub async fn run_task(&self, task_id: &str) -> DomainResult<TaskOutcome> {
        let (profile_id, payload_json) = self.load_task(task_id).await?;

        // A deliberate new start clears any prior emergency-stop latch.
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

        // Side-load user-configured unpacked Chrome extensions. Read the raw
        // `browser_extensions` JSON array straight from the settings table so we
        // avoid an `AppPaths` dependency here; a malformed/absent value yields
        // an empty list (no extensions loaded).
        let extensions: Vec<String> = sqlx::query_scalar::<_, String>(
            "SELECT value FROM app_settings WHERE key = 'browser_extensions'",
        )
        .fetch_optional(&self.db)
        .await?
        .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
        .unwrap_or_default();

        let spec = SessionSpec {
            profile_id: profile_id.clone(),
            platform: input.platform.clone(),
            user_data_dir: input
                .user_data_dir
                .clone()
                .unwrap_or_else(|| format!("profiles/{profile_id}/browser")),
            extensions,
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

    /// The step machine: navigate, classify, and either pause (captcha/review),
    /// complete, or abort. Persists session + task + evidence transitions.
    async fn drive(
        &self,
        task_id: &str,
        input: &EasyApplyInput,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        self.driver.navigate(handle, &input.url).await?;

        if self.stop.load(Ordering::SeqCst) {
            self.abort(session_id, task_id, handle).await?;
            return Ok(TaskOutcome::Aborted);
        }

        match self.driver.probe(handle).await? {
            PageState::CaptchaWall => {
                // Capture evidence and hand off. NEVER attempt to solve.
                let shot = self.driver.screenshot(handle).await?;
                self.record_evidence(task_id, EvidenceKind::Screenshot, Some(&shot), None)
                    .await?;
                let dom = self.driver.dom_snapshot(handle).await?;
                self.record_evidence(task_id, EvidenceKind::DomSnapshot, None, Some(&dom))
                    .await?;

                let now = now_iso();
                sqlx::query(
                    "UPDATE browser_sessions SET status = 'paused_captcha', updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                sqlx::query(
                    "UPDATE automation_tasks SET status = 'paused_captcha', updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(task_id)
                .execute(&self.db)
                .await?;
                self.update_application_outcome(
                    task_id,
                    session_id,
                    "paused_for_captcha",
                    "needs_review",
                )
                .await?;

                self.set_status(AutomationStatus::PausedForCaptcha);
                Ok(TaskOutcome::PausedForCaptcha)
            }
            PageState::ApplyForm => {
                // Try to pull the hiring-manager info; non-fatal if absent.
                let (hr_name, hr_link) = {
                    let raw = self.driver.extract_hr(handle).await.unwrap_or(None);
                    match raw {
                        None => (None, None),
                        Some(json) => {
                            // JS returns JSON string: {"name":"…","profile_url":"…"}
                            let v: serde_json::Value =
                                serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
                            let name = v.get("name")
                                .and_then(|n| n.as_str())
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned);
                            let link = v.get("profile_url")
                                .and_then(|u| u.as_str())
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned);
                            if let Some(ref n) = name {
                                tracing::info!(task_id, name = n.as_str(), "extract_hr: found hiring manager");
                            }
                            (name, link)
                        }
                    }
                };
                // Substitute {{hr_name}} / {{hr_link}} placeholders in the cover-letter
                // template so callers can personalise without knowing the HR in advance.
                let cover_letter = input.cover_letter.as_deref().map(|tpl| {
                    let mut s = tpl.to_owned();
                    if let Some(ref n) = hr_name { s = s.replace("{{hr_name}}", n); }
                    if let Some(ref l) = hr_link { s = s.replace("{{hr_link}}", l); }
                    s
                });

                // Build an owned input with hr_name/hr_link/cover_letter populated so
                // fill_easy_apply can personalise without mutating the caller's value.
                let enriched = EasyApplyInput { hr_name, hr_link, cover_letter, ..input.clone() };

                self.driver.fill_easy_apply(handle, &enriched).await?;

                if self.stop.load(Ordering::SeqCst) {
                    self.abort(session_id, task_id, handle).await?;
                    return Ok(TaskOutcome::Aborted);
                }

                let form = serde_json::to_string(&input.answers).unwrap_or_else(|_| "[]".into());
                self.record_evidence(task_id, EvidenceKind::FormState, None, Some(&form))
                    .await?;
                let shot = self.driver.screenshot(handle).await?;
                self.record_evidence(task_id, EvidenceKind::Screenshot, Some(&shot), None)
                    .await?;

                // Assist-and-pause: filled, but the user must confirm the submit.
                let now = now_iso();
                sqlx::query(
                    "UPDATE browser_sessions SET status = 'paused_review', updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                self.update_application_outcome(
                    task_id,
                    session_id,
                    "needs_review",
                    "needs_review",
                )
                .await?;
                sqlx::query(
                    "UPDATE automation_tasks
                     SET status = 'pending_review',
                         hr_name = ?3, hr_link = ?4,
                         updated_at = ?1
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(task_id)
                .bind(enriched.hr_name.as_deref())
                .bind(enriched.hr_link.as_deref())
                .execute(&self.db)
                .await?;

                self.set_status(AutomationStatus::PausedForReview);
                Ok(TaskOutcome::PausedForReview)
            }
            PageState::NoAction => {
                let dom = self.driver.dom_snapshot(handle).await?;
                self.record_evidence(task_id, EvidenceKind::DomSnapshot, None, Some(&dom))
                    .await?;
                self.driver.close(handle).await?;

                let now = now_iso();
                sqlx::query(
                    "UPDATE browser_sessions SET status = 'closed', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                sqlx::query(
                    "UPDATE automation_tasks
                     SET status = 'completed', finished_at = ?1,
                         result_json = '{\"outcome\":\"completed\"}', updated_at = ?1
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(task_id)
                .execute(&self.db)
                .await?;

                self.set_status(AutomationStatus::Idle);
                Ok(TaskOutcome::Completed)
            }
            // LinkedIn told us the daily Easy Apply cap is exhausted.
            // Fail this task with a clear reason and bubble a distinct error
            // so `run_automation_queue` stops the entire run immediately —
            // every subsequent task would hit the same wall.
            PageState::DailyLimitReached => {
                self.driver.close(handle).await?;
                let now = now_iso();
                let msg = "LinkedIn daily Easy Apply limit reached — stopping run";
                sqlx::query(
                    "UPDATE browser_sessions
                     SET status = 'failed', ended_at = ?1, updated_at = ?1
                     WHERE id = ?2",
                )
                .bind(&now)
                .bind(session_id)
                .execute(&self.db)
                .await?;
                sqlx::query(
                    "UPDATE automation_tasks
                     SET status = 'failed', finished_at = ?1,
                         result_json = ?2, updated_at = ?1
                     WHERE id = ?3",
                )
                .bind(&now)
                .bind(format!("{{\"outcome\":\"daily_limit_reached\",\"reason\":\"{msg}\"}}"))
                .bind(task_id)
                .execute(&self.db)
                .await?;
                self.set_status(AutomationStatus::Idle);
                // Propagate as an error so the queue loop in
                // `run_automation_queue` surfaces it and stops draining.
                Err(DomainError::Other(anyhow::anyhow!("{msg}")))
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
        let user_data_dir = input
            .user_data_dir
            .clone()
            .unwrap_or_else(|| format!("profiles/{profile_id}/browser"));
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

    /// Emergency-stop mid-task: close, mark the session stopped, requeue the task.
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

    /// Best-effort cleanup after a driver failure once a session is open.
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

    /// Cleanup when the browser never even opened.
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

/// Phase-1 stub retained for wiring that has not yet adopted [`BrowserSupervisor`].
pub struct AutomationSupervisorStub;

impl AutomationSupervisor for AutomationSupervisorStub {
    async fn start_task(&self, _automation_task_id: &str) -> DomainResult<()> {
        Err(DomainError::NotImplemented(
            "AutomationSupervisor::start_task",
        ))
    }
    async fn stop_all(&self) -> DomainResult<()> {
        Ok(())
    }
    fn status(&self) -> AutomationStatus {
        AutomationStatus::Idle
    }
}

/// The cockpit-facing [`AutomationState`] string (kept in sync with the TS
/// `AutomationState` union) for a task's terminal outcome.
fn outcome_state(outcome: TaskOutcome) -> &'static str {
    match outcome {
        TaskOutcome::Completed => "Completed",
        TaskOutcome::PausedForCaptcha => "PausedForCaptcha",
        // A filled-but-unsubmitted form needs the human to confirm the submit.
        TaskOutcome::PausedForReview => "NeedsReview",
        TaskOutcome::Aborted => "Stopped",
    }
}

/// Summary of one [`run_automation_queue`] drain pass.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct QueueRunSummary {
    /// Tasks actually run through the supervisor.
    pub ran: usize,
    /// Tasks that reached a completed (non-submit) terminal end.
    pub completed: usize,
    /// Tasks that paused for the human (captcha or review).
    pub paused: usize,
    /// Tasks aborted by the emergency-stop latch.
    pub aborted: usize,
    /// True when there were no runnable `apply_job` tasks queued.
    pub was_empty: bool,
}

/// Drain the queued `apply_job` automation tasks through a [`BrowserSupervisor`]
/// over the injected `driver`, pushing a coarse [`AutomationState`] string to
/// the `emit` sink as the run progresses.
///
/// This is the link between *enqueuing* an application (Phase 4's
/// `submit_application`) and *running* it: without it the cockpit optimistically
/// showed "Preparing Browser" forever because nothing ever drove the state
/// forward. Pure orchestration over an injected driver + emit sink, so it is
/// unit-testable with the mock driver and never touches Tauri.
///
/// Emission contract — each call is `emit(state, task_id, url)`:
///   - `"PreparingBrowser"` once at entry (`task_id = None`, `url = None`).
///   - one terminal state per task drained (`Some(task_id)`, `Some(job_url)`).
///   - a terminal `"Stopped"` (`None`, `None`) if the emergency-stop latch trips,
///     or `"Completed"` (`None`, `None`) when the queue drains — so the cockpit
///     **always** settles on a terminal state and never hangs.
///
/// The `url` slot carries the job's application URL so the cockpit can wire it
/// into the live `<BrowserPreview>` without a separate query round-trip.
pub async fn run_automation_queue<D, F>(
    db: &SqlitePool,
    driver: D,
    stop: Arc<AtomicBool>,
    mut emit: F,
) -> DomainResult<QueueRunSummary>
where
    D: BrowserDriver,
    F: FnMut(&str, Option<&str>, Option<&str>, Option<&str>, Option<&str>),
{
    emit("PreparingBrowser", None, None, None, None);

    let queued: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM automation_tasks
         WHERE task_type = 'apply_job' AND status = 'queued'
         ORDER BY priority DESC, created_at ASC",
    )
    .fetch_all(db)
    .await?;

    let mut summary = QueueRunSummary {
        was_empty: queued.is_empty(),
        ..Default::default()
    };

    let sup = BrowserSupervisor::with_stop_flag(db.clone(), driver, stop.clone());

    for task_id in &queued {
        // A stop set *between* tasks halts the drain before starting the next
        // one. (In-task stops are caught inside `run_task`, which returns
        // `Aborted`.)
        if stop.load(Ordering::SeqCst) {
            emit("Stopped", None, None, None, None);
            summary.aborted += 1;
            return Ok(summary);
        }

        // Fetch the job URL from the task payload so we can hand it to the
        // cockpit's live browser preview once the task terminates. A missing or
        // malformed payload yields None — the preview just keeps its previous URL.
        let job_url: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(payload_json, '$.url')
             FROM automation_tasks WHERE id = ?1",
        )
        .bind(task_id.as_str())
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .flatten();

        let outcome = sup.run_task(task_id).await?;
        summary.ran += 1;
        match outcome {
            TaskOutcome::Completed => summary.completed += 1,
            TaskOutcome::PausedForCaptcha | TaskOutcome::PausedForReview => summary.paused += 1,
            TaskOutcome::Aborted => summary.aborted += 1,
        }

        // For NeedsReview pauses, surface the hr contact so the cockpit card
        // can show "Review with Jane Smith" without a separate round-trip.
        let (hr_name, hr_link) = if matches!(outcome, TaskOutcome::PausedForReview) {
            sqlx::query_as::<_, (Option<String>, Option<String>)>(
                "SELECT hr_name, hr_link FROM automation_tasks WHERE id = ?1",
            )
            .bind(task_id.as_str())
            .fetch_optional(db)
            .await?
            .map_or((None, None), |(n, l)| (n, l))
        } else {
            (None, None)
        };
        emit(
            outcome_state(outcome),
            Some(task_id),
            job_url.as_deref(),
            hr_name.as_deref(),
            hr_link.as_deref(),
        );

        // Human handoff and abort outcomes must stop the drain. Starting another
        // browser task would overwrite the cockpit pause and leak two sessions
        // that both need operator attention.
        if matches!(outcome, TaskOutcome::Aborted) {
            emit("Stopped", None, None, None, None);
            return Ok(summary);
        }
        if matches!(
            outcome,
            TaskOutcome::PausedForCaptcha | TaskOutcome::PausedForReview
        ) {
            return Ok(summary);
        }
    }

    // Each task already emitted its own terminal state, so a drained non-empty
    // queue leaves the cockpit on the last task's outcome (e.g. a lingering
    // `PausedForCaptcha` is NOT masked by a blanket "Completed"). Only when
    // nothing ran do we settle explicitly — so an empty Start still never hangs
    // on "Preparing Browser".
    if summary.was_empty {
        emit("Completed", None, None, None, None);
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use std::sync::atomic::AtomicUsize;

    async fn mem_pool() -> SqlitePool {
        let opts = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn insert_profile(pool: &SqlitePool, id: &str) {
        let now = now_iso();
        sqlx::query(
            "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
             VALUES (?1, 'Test', ?2, ?2, 1)",
        )
        .bind(id)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_apply_task(pool: &SqlitePool, id: &str, profile_id: &str) {
        let now = now_iso();
        let payload = r#"{"url":"https://linkedin.com/jobs/view/1","platform":"linkedin",
            "answers":[{"label":"Years of Rust","value":"5"}]}"#;
        sqlx::query(
            "INSERT INTO automation_tasks
               (id, profile_id, task_type, status, payload_json, created_at, updated_at)
             VALUES (?1, ?2, 'apply_job', 'queued', ?3, ?4, ?4)",
        )
        .bind(id)
        .bind(profile_id)
        .bind(payload)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    struct MockDriver {
        probe: PageState,
        open_fails: bool,
        stop_on_navigate: Option<Arc<AtomicBool>>,
        fill_calls: Arc<AtomicUsize>,
        closed: Arc<AtomicBool>,
        /// Records `spec.extensions` from the last `open()` so a test can prove
        /// the settings→spec wiring reached the driver.
        opened_extensions: Arc<Mutex<Option<Vec<String>>>>,
    }

    impl MockDriver {
        fn new(probe: PageState) -> Self {
            Self {
                probe,
                open_fails: false,
                stop_on_navigate: None,
                fill_calls: Arc::new(AtomicUsize::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
                opened_extensions: Arc::new(Mutex::new(None)),
            }
        }
    }

    impl BrowserDriver for MockDriver {
        async fn open(&self, spec: &SessionSpec) -> DomainResult<String> {
            *self.opened_extensions.lock().unwrap() = Some(spec.extensions.clone());
            if self.open_fails {
                return Err(DomainError::Other(anyhow::anyhow!("browser launch failed")));
            }
            Ok("handle-1".to_string())
        }
        async fn navigate(&self, _handle: &str, _url: &str) -> DomainResult<()> {
            if let Some(flag) = &self.stop_on_navigate {
                flag.store(true, Ordering::SeqCst);
            }
            Ok(())
        }
        async fn probe(&self, _handle: &str) -> DomainResult<PageState> {
            Ok(self.probe)
        }
        async fn fill_easy_apply(
            &self,
            _handle: &str,
            _input: &EasyApplyInput,
        ) -> DomainResult<()> {
            self.fill_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        async fn screenshot(&self, _handle: &str) -> DomainResult<String> {
            Ok("/evidence/shot.png".to_string())
        }
        async fn dom_snapshot(&self, _handle: &str) -> DomainResult<String> {
            Ok("<html>page</html>".to_string())
        }
        async fn close(&self, _handle: &str) -> DomainResult<()> {
            self.closed.store(true, Ordering::SeqCst);
            Ok(())
        }
        async fn extract_hr(&self, _handle: &str) -> DomainResult<Option<String>> {
            Ok(None)
        }
    }

    async fn set_setting(pool: &SqlitePool, key: &str, value: &str) {
        sqlx::query(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .bind(now_iso())
        .execute(pool)
        .await
        .unwrap();
    }

    async fn session_status(pool: &SqlitePool, profile_id: &str) -> (String, Option<String>) {
        sqlx::query_as("SELECT status, ended_at FROM browser_sessions WHERE profile_id = ?1")
            .bind(profile_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn task_status(pool: &SqlitePool, task_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM automation_tasks WHERE id = ?1")
            .bind(task_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn evidence_count(pool: &SqlitePool, task_id: &str) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM automation_evidence WHERE task_id = ?1")
            .bind(task_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn no_action_task_completes_and_closes_session() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let sup = BrowserSupervisor::new(pool.clone(), MockDriver::new(PageState::NoAction));
        let out = sup.run_task("t1").await.unwrap();

        assert_eq!(out, TaskOutcome::Completed);
        assert_eq!(sup.status(), AutomationStatus::Idle);
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "closed");
        assert!(ended.is_some(), "closed session must have ended_at");
        assert_eq!(task_status(&pool, "t1").await, "completed");
        assert_eq!(evidence_count(&pool, "t1").await, 1); // dom snapshot
    }

    #[tokio::test]
    async fn captcha_wall_pauses_and_never_solves() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let driver = MockDriver::new(PageState::CaptchaWall);
        let fills = driver.fill_calls.clone();
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        let out = sup.run_task("t1").await.unwrap();

        assert_eq!(out, TaskOutcome::PausedForCaptcha);
        assert_eq!(sup.status(), AutomationStatus::PausedForCaptcha);
        // The safety guarantee: we never touched the form.
        assert_eq!(fills.load(Ordering::SeqCst), 0);
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "paused_captcha");
        assert!(ended.is_none(), "paused session stays open for the human");
        assert_eq!(task_status(&pool, "t1").await, "paused_captcha");
        assert_eq!(evidence_count(&pool, "t1").await, 2); // screenshot + dom
    }

    #[tokio::test]
    async fn apply_form_fills_then_pauses_for_review() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let driver = MockDriver::new(PageState::ApplyForm);
        let fills = driver.fill_calls.clone();
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        let out = sup.run_task("t1").await.unwrap();

        assert_eq!(out, TaskOutcome::PausedForReview);
        assert_eq!(sup.status(), AutomationStatus::PausedForReview);
        assert_eq!(fills.load(Ordering::SeqCst), 1, "form filled exactly once");
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "paused_review");
        assert!(ended.is_none(), "review pause leaves the browser open");
        // Never auto-submitted: task stops at pending_review.
        assert_eq!(task_status(&pool, "t1").await, "pending_review");
        assert_eq!(evidence_count(&pool, "t1").await, 2); // form_state + screenshot
    }

    #[tokio::test]
    async fn emergency_stop_mid_flow_aborts() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let stop = Arc::new(AtomicBool::new(false));
        let mut driver = MockDriver::new(PageState::ApplyForm);
        driver.stop_on_navigate = Some(stop.clone()); // user hits stop during navigation
        let fills = driver.fill_calls.clone();
        let sup = BrowserSupervisor::with_stop_flag(pool.clone(), driver, stop);
        let out = sup.run_task("t1").await.unwrap();

        assert_eq!(out, TaskOutcome::Aborted);
        assert_eq!(sup.status(), AutomationStatus::Stopped);
        assert_eq!(fills.load(Ordering::SeqCst), 0, "aborted before filling");
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "stopped");
        assert!(ended.is_some());
        assert_eq!(task_status(&pool, "t1").await, "queued"); // requeued
    }

    #[tokio::test]
    async fn stop_all_marks_open_sessions_ended() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        let now = now_iso();
        sqlx::query(
            "INSERT INTO browser_sessions
               (id, profile_id, platform, engine, user_data_dir, status, started_at, created_at, updated_at)
             VALUES ('s1', 'p1', 'linkedin', 'playwright_chromium', '/tmp/x', 'open', ?1, ?1, ?1)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let sup = BrowserSupervisor::new(pool.clone(), MockDriver::new(PageState::NoAction));
        sup.stop_all().await.unwrap();

        assert_eq!(sup.status(), AutomationStatus::Stopped);
        assert!(sup.stop_flag().load(Ordering::SeqCst));
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "stopped");
        assert!(ended.is_some());
    }

    #[tokio::test]
    async fn missing_task_is_invalid_input() {
        let pool = mem_pool().await;
        let sup = BrowserSupervisor::new(pool, MockDriver::new(PageState::NoAction));
        let err = sup.run_task("nope").await.unwrap_err();
        assert!(matches!(err, DomainError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn driver_open_failure_marks_session_failed() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let mut driver = MockDriver::new(PageState::NoAction);
        driver.open_fails = true;
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        let err = sup.run_task("t1").await.unwrap_err();

        assert!(matches!(err, DomainError::Other(_)));
        let (status, ended) = session_status(&pool, "p1").await;
        assert_eq!(status, "error");
        assert!(ended.is_some());
        assert_eq!(task_status(&pool, "t1").await, "failed");
    }

    #[tokio::test]
    async fn run_task_side_loads_extensions_read_from_app_settings() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;
        // The whole point: the paths must travel from the settings table, not a
        // literal — so seed the row and prove it reaches SessionSpec.extensions.
        set_setting(&pool, "browser_extensions", r#"["/ext/a","/ext/b"]"#).await;

        let driver = MockDriver::new(PageState::NoAction);
        let captured = driver.opened_extensions.clone();
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        sup.run_task("t1").await.unwrap();

        let seen = captured.lock().unwrap().clone();
        assert_eq!(seen, Some(vec!["/ext/a".to_string(), "/ext/b".to_string()]));
    }

    #[tokio::test]
    async fn run_task_defaults_to_no_extensions_when_setting_absent() {
        // No `browser_extensions` row seeded: the read must fall back to empty,
        // not error, and hand the driver an empty extension list.
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let driver = MockDriver::new(PageState::NoAction);
        let captured = driver.opened_extensions.clone();
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        sup.run_task("t1").await.unwrap();

        assert_eq!(captured.lock().unwrap().clone(), Some(Vec::<String>::new()));
    }

    // --- run_automation_queue: the enqueue→run bridge that fixes the stuck
    // "Preparing Browser" hang.
    // Capture emissions as (state, taskId, url, hrName, hrLink) tuples.
    type Emission = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );

    fn recorder() -> (
        Arc<Mutex<Vec<Emission>>>,
        impl FnMut(&str, Option<&str>, Option<&str>, Option<&str>, Option<&str>),
    ) {
        let log = Arc::new(Mutex::new(Vec::<Emission>::new()));
        let sink = log.clone();
        let emit = move |state: &str,
                         task: Option<&str>,
                         url: Option<&str>,
                         hr_name: Option<&str>,
                         hr_link: Option<&str>| {
            sink.lock().unwrap().push((
                state.to_string(),
                task.map(str::to_string),
                url.map(str::to_string),
                hr_name.map(str::to_string),
                hr_link.map(str::to_string),
            ));
        };
        (log, emit)
    }

    #[tokio::test]
    async fn empty_queue_settles_completed_and_never_hangs() {
        let pool = mem_pool().await;
        let (log, emit) = recorder();
        let stop = Arc::new(AtomicBool::new(false));

        let summary = run_automation_queue(&pool, MockDriver::new(PageState::NoAction), stop, emit)
            .await
            .unwrap();

        assert!(summary.was_empty);
        assert_eq!(summary.ran, 0);
        // The anti-hang guarantee: PreparingBrowser is always followed by a
        // terminal state even with nothing queued.
        let states: Vec<String> = log.lock().unwrap().iter().map(|(s, _, _, _, _)| s.clone()).collect();
        assert_eq!(states, vec!["PreparingBrowser", "Completed"]);
    }

    #[tokio::test]
    async fn queue_drains_every_task_and_emits_terminal_per_task() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;
        insert_apply_task(&pool, "t2", "p1").await;
        let (log, emit) = recorder();
        let stop = Arc::new(AtomicBool::new(false));

        let summary = run_automation_queue(&pool, MockDriver::new(PageState::NoAction), stop, emit)
            .await
            .unwrap();

        assert_eq!(summary.ran, 2);
        assert_eq!(summary.completed, 2);
        assert!(!summary.was_empty);
        assert_eq!(task_status(&pool, "t1").await, "completed");
        assert_eq!(task_status(&pool, "t2").await, "completed");
        // One terminal emit per task; no blanket trailing "Completed" clobbers them.
        let emitted = log.lock().unwrap().clone();
        assert_eq!(emitted[0], ("PreparingBrowser".into(), None, None, None, None));
        let url = Some("https://linkedin.com/jobs/view/1".to_string());
        assert!(emitted.contains(&("Completed".into(), Some("t1".into()), url.clone(), None, None)));
        assert!(emitted.contains(&("Completed".into(), Some("t2".into()), url, None, None)));
    }

    #[tokio::test]
    async fn latch_set_before_drain_stops_without_running() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;
        let (log, emit) = recorder();
        let stop = Arc::new(AtomicBool::new(true)); // operator already stopped

        let summary = run_automation_queue(&pool, MockDriver::new(PageState::NoAction), stop, emit)
            .await
            .unwrap();

        assert_eq!(summary.ran, 0);
        assert_eq!(summary.aborted, 1);
        // Task untouched, still queued for a later start.
        assert_eq!(task_status(&pool, "t1").await, "queued");
        let states: Vec<String> = log.lock().unwrap().iter().map(|(s, _, _, _, _)| s.clone()).collect();
        assert_eq!(states, vec!["PreparingBrowser", "Stopped"]);
    }

    #[tokio::test]
    async fn captcha_pause_is_not_masked_by_a_completed() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;
        insert_apply_task(&pool, "t2", "p1").await;
        let (log, emit) = recorder();
        let stop = Arc::new(AtomicBool::new(false));

        let summary =
            run_automation_queue(&pool, MockDriver::new(PageState::CaptchaWall), stop, emit)
                .await
                .unwrap();

        assert_eq!(summary.paused, 1);
        assert_eq!(summary.ran, 1);
        assert_eq!(task_status(&pool, "t1").await, "paused_captcha");
        assert_eq!(task_status(&pool, "t2").await, "queued");
        // The final emitted state must remain the human-handoff pause, so the
        // cockpit does not falsely claim the run finished.
        let last = log.lock().unwrap().last().unwrap().clone();
        assert_eq!(
            last,
            (
                "PausedForCaptcha".into(),
                Some("t1".into()),
                Some("https://linkedin.com/jobs/view/1".to_string()),
                None,
                None,
            )
        );
    }

    // ── new: DailyLimitReached ─────────────────────────────────────────────

    /// A `DailyLimitReached` page stops the *entire* run immediately.
    /// `run_automation_queue` bubbles it as `Err` so the cockpit can display
    /// the reason; the task row is marked `failed` with the LinkedIn message.
    #[tokio::test]
    async fn daily_limit_reached_stops_run_and_propagates_as_error() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;
        let (_log, emit) = recorder();
        let stop = Arc::new(AtomicBool::new(false));

        let result = run_automation_queue(
            &pool,
            MockDriver::new(PageState::DailyLimitReached),
            stop,
            emit,
        )
        .await;

        // Must surface as Err so the cockpit can show the reason string.
        assert!(result.is_err(), "expected Err but got Ok");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("daily") || msg.contains("limit"),
            "error message should mention the limit; got: {msg}"
        );
        // The task row must be marked failed (not left running/queued).
        assert_eq!(task_status(&pool, "t1").await, "failed");
    }

    // ── new: hr_link persisted to pending_review row ──────────────────────

    struct HrMockDriver {
        inner: MockDriver,
        hr_name: Option<String>,
        hr_link: Option<String>,
    }

    impl HrMockDriver {
        fn new(hr_name: Option<&str>, hr_link: Option<&str>) -> Self {
            Self {
                inner: MockDriver::new(PageState::ApplyForm),
                hr_name: hr_name.map(str::to_string),
                hr_link: hr_link.map(str::to_string),
            }
        }
    }

    impl BrowserDriver for HrMockDriver {
        async fn open(&self, spec: &SessionSpec) -> DomainResult<String> {
            self.inner.open(spec).await
        }
        async fn navigate(&self, h: &str, url: &str) -> DomainResult<()> {
            self.inner.navigate(h, url).await
        }
        async fn probe(&self, h: &str) -> DomainResult<PageState> {
            self.inner.probe(h).await
        }
        async fn fill_easy_apply(&self, h: &str, i: &EasyApplyInput) -> DomainResult<()> {
            self.inner.fill_easy_apply(h, i).await
        }
        async fn screenshot(&self, h: &str) -> DomainResult<String> {
            self.inner.screenshot(h).await
        }
        async fn dom_snapshot(&self, h: &str) -> DomainResult<String> {
            self.inner.dom_snapshot(h).await
        }
        async fn close(&self, h: &str) -> DomainResult<()> {
            self.inner.close(h).await
        }
        async fn extract_hr(&self, _handle: &str) -> DomainResult<Option<String>> {
            // Return a synthetic JSON blob matching the format the real driver
            // produces: `{"name":"…","profile_url":"…"}` encoded as a bare string.
            match (&self.hr_name, &self.hr_link) {
                (Some(n), Some(l)) => {
                    let json = serde_json::json!({"name": n, "profile_url": l});
                    Ok(Some(serde_json::to_string(&json).unwrap()))
                }
                _ => Ok(None),
            }
        }
    }

    /// When `extract_hr` succeeds, `hr_name` and `hr_link` must be written to
    /// the `automation_tasks` row so later steps (cover-letter, analytics) can
    /// read them without re-scraping.
    #[tokio::test]
    async fn apply_form_persists_hr_link_to_pending_review_row() {
        let pool = mem_pool().await;
        insert_profile(&pool, "p1").await;
        insert_apply_task(&pool, "t1", "p1").await;

        let driver = HrMockDriver::new(Some("Jane Smith"), Some("https://linkedin.com/in/jsmith"));
        let sup = BrowserSupervisor::new(pool.clone(), driver);
        let out = sup.run_task("t1").await.unwrap();

        assert_eq!(out, TaskOutcome::PausedForReview);

        let (hr_name, hr_link): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT hr_name, hr_link FROM automation_tasks WHERE id = 't1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(hr_name.as_deref(), Some("Jane Smith"));
        assert_eq!(hr_link.as_deref(), Some("https://linkedin.com/in/jsmith"));
    }
}
