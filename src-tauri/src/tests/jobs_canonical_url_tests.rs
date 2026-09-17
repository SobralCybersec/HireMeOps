use super::*;

#[test]
fn strips_utm_params() {
    let url = "https://jobs.example.com/post/123?utm_source=linkedin&utm_medium=social&id=42";
    assert_eq!(canonicalize(url), "https://jobs.example.com/post/123?id=42");
}

#[test]
fn strips_gclid_fbclid_trk() {
    let url = "https://example.com/job?gclid=abc&fbclid=xyz&trk=pub&jobId=99";
    assert_eq!(canonicalize(url), "https://example.com/job?jobId=99");
}

#[test]
fn drops_fragment() {
    assert_eq!(
        canonicalize("https://example.com/jobs/42#apply"),
        "https://example.com/jobs/42"
    );
}

#[test]
fn strips_trailing_slash() {
    assert_eq!(
        canonicalize("https://example.com/jobs/"),
        "https://example.com/jobs"
    );
}

#[test]
fn lowercases_scheme_and_host() {
    let got = canonicalize("HTTPS://LinkedIn.COM/jobs/view/123");
    assert_eq!(got, "https://linkedin.com/jobs/view/123");
}

#[test]
fn preserves_path_case() {
    let got = canonicalize("https://Example.COM/Jobs/View/123");
    assert_eq!(got, "https://example.com/Jobs/View/123");
}

#[test]
fn sorts_query_params() {
    assert_eq!(
        canonicalize("https://example.com/job?z=1&a=2&m=3"),
        "https://example.com/job?a=2&m=3&z=1"
    );
}

#[test]
fn no_query_unchanged() {
    assert_eq!(
        canonicalize("https://example.com/jobs/view/123"),
        "https://example.com/jobs/view/123"
    );
}

#[test]
fn all_tracking_stripped_leaves_no_question_mark() {
    let url = "https://example.com/job?utm_source=x&gclid=y";
    assert_eq!(canonicalize(url), "https://example.com/job");
}
