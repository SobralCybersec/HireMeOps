use super::*;

#[test]
fn parse_search_jobs_accepts_valid_payload_and_defaults_missing_fields() {
    let valid = serde_json::json!({
        "jobs": [{
            "job_id": "job-1",
            "title": "Backend",
            "company": "Example",
            "location": "Remote",
            "apply_url": "https://jobs.test/1",
            "is_easy_apply": false
        }],
        "has_next_page": true
    })
    .as_object()
    .unwrap()
    .clone();
    let result = parse_search_jobs(valid);
    assert_eq!(result.jobs.len(), 1);
    assert_eq!(result.jobs[0].title.as_deref(), Some("Backend"));
    assert!(result.has_next_page);

    let empty = parse_search_jobs(serde_json::Map::new());
    assert!(empty.jobs.is_empty());
    assert!(!empty.has_next_page);
}
