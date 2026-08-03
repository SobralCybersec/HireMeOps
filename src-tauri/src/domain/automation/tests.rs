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
            return Err(DomainError::Message("browser launch failed".to_string()));
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
    async fn fill_easy_apply(&self, _handle: &str, _input: &EasyApplyInput) -> DomainResult<()> {
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
    async fn search_jobs(
        &self,
        _handle: &str,
        _input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult> {
        Ok(SearchJobsResult {
            jobs: vec![],
            has_next_page: false,
        })
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

    let sup = BrowserSupervisor::new(
        pool.clone(),
        MockDriver::new(PageState::NoAction),
        PathBuf::new(),
    );
    let out = sup.run_task("t1").await.unwrap();

    assert_eq!(out, TaskOutcome::Completed);
    assert_eq!(sup.status(), AutomationStatus::Idle);
    let (status, ended) = session_status(&pool, "p1").await;
    assert_eq!(status, "closed");
    assert!(ended.is_some(), "closed session must have ended_at");
    assert_eq!(task_status(&pool, "t1").await, "completed");
    assert_eq!(evidence_count(&pool, "t1").await, 1);
}

#[tokio::test]
async fn captcha_wall_pauses_and_never_solves() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;

    let driver = MockDriver::new(PageState::CaptchaWall);
    let fills = driver.fill_calls.clone();
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    let out = sup.run_task("t1").await.unwrap();

    assert_eq!(out, TaskOutcome::PausedForCaptcha);
    assert_eq!(sup.status(), AutomationStatus::PausedForCaptcha);
    assert_eq!(fills.load(Ordering::SeqCst), 0);
    let (status, ended) = session_status(&pool, "p1").await;
    assert_eq!(status, "paused_captcha");
    assert!(ended.is_none(), "paused session stays open for the human");
    assert_eq!(task_status(&pool, "t1").await, "paused_captcha");
    assert_eq!(evidence_count(&pool, "t1").await, 2);
}

#[tokio::test]
async fn apply_form_fills_then_auto_submits() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;

    // Every question answered (mock returns no unanswered) → the review gate
    // is skipped and the form is auto-submitted (LO opted out of the pause).
    let driver = MockDriver::new(PageState::ApplyForm);
    let fills = driver.fill_calls.clone();
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    let out = sup.run_task("t1").await.unwrap();

    assert_eq!(out, TaskOutcome::Completed);
    assert_eq!(fills.load(Ordering::SeqCst), 1, "form filled exactly once");
    let (status, ended) = session_status(&pool, "p1").await;
    assert_eq!(status, "closed");
    assert!(ended.is_some(), "auto-submit closes the browser session");
    assert_eq!(task_status(&pool, "t1").await, "completed");
    // FormState + pre-submit screenshot + post-submit screenshot
    assert_eq!(evidence_count(&pool, "t1").await, 3);
}

#[tokio::test]
async fn emergency_stop_mid_flow_aborts() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;

    let stop = Arc::new(AtomicBool::new(false));
    let mut driver = MockDriver::new(PageState::ApplyForm);
    driver.stop_on_navigate = Some(stop.clone());
    let fills = driver.fill_calls.clone();
    let sup = BrowserSupervisor::with_stop_flag(pool.clone(), driver, stop, PathBuf::new());
    let out = sup.run_task("t1").await.unwrap();

    assert_eq!(out, TaskOutcome::Aborted);
    assert_eq!(sup.status(), AutomationStatus::Stopped);
    assert_eq!(fills.load(Ordering::SeqCst), 0, "aborted before filling");
    let (status, ended) = session_status(&pool, "p1").await;
    assert_eq!(status, "stopped");
    assert!(ended.is_some());
    assert_eq!(task_status(&pool, "t1").await, "queued");
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

    let sup = BrowserSupervisor::new(
        pool.clone(),
        MockDriver::new(PageState::NoAction),
        PathBuf::new(),
    );
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
    let sup = BrowserSupervisor::new(pool, MockDriver::new(PageState::NoAction), PathBuf::new());
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
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    let err = sup.run_task("t1").await.unwrap_err();

    assert!(matches!(err, DomainError::Message(_)));
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
    set_setting(&pool, "browser_extensions", r#"["/ext/a","/ext/b"]"#).await;

    let driver = MockDriver::new(PageState::NoAction);
    let captured = driver.opened_extensions.clone();
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    sup.run_task("t1").await.unwrap();

    let seen = captured.lock().unwrap().clone();
    assert_eq!(seen, Some(vec!["/ext/a".to_string(), "/ext/b".to_string()]));
}

#[tokio::test]
async fn run_task_defaults_to_no_extensions_when_setting_absent() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;

    let driver = MockDriver::new(PageState::NoAction);
    let captured = driver.opened_extensions.clone();
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    sup.run_task("t1").await.unwrap();

    assert_eq!(captured.lock().unwrap().clone(), Some(Vec::<String>::new()));
}

type Emission = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[allow(clippy::type_complexity)] // test-only recorder; impl-Trait return can't be aliased
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

    let summary = run_automation_queue(
        &pool,
        MockDriver::new(PageState::NoAction),
        stop,
        PathBuf::new(),
        emit,
    )
    .await
    .unwrap();

    assert!(summary.was_empty);
    assert_eq!(summary.ran, 0);
    let states: Vec<String> = log
        .lock()
        .unwrap()
        .iter()
        .map(|(s, _, _, _, _)| s.clone())
        .collect();
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

    let summary = run_automation_queue(
        &pool,
        MockDriver::new(PageState::NoAction),
        stop,
        PathBuf::new(),
        emit,
    )
    .await
    .unwrap();

    assert_eq!(summary.ran, 2);
    assert_eq!(summary.completed, 2);
    assert!(!summary.was_empty);
    assert_eq!(task_status(&pool, "t1").await, "completed");
    assert_eq!(task_status(&pool, "t2").await, "completed");
    let emitted = log.lock().unwrap().clone();
    assert_eq!(
        emitted[0],
        ("PreparingBrowser".into(), None, None, None, None)
    );
    let url = Some("https://linkedin.com/jobs/view/1".to_string());
    assert!(emitted.contains(&(
        "Completed".into(),
        Some("t1".into()),
        url.clone(),
        None,
        None
    )));
    assert!(emitted.contains(&("Completed".into(), Some("t2".into()), url, None, None)));
}

#[tokio::test]
async fn latch_set_before_drain_stops_without_running() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;
    let (log, emit) = recorder();
    let stop = Arc::new(AtomicBool::new(true));

    let summary = run_automation_queue(
        &pool,
        MockDriver::new(PageState::NoAction),
        stop,
        PathBuf::new(),
        emit,
    )
    .await
    .unwrap();

    assert_eq!(summary.ran, 0);
    assert_eq!(summary.aborted, 1);
    assert_eq!(task_status(&pool, "t1").await, "queued");
    let states: Vec<String> = log
        .lock()
        .unwrap()
        .iter()
        .map(|(s, _, _, _, _)| s.clone())
        .collect();
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

    let summary = run_automation_queue(
        &pool,
        MockDriver::new(PageState::CaptchaWall),
        stop,
        PathBuf::new(),
        emit,
    )
    .await
    .unwrap();

    assert_eq!(summary.paused, 1);
    assert_eq!(summary.ran, 1);
    assert_eq!(task_status(&pool, "t1").await, "paused_captcha");
    assert_eq!(task_status(&pool, "t2").await, "queued");
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
        PathBuf::new(),
        emit,
    )
    .await;

    assert!(result.is_err(), "expected Err but got Ok");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("daily") || msg.contains("limit"),
        "error message should mention the limit; got: {msg}"
    );
    assert_eq!(task_status(&pool, "t1").await, "failed");
}

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
        match (&self.hr_name, &self.hr_link) {
            (Some(n), Some(l)) => {
                let json = serde_json::json!({"name": n, "profile_url": l});
                Ok(Some(serde_json::to_string(&json).unwrap()))
            }
            _ => Ok(None),
        }
    }
    async fn search_jobs(
        &self,
        _handle: &str,
        _input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult> {
        Ok(SearchJobsResult {
            jobs: vec![],
            has_next_page: false,
        })
    }
}

#[tokio::test]
async fn apply_form_persists_hr_link_to_completed_row() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    insert_apply_task(&pool, "t1", "p1").await;

    let driver = HrMockDriver::new(Some("Jane Smith"), Some("https://linkedin.com/in/jsmith"));
    let sup = BrowserSupervisor::new(pool.clone(), driver, PathBuf::new());
    let out = sup.run_task("t1").await.unwrap();

    // Auto-submitted (all answered); hr contact still recorded on the row.
    assert_eq!(out, TaskOutcome::Completed);

    let (hr_name, hr_link): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT hr_name, hr_link FROM automation_tasks WHERE id = 't1'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(hr_name.as_deref(), Some("Jane Smith"));
    assert_eq!(hr_link.as_deref(), Some("https://linkedin.com/in/jsmith"));
}
