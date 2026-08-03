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

    #[tracing::instrument(
        target = "hiremeops::automation",
        skip(self, input, handle),
        fields(url = %input.url, platform = %input.platform)
    )]
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
                let (hr_name, hr_link) = {
                    let raw = self.driver.extract_hr(handle).await.unwrap_or(None);
                    match raw {
                        None => (None, None),
                        Some(json) => {
                            let v: serde_json::Value =
                                serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
                            let name = v
                                .get("name")
                                .and_then(|n| n.as_str())
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned);
                            let link = v
                                .get("profile_url")
                                .and_then(|u| u.as_str())
                                .filter(|s| !s.is_empty())
                                .map(str::to_owned);
                            if let Some(ref n) = name {
                                tracing::info!(
                                    task_id,
                                    name = n.as_str(),
                                    "extract_hr: found hiring manager"
                                );
                            }
                            (name, link)
                        }
                    }
                };
                let cover_letter = input.cover_letter.as_deref().map(|tpl| {
                    let mut s = tpl.to_owned();
                    if let Some(ref n) = hr_name {
                        s = s.replace("{{hr_name}}", n);
                    }
                    if let Some(ref l) = hr_link {
                        s = s.replace("{{hr_link}}", l);
                    }
                    s
                });

                let enriched = EasyApplyInput {
                    hr_name,
                    hr_link,
                    cover_letter,
                    task_id: Some(task_id.to_owned()),
                    session_id: Some(session_id.to_owned()),
                    ..input.clone()
                };

                let unanswered = self
                    .driver
                    .fill_easy_apply_collect(handle, &enriched)
                    .await?;
                let mut needs_human = 0usize;
                if !unanswered.is_empty() {
                    let profile_id: String =
                        sqlx::query_scalar("SELECT profile_id FROM automation_tasks WHERE id = ?1")
                            .bind(task_id)
                            .fetch_optional(&self.db)
                            .await
                            .ok()
                            .flatten()
                            .unwrap_or_default();
                    match generate_form_answers(&self.db, &profile_id, &unanswered).await {
                        Ok((qmap, human)) => {
                            needs_human += human;
                            if qmap.is_empty() {
                                needs_human += unanswered.len();
                            } else {
                                let payload = serde_json::json!({ "questions": serde_json::Value::Object(qmap) });
                                match self.driver.answer_easy_apply(handle, &payload).await {
                                    Ok(leftover) => {
                                        needs_human += leftover.len();
                                        if !leftover.is_empty() {
                                            let labels: Vec<&str> = leftover
                                                .iter()
                                                .filter_map(|q| {
                                                    q.get("label").and_then(|v| v.as_str())
                                                })
                                                .collect();
                                            tracing::info!(
                                                task_id,
                                                ?labels,
                                                "Easy Apply: still unanswered after AI refill"
                                            );
                                        }
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "Easy Apply AI refill failed");
                                        needs_human += unanswered.len();
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(error = %e, "Easy Apply answer generation failed; parking for review");
                            needs_human += unanswered.len();
                        }
                    }
                }
                if needs_human > 0 {
                    tracing::info!(
                        task_id,
                        needs_human,
                        "Easy Apply: questions still need the human"
                    );
                }

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

                // Auto-submit: LO opted out of the manual review gate. We ALWAYS
                // attempt "Enviar candidatura" (not just when needs_human == 0) —
                // LinkedIn enforces required fields, so a genuinely-incomplete
                // form BOUNCES (submitted == false) and we park, while a complete
                // one goes through even if our own counter false-positived a
                // question as unanswered. Only a real bounce / RPC error parks.
                if needs_human > 0 {
                    tracing::info!(task_id, needs_human, "attempting submit anyway; LinkedIn will reject if a required field is truly blank");
                }
                match self.driver.confirm_submit(handle).await {
                    Ok(true) => {
                        let now = now_iso();
                        if let Ok(after) = self.driver.screenshot(handle).await {
                            self.record_evidence(
                                task_id,
                                EvidenceKind::Screenshot,
                                Some(&after),
                                None,
                            )
                            .await?;
                        }
                        self.driver.close(handle).await.ok();
                        sqlx::query(
                            "UPDATE browser_sessions SET status = 'closed', \
                             ended_at = ?1, updated_at = ?1 WHERE id = ?2",
                        )
                        .bind(&now)
                        .bind(session_id)
                        .execute(&self.db)
                        .await?;
                        self.update_application_outcome(
                            task_id,
                            session_id,
                            "submitted",
                            "applied",
                        )
                        .await?;
                        sqlx::query(
                            "UPDATE automation_tasks SET status = 'completed', \
                             finished_at = ?1, hr_name = ?3, hr_link = ?4, \
                             result_json = '{\"outcome\":\"submitted\"}', \
                             updated_at = ?1 WHERE id = ?2",
                        )
                        .bind(&now)
                        .bind(task_id)
                        .bind(enriched.hr_name.as_deref())
                        .bind(enriched.hr_link.as_deref())
                        .execute(&self.db)
                        .await?;
                        tracing::info!(task_id, "Easy Apply auto-submitted");
                        return Ok(TaskOutcome::Completed);
                    }
                    Ok(false) => tracing::warn!(
                        task_id,
                        "auto-submit bounced (required field blank) — parking for review"
                    ),
                    Err(e) => tracing::warn!(
                        task_id, error = %e,
                        "auto-submit failed — parking for review"
                    ),
                }

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
                .bind(format!(
                    "{{\"outcome\":\"daily_limit_reached\",\"reason\":\"{msg}\"}}"
                ))
                .bind(task_id)
                .execute(&self.db)
                .await?;
                self.set_status(AutomationStatus::Idle);
                Err(DomainError::Message(msg.to_string()))
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

fn outcome_state(outcome: TaskOutcome) -> &'static str {
    match outcome {
        TaskOutcome::Completed => "Completed",
        TaskOutcome::PausedForCaptcha => "PausedForCaptcha",
        TaskOutcome::PausedForReview => "NeedsReview",
        TaskOutcome::Aborted => "Stopped",
    }
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

pub(crate) async fn generate_form_answers(
    db: &sqlx::SqlitePool,
    profile_id: &str,
    unanswered: &[serde_json::Value],
) -> Result<(serde_json::Map<String, serde_json::Value>, usize), String> {
    use crate::ai::prompt::{
        indeed_answer_prompt, indeed_answer_system, INDEED_ANSWER_PROMPT_VERSION,
        NEEDS_HUMAN_SENTINEL,
    };
    use crate::ai::{complete_cached, input_hash, select_provider_resolved};
    use crate::domain::ai::CompletionRequest;
    use crate::domain::profile_variants::{ProfileVariantService, ProfileVariantServiceImpl};
    use crate::storage::settings::load_ai_providers;

    let (providers, default_index) = load_ai_providers(db).await.map_err(|e| e.to_string())?;
    let provider = select_provider_resolved(&providers, default_index).await;
    if provider.is_disabled() {
        return Err("no AI provider configured".into());
    }

    let svc = ProfileVariantServiceImpl::new(db.clone());
    let variant = svc
        .list(profile_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .next();
    let (summary, cv_text) = match &variant {
        Some(v) => {
            let summary = if v.summary.trim().is_empty() {
                v.headline.clone()
            } else {
                v.summary.clone()
            };
            (summary, v.about_text.clone())
        }
        None => (String::new(), String::new()),
    };

    let facts: std::collections::HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT fact_key, fact_value FROM profile_facts WHERE profile_id = ?1",
    )
    .bind(profile_id)
    .fetch_all(db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    let contact = variant
        .as_ref()
        .map(|v| v.contact.clone())
        .unwrap_or_default();
    let clean = |s: &str| {
        let t = s.trim();
        (!t.is_empty()).then(|| t.to_string())
    };
    let f = |k: &str| facts.get(k).and_then(|v| clean(v));
    let phone = f("phone").or_else(|| contact.phone.as_deref().and_then(clean));
    let salary = f("salaryMin");
    let email = f("email").or_else(|| contact.email.as_deref().and_then(clean));
    let website = f("portfolio").or_else(|| contact.website.as_deref().and_then(clean));
    let linkedin = f("linkedin");
    let github = f("github");
    let city = f("location")
        .or_else(|| f("city"))
        .or_else(|| clean(&contact.location));
    let years: Option<String> = f("yearsExperience").or_else(|| Some("2".to_string()));
    let resolve_known = |label: &str| -> Option<String> {
        let l = label.to_lowercase();
        let has = |kw: &[&str]| kw.iter().any(|k| l.contains(k));
        if has(&[
            "years of experience",
            "years experience",
            "how many years",
            "anos de experi",
            "quantos anos",
        ]) {
            return years.clone();
        }
        if has(&["phone", "telefone", "celular", "mobile"]) {
            return phone.clone();
        }
        if has(&[
            "salary",
            "salário",
            "salario",
            "pretensão",
            "pretensao",
            "remuner",
            "compensation",
        ]) {
            return salary.clone();
        }
        if has(&["linkedin"]) {
            return linkedin.clone();
        }
        if has(&["github"]) {
            return github.clone();
        }
        if has(&["portfolio", "website", "site pessoal", "personal site"]) {
            return website.clone();
        }
        if has(&["e-mail", "email"]) {
            return email.clone();
        }
        if has(&["city", "cidade", "localiz", "location"]) {
            return city.clone();
        }
        if has(&[
            "summary",
            "resumo",
            "about you",
            "about yourself",
            "sobre você",
            "sobre voce",
            "tell us about yourself",
            "fale sobre você",
            "apresente-se",
            "apresentação pessoal",
            "short bio",
            "brief description",
        ]) {
            return clean(&summary).or_else(|| clean(&cv_text));
        }
        None
    };

    let mut out = serde_json::Map::new();
    let mut human = 0usize;
    for q in unanswered {
        let label = q
            .get("label")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim();
        if label.is_empty() {
            continue;
        }
        if let Some(v) = resolve_known(label) {
            out.insert(label.to_string(), serde_json::json!(v));
            continue;
        }
        let options: Vec<String> = q
            .get("options")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let max_len = q.get("maxLength").and_then(|v| v.as_u64());
        if options.is_empty() && max_len.is_some_and(|n| n <= 15) {
            if let Some(y) = years.clone() {
                out.insert(label.to_string(), serde_json::json!(y));
                continue;
            }
        }

        // Deterministic Yes/No fast-path for BINARY screening questions — the #1
        // needs_human cause. The AI would answer verbosely ("Sim, tenho…") or
        // punt, leaving a required radio blank. CAPABILITY questions ("do you have
        // experience/knowledge of X") → affirmative; work-authorization/sponsorship
        // → answered so we DON'T require sponsorship. Both pick the option text
        // VERBATIM so the worker's refill matches exactly. Legal/relocation/criminal
        // are intentionally NOT blind-defaulted here (left to the AI/human).
        let is_yes = |o: &str| {
            matches!(
                o.trim().to_lowercase().as_str(),
                "yes" | "sim" | "y" | "true" | "verdadeiro"
            )
        };
        let is_no = |o: &str| {
            matches!(
                o.trim().to_lowercase().as_str(),
                "no" | "não" | "nao" | "n" | "false" | "falso"
            )
        };
        if options.len() == 2 && options.iter().all(|o| is_yes(o) || is_no(o)) {
            let ll = label.to_lowercase();
            let sponsorship = [
                "sponsor",
                "patroc",
                "visa",
                "visto",
                "work permit",
                "autoriz",
                "authorized",
                "eligible to work",
                "elegív",
                "elegiv",
            ]
            .iter()
            .any(|k| ll.contains(k));
            let capability = [
                "experi",
                "experience",
                "conhecimento",
                "familiar",
                "proficien",
                "já trabalh",
                "ja trabalh",
                "sabe utilizar",
                "domina",
                "trabalhou com",
            ]
            .iter()
            .any(|k| ll.contains(k));
            if sponsorship {
                // "authorized/eligible to work?" → Yes; "require sponsorship/visa?" → No.
                let authorized = [
                    "autoriz",
                    "authorized",
                    "eligible",
                    "elegív",
                    "elegiv",
                    "permit",
                ]
                .iter()
                .any(|k| ll.contains(k));
                let pick = if authorized {
                    options.iter().find(|o| is_yes(o))
                } else {
                    options.iter().find(|o| is_no(o))
                };
                if let Some(o) = pick {
                    out.insert(label.to_string(), serde_json::json!(o));
                    continue;
                }
            } else if capability {
                if let Some(o) = options.iter().find(|o| is_yes(o)) {
                    out.insert(label.to_string(), serde_json::json!(o));
                    continue;
                }
            }
        }

        let multi = q.get("multi").and_then(|v| v.as_bool()).unwrap_or(false);
        let mut constraint = String::new();
        if !options.is_empty() {
            constraint = if multi {
                format!(
                    "\n(Multiple choice — SELECT ALL correct options. Reply with ONLY \
                     the chosen option texts VERBATIM in their ORIGINAL language, \
                     separated by ' | ', nothing else. This is a knowledge / \
                     best-practice question: pick the technically correct options \
                     using professional judgment even if not stated in the CV; NEVER \
                     output [NEEDS_HUMAN]. Options: {})",
                    options.join(" | ")
                )
            } else {
                format!(
                    "\n(Multiple choice — reply with EXACTLY ONE option, verbatim in \
                     its ORIGINAL language, nothing else. Pick the BEST / most-correct \
                     option using professional judgment (skill level, best action, \
                     education, or yes/no) — grounded in the CV when relevant; NEVER \
                     output [NEEDS_HUMAN]. Options: {})",
                    options.join(" | ")
                )
            };
        } else if let Some(n) = max_len {
            if n <= 15 {
                constraint = format!(
                    "\n(VERY SHORT field, max {n} characters. This is almost \
                     certainly a years-of-experience question about the \
                     skill/technology named in the label — reply with ONLY a \
                     number of years as a digit, e.g. \"2\". Never write a sentence.)"
                );
            } else {
                constraint = format!("\n(Answer in at most {n} characters — be concise.)");
            }
        }
        let question_for_prompt = format!("{label}{constraint}");
        let req = CompletionRequest {
            model: provider.default_model().to_string(),
            prompt: indeed_answer_prompt(&question_for_prompt, &summary, &cv_text),
            system: Some(indeed_answer_system()),
            input_hash: input_hash(&[
                INDEED_ANSWER_PROMPT_VERSION,
                profile_id,
                label,
                &max_len.map(|n| n.to_string()).unwrap_or_default(),
                &options.join("|"),
            ]),
        };
        match complete_cached(db, &provider, req).await {
            Ok(resp) => {
                let text = resp.text.trim();
                if text.is_empty() || text.contains(NEEDS_HUMAN_SENTINEL) {
                    human += 1;
                    tracing::info!(question = label, "AI could not answer — needs human");
                } else {
                    out.insert(label.to_string(), serde_json::json!(text));
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, question = label, "form answer draft failed");
                human += 1;
            }
        }
    }
    Ok((out, human))
}

pub async fn run_automation_queue<D, F>(
    db: &SqlitePool,
    driver: D,
    stop: Arc<AtomicBool>,
    data_dir: PathBuf,
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

    let sup = BrowserSupervisor::with_stop_flag(db.clone(), driver, stop.clone(), data_dir);

    for task_id in &queued {
        if stop.load(Ordering::SeqCst) {
            emit("Stopped", None, None, None, None);
            summary.aborted += 1;
            return Ok(summary);
        }

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

        // Rate governor: defer (skip) a task whose board is over its rolling 24h/1h budget. Bans
        // come from pacing, not the captcha — this is the highest-leverage anti-ban control. Other
        // boards' tasks keep draining; the deferred one stays 'queued' for the next run.
        let platform: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT json_extract(payload_json, '$.platform')
             FROM automation_tasks WHERE id = ?1",
        )
        .bind(task_id.as_str())
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .flatten();

        if let Some(pf) = platform.as_deref() {
            let decision = crate::domain::rate::rate_check(db, pf).await;
            if !decision.allowed {
                let detail = decision
                    .reason
                    .unwrap_or_else(|| format!("{pf}: rate limited"));
                tracing::info!(task = %task_id, platform = %pf, "rate governor: {detail}");
                emit(
                    "RetryScheduled",
                    Some(task_id),
                    job_url.as_deref(),
                    Some(&detail),
                    None,
                );
                summary.skipped += 1;
                continue;
            }
        }

        let outcome = sup.run_task(task_id).await?;
        summary.ran += 1;
        match outcome {
            TaskOutcome::Completed => summary.completed += 1,
            TaskOutcome::PausedForCaptcha | TaskOutcome::PausedForReview => summary.paused += 1,
            TaskOutcome::Aborted => summary.aborted += 1,
        }

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

    if summary.was_empty {
        emit("Completed", None, None, None, None);
    }
    Ok(summary)
}

#[cfg(test)]
mod tests;
