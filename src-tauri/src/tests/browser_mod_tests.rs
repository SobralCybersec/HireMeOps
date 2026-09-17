use super::{extension_args, ChromiumDriver};
use crate::domain::automation::{BrowserDriver, EasyApplyInput, SearchJobsInput};

fn v(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn no_paths_returns_empty() {
    assert!(extension_args(&[]).is_empty());
}

#[test]
fn blank_and_empty_paths_are_dropped() {
    assert!(extension_args(&v(&["", "   ", "\t"])).is_empty());
}

#[test]
fn single_path_emits_two_flags() {
    let args = extension_args(&v(&["/ext/one"]));
    assert_eq!(
        args,
        vec![
            "--disable-extensions-except=/ext/one".to_string(),
            "--load-extension=/ext/one".to_string(),
        ]
    );
}

#[test]
fn multiple_paths_are_comma_joined_and_trimmed() {
    let args = extension_args(&v(&["  /ext/a ", "", "/ext/b"]));
    assert_eq!(
        args,
        vec![
            "--disable-extensions-except=/ext/a,/ext/b".to_string(),
            "--load-extension=/ext/a,/ext/b".to_string(),
        ]
    );
}

#[tokio::test]
async fn unknown_handle_errors_are_consistent_across_driver_operations() {
    let driver = ChromiumDriver::new("/tmp/hiremeops-browser-tests");
    let input = EasyApplyInput {
        url: "https://jobs.test/1".into(),
        platform: "linkedin".into(),
        user_data_dir: None,
        cover_letter: None,
        cv_path: None,
        answers: vec![],
        hr_name: None,
        hr_link: None,
        task_id: None,
        session_id: None,
    };
    let search = SearchJobsInput {
        keywords: "rust".into(),
        location: String::new(),
        page_index: 0,
        easy_apply_only: true,
        remote_only: false,
        date_posted: None,
    };
    for result in [
        driver.navigate("missing", "https://jobs.test").await.err(),
        driver.probe("missing").await.err(),
        driver.fill_easy_apply("missing", &input).await.err(),
        driver.screenshot("missing").await.err(),
        driver.dom_snapshot("missing").await.err(),
        driver.close("missing").await.err(),
        driver.extract_hr("missing").await.err(),
    ] {
        assert!(result.is_some(), "unknown handle must return an error");
    }
    assert!(matches!(
        driver.search_jobs("missing", &search).await,
        Err(crate::domain::DomainError::NotImplemented(_))
    ));
}
