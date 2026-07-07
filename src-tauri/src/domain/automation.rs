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

        let spec = SessionSpec {
            profile_id: profile_id.clone(),
            platform: input.platform.clone(),
            user_data_dir: input
                .user_data_dir
                .clone()
                .unwrap_or_else(|| format!("profiles/{profile_id}/browser")),
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

                self.set_status(AutomationStatus::PausedForCaptcha);
                Ok(TaskOutcome::PausedForCaptcha)
            }
            PageState::ApplyForm => {
                self.driver.fill_easy_apply(handle, input).await?;

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
                sqlx::query(
                    "UPDATE automation_tasks SET status = 'pending_review', updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(task_id)
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
    }

    impl MockDriver {
        fn new(probe: PageState) -> Self {
            Self {
                probe,
                open_fails: false,
                stop_on_navigate: None,
                fill_calls: Arc::new(AtomicUsize::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl BrowserDriver for MockDriver {
        async fn open(&self, _spec: &SessionSpec) -> DomainResult<String> {
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
}
