use super::{
    google_queries, linkedin_post_queries, linkedin_post_title, linkedin_post_url,
    linkedin_variants,
};
use crate::domain::automation::LinkedInPost;
use std::sync::Arc;
use tauri::Manager;

#[test]
fn linkedin_variants_remove_boolean_operators_and_deduplicate_terms() {
    let variants = linkedin_variants("Rust OR rust (Backend) NOT Java");

    assert_eq!(variants[0], "Rust OR rust (Backend) NOT Java");
    assert!(variants
        .iter()
        .any(|query| query == "\"Rust\" AND \"Backend\" AND \"Java\""));
    assert!(variants.iter().any(|query| query == "\"Rust\""));
    assert!(variants.iter().all(|query| !query.is_empty()));
}

#[test]
fn linkedin_variants_keep_simple_queries_stable() {
    assert_eq!(linkedin_variants("rust"), vec!["rust"]);
    assert_eq!(linkedin_variants(""), vec![""]);
}

#[test]
fn google_queries_include_direct_contact_and_linkedin_variants() {
    let queries = google_queries("backend engineer");

    assert_eq!(queries.len(), 3);
    assert_eq!(queries[0], "backend engineer");
    assert!(queries[1].contains("@gmail.com"));
    assert!(queries[2].starts_with("site:linkedin.com/posts"));
}

#[test]
fn linkedin_post_queries_are_bounded_and_cover_role_and_skills() {
    let queries = linkedin_post_queries("Rust, Backend, Remote");

    assert!(queries.len() <= 18);
    assert!(queries
        .iter()
        .any(|query| query == "Rust vaga Backend Remote"));
    assert!(queries.iter().any(|query| query == "Rust Backend hiring"));
    assert_eq!(linkedin_post_queries("   "), vec!["envie currículo"]);
}

#[test]
fn linkedin_post_url_prefers_source_and_builds_fallback() {
    let source = LinkedInPost {
        url: Some(" https://jobs.test/post/1 ".into()),
        text: "ignored".into(),
        author: None,
        email: None,
    };
    assert_eq!(linkedin_post_url(&source), " https://jobs.test/post/1 ");

    let fallback = LinkedInPost {
        url: Some(String::new()),
        text: "Hiring Rust engineers".into(),
        author: None,
        email: None,
    };
    assert!(linkedin_post_url(&fallback).starts_with("https://www.linkedin.com/feed/hiring-post/"));
}

#[test]
fn linkedin_post_title_uses_first_line_and_author_fallback() {
    let post = LinkedInPost {
        url: None,
        text: "  Backend role\nDetails".into(),
        author: Some("Recruiter".into()),
        email: None,
    };
    assert_eq!(linkedin_post_title(&post), "Backend role");

    let empty = LinkedInPost {
        url: None,
        text: "\n".into(),
        author: Some("Recruiter".into()),
        email: None,
    };
    assert_eq!(linkedin_post_title(&empty), "Post by Recruiter");

    let long = LinkedInPost {
        url: None,
        text: format!("{}\nmore", "x".repeat(100)),
        author: None,
        email: None,
    };
    assert_eq!(linkedin_post_title(&long).chars().count(), 80);
}

#[tokio::test]
async fn linkedin_and_google_searches_ingest_fixture_results() {
    let db = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    sqlx::query(
        "INSERT INTO profiles (id, display_name, created_at, updated_at, is_active)
         VALUES ('p1', 'Candidate', 'now', 'now', 1)",
    )
    .execute(&db)
    .await
    .unwrap();
    let (driver, worker) = crate::browser::playwright::tests::fixture_driver();
    let data_dir = std::env::temp_dir().join(format!("hiremeops-scrape-{}", uuid::Uuid::new_v4()));
    let app = crate::test_support::app_with_driver(db, Arc::new(driver), data_dir);
    let state = app.state::<crate::AppState>();
    let app_handle = app.handle();

    let linkedin = super::run_linkedin_search_real(
        state.inner(),
        app_handle,
        super::LinkedInSearchInput {
            profile_id: "p1".into(),
            search_query_id: None,
            keywords: "rust".into(),
            location: Some("Remote".into()),
            page_index: Some(0),
            easy_apply_only: Some(false),
            remote_only: Some(false),
            date_posted: None,
            max_pages: Some(1),
        },
    )
    .await
    .unwrap();
    assert_eq!(linkedin.ingested, 1);
    assert_eq!(linkedin.pages_scraped, 1);

    let google = super::run_google_search_real(
        state.inner(),
        app_handle,
        super::GoogleSearchInput {
            profile_id: "p1".into(),
            search_query_id: None,
            query: "rust".into(),
            max_pages: Some(1),
        },
    )
    .await
    .unwrap();
    assert_eq!(google.ingested, 1);
    assert_eq!(google.skipped_duplicates, 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM job_posts")
            .fetch_one(&state.db)
            .await
            .unwrap(),
        4
    );
    let _ = std::fs::remove_file(worker);
}
