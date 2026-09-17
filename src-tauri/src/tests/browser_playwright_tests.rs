use super::*;
use crate::domain::automation::{BrowserDriver, EasyApplyInput, SearchJobsInput, SessionSpec};
use crate::domain::profile_sync::{SyncSection, SyncSectionKind};
use std::fs;
use uuid::Uuid;

fn fixture_worker() -> PathBuf {
    let path = std::env::temp_dir().join(format!("hiremeops-worker-{}.mjs", Uuid::new_v4()));
    let source = r#"
import readline from 'node:readline';

const jobs = [{
  job_id: 'fixture-job',
  title: 'Backend Engineer',
  company: 'Fixture Co',
  location: 'Remote',
  apply_url: 'https://jobs.test/fixture',
  is_easy_apply: false,
  description: 'Synthetic browser-driver result'
}];
const posts = [{
  url: 'https://www.linkedin.com/feed/post/fixture',
  text: 'Synthetic hiring post',
  author: 'Fixture Recruiter'
}];

const reply = (request, data = {}) => {
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, ...data }) + '\n');
};

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  switch (request.cmd) {
    case 'open': reply(request, { handle: 'fixture-handle' }); break;
    case 'check_login': reply(request, { logged_in: true }); break;
    case 'check_logins': reply(request, {
      status: { linkedin: true },
      platform_status: { linkedin: 'valid' }
    }); break;
    case 'open_login_tabs': reply(request, { opened: request.sites ?? [] }); break;
    case 'export_storage_state': reply(request, {
      version: 1,
      storageState: { cookies: [], origins: [] }
    }); break;
    case 'probe': reply(request, { state: 'ApplyForm' }); break;
    case 'fill_easy_apply': reply(request, { unanswered: [{ label: 'email' }] }); break;
    case 'answer_easy_apply': reply(request, { unanswered: [] }); break;
    case 'confirm_submit': reply(request, { submitted: false }); break;
    case 'extract_hr': reply(request, { hr_name: 'Fixture Recruiter', hr_profile_url: 'https://jobs.test/hr' }); break;
    case 'dom_snapshot': reply(request, { dom: '<main>fixture</main>' }); break;
    case 'screenshot': reply(request, { path: request.path }); break;
    case 'search_indeed_jobs':
    case 'search_jobs':
    case 'catho_search_jobs':
    case 'infojobs_search_jobs':
    case 'upwork_search_jobs':
    case 'freelas99_search_jobs':
    case 'programathor_search_jobs':
    case 'geekhunter_search_jobs':
    case 'search_gupy_jobs': reply(request, { jobs, has_next_page: true }); break;
    case 'search_google': reply(request, { results: [{ url: 'https://jobs.test/google', title: 'Google fixture', snippet: 'Synthetic result' }], hasNextPage: true }); break;
    case 'search_linkedin_posts': reply(request, { posts, hasNextPage: true }); break;
    case 'auto_connect': reply(request, { sent: 2, status: 'ok' }); break;
    case 'gmail_send':
      reply(request, request.to === 'fail@test'
        ? { sent: false, error: 'fixture send failure' }
        : { sent: true });
      break;
    case 'push_profile':
    case 'catho_push_profile':
    case 'gupy_push_profile':
    case 'infojobs_push_profile': reply(request, { results: [{ kind: 'headline', status: 'ok' }] }); break;
    default: reply(request);
  }
});
"#;
    fs::write(&path, source).unwrap();
    path
}

pub(crate) fn fixture_driver() -> (PlaywrightDriver, PathBuf) {
    let worker = fixture_worker();
    let mut driver = PlaywrightDriver::new(
        std::env::temp_dir().join(format!("hiremeops-driver-{}", Uuid::new_v4())),
    );
    driver.worker_script = worker.clone();
    (driver, worker)
}

fn section() -> SyncSection {
    SyncSection {
        id: "headline".into(),
        kind: SyncSectionKind::Headline,
        label: "Headline".into(),
        edit_url: "https://jobs.test/edit".into(),
        copy_text: "Backend Engineer".into(),
        char_limit: Some(220),
        over_limit: false,
        metadata: None,
    }
}

#[tokio::test]
async fn fixture_worker_exercises_playwright_driver_contracts() {
    let (driver, worker) = fixture_driver();
    let spec = SessionSpec {
        profile_id: "profile-fixture".into(),
        platform: "linkedin".into(),
        user_data_dir: "/profiles/fixture".into(),
        extensions: vec![],
        headless: true,
    };
    let handle = driver.open(&spec).await.unwrap();
    assert_eq!(
        driver.current_session().await.as_deref(),
        Some(handle.as_str())
    );
    let login_handle = driver.open_login_session(&spec).await.unwrap();
    assert_eq!(
        driver.login_session_for("profile-fixture").await.as_deref(),
        Some(login_handle.as_str())
    );
    assert!(driver.login_session_for("other-profile").await.is_none());
    let login_handle = driver.open_login_session(&spec).await.unwrap();
    driver.close_session(&login_handle).await;
    driver.navigate(&handle, "https://jobs.test").await.unwrap();
    assert_eq!(driver.probe(&handle).await.unwrap(), PageState::ApplyForm);

    let input = EasyApplyInput {
        url: "https://jobs.test/fixture".into(),
        platform: "linkedin".into(),
        user_data_dir: None,
        cover_letter: Some("Synthetic cover letter".into()),
        cv_path: None,
        answers: vec![],
        hr_name: None,
        hr_link: None,
        task_id: Some("task-fixture".into()),
        session_id: Some("session-fixture".into()),
    };
    driver.fill_easy_apply(&handle, &input).await.unwrap();
    driver.reject_submit_parked().await.unwrap();
    assert_eq!(
        driver
            .fill_easy_apply_collect(&handle, &input)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(driver
        .answer_easy_apply(&handle, &json!({"questions": []}))
        .await
        .unwrap()
        .is_empty());
    assert!(!driver.confirm_submit(&handle).await.unwrap());
    let parked = driver.confirm_submit_parked().await.unwrap();
    assert_eq!(parked.task_id.as_deref(), Some("task-fixture"));
    assert_eq!(
        driver.dom_snapshot(&handle).await.unwrap(),
        "<main>fixture</main>"
    );
    assert!(driver
        .extract_hr(&handle)
        .await
        .unwrap()
        .unwrap()
        .contains("Fixture Recruiter"));
    assert!(driver.screenshot(&handle).await.unwrap().ends_with(".png"));
    driver.close(&handle).await.unwrap();

    assert!(driver.check_login("/profiles/fixture").await.unwrap());
    assert_eq!(
        driver
            .open_login_tabs("fixture-handle", &["linkedin", "gupy"])
            .await
            .unwrap()
            .len(),
        2
    );
    assert!(driver
        .check_logins("/profiles/fixture")
        .await
        .unwrap()
        .contains_key("linkedin"));
    assert!(driver
        .check_logins_detailed("/profiles/fixture")
        .await
        .unwrap()
        .contains_key("platform_status"));
    let (version, state) = driver.export_storage_state("fixture-handle").await.unwrap();
    assert_eq!(version, 1);
    driver
        .import_storage_state("fixture-handle", version, state)
        .await
        .unwrap();

    let search = SearchJobsInput {
        keywords: "rust".into(),
        location: "Remote".into(),
        page_index: 0,
        easy_apply_only: false,
        remote_only: true,
        date_posted: None,
    };
    assert_eq!(
        driver
            .search_jobs("fixture-handle", &search)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_indeed_jobs("fixture-handle", "rust", "Remote", 0, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_google("fixture-handle", "rust", 0)
            .await
            .unwrap()
            .results
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_linkedin_posts("fixture-handle", "rust", 0)
            .await
            .unwrap()
            .posts
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_upwork_jobs("/profiles/fixture", "rust", "recency", 1, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_freelas99_jobs("/profiles/fixture", "rust", 1, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_programathor_jobs("/profiles/fixture", "rust", 1, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_geekhunter_jobs("/profiles/fixture", "rust", true, 1, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_gupy_jobs("/profiles/fixture", "rust", true, 1, true)
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_catho_jobs(crate::browser::playwright::CathoSearchOptions {
                user_data_dir: "/profiles/fixture",
                query: "rust",
                area_ids: &[],
                work_models: &[],
                last_days: None,
                max_pages: 1,
                headless: true,
            })
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );
    assert_eq!(
        driver
            .search_infojobs_jobs(crate::browser::playwright::InfojobsSearchOptions {
                user_data_dir: "/profiles/fixture",
                query: "rust",
                location: "Remote",
                work_models: &[],
                last_days: None,
                max_pages: 1,
                headless: true,
            })
            .await
            .unwrap()
            .jobs
            .len(),
        1
    );

    assert!(driver
        .catho_apply(
            "/profiles/fixture",
            "offer",
            "https://jobs.test/apply",
            true
        )
        .await
        .unwrap()
        .is_object());
    assert!(driver
        .infojobs_apply(
            "/profiles/fixture",
            "offer",
            "https://jobs.test/apply",
            Some(&json!({"q": "a"})),
            true
        )
        .await
        .unwrap()
        .is_object());
    assert_eq!(
        driver
            .auto_connect("/profiles/fixture", 2, 0, true, None)
            .await
            .unwrap(),
        (2, "ok".to_string())
    );
    assert!(driver
        .fill_indeed_apply("fixture-handle", "https://jobs.test/apply", &json!([]))
        .await
        .unwrap()
        .is_object());
    assert!(driver
        .answer_indeed_free_text("fixture-handle", &json!([]))
        .await
        .unwrap()
        .is_object());
    assert!(driver
        .confirm_indeed_submit_parked()
        .await
        .unwrap()
        .screenshot_path
        .is_some());
    assert!(driver
        .fill_indeed_apply("fixture-handle", "https://jobs.test/apply", &json!([]))
        .await
        .unwrap()
        .is_object());
    driver.reject_indeed_submit_parked().await.unwrap();
    assert!(driver
        .gmail_send("fixture-handle", "to@test", "subject", "body", None)
        .await
        .unwrap());
    let error = driver
        .gmail_send("fixture-handle", "fail@test", "subject", "body", None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("fixture send failure"));

    let sections = vec![section()];
    assert_eq!(
        driver
            .push_profile_sections("/profiles/fixture", &sections, true)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        driver
            .push_catho_sections("/profiles/fixture", &sections, true)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        driver
            .push_gupy_profile("/profiles/fixture", &json!({"skills": []}), true)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        driver
            .push_infojobs_profile("/profiles/fixture", &json!({"skills": []}), true)
            .await
            .unwrap()
            .len(),
        1
    );
    driver.gupy_start_login("fixture-handle").await.unwrap();

    fs::remove_file(worker).unwrap();
}
