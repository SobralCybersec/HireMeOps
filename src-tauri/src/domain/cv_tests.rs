use super::*;
use crate::ai::prompt::CvContact;
use crate::ai::prompt::CvExperienceEntry;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

#[test]
fn rewrite_report_recovers_structured_preview_and_metadata() {
    let saved = CvRewrite {
        summary: include_str!("../../tests/fixtures/summary-rewrite.txt").to_string(),
        ..Default::default()
    };
    let report = rewrite_report((
        "rewrite".into(),
        None,
        None,
        None,
        None,
        None,
        None,
        serde_json::to_string(&saved).unwrap(),
        serde_json::to_string(&saved.cv_metadata()).unwrap(),
        None,
        "2026-09-10".into(),
    ));
    let response = serde_json::to_value(report).unwrap();
    assert_eq!(response["rewrite"]["name"], "Candidate");
    assert_eq!(
        response["rewrite"]["summary"],
        "Design gráfico e direção de arte."
    );
    assert_eq!(
        response["rewrite"]["contact"]["email"],
        "candidate@example.com"
    );
    assert_eq!(response["rewrite"]["skills"][0]["skills"], "Figma");
    assert_eq!(response["rewrite"]["experience"][0]["title"], "Designer");
    assert_eq!(response["metadata"]["author"], "Candidate");
    assert_eq!(
        response["metadata"]["description"],
        response["rewrite"]["summary"]
    );
}

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

#[test]
fn backfill_fills_only_empty_fields_from_source_text() {
    let mut contact = CvContact::default();
    backfill_contact(
        "João Silva\njoao.silva@email.com\n+55 11 91234-5678\n\
             https://github.com/joaosilva  gitlab.com/joao-dev\n\
             https://linkedin.com/in/joao-silva",
        &mut contact,
    );
    assert_eq!(contact.email, "joao.silva@email.com");
    assert_eq!(contact.phone, "+55 11 91234-5678");
    assert_eq!(contact.github, "joaosilva");
    assert_eq!(contact.gitlab, "joao-dev");
    assert_eq!(contact.linkedin, "joao-silva");
    assert!(contact.website.is_empty(), "website must stay empty");

    let mut prefilled = CvContact {
        email: "kept@mail.com".to_string(),
        ..Default::default()
    };
    backfill_contact("other@mail.com", &mut prefilled);
    assert_eq!(prefilled.email, "kept@mail.com");
}

#[test]
fn backfill_handles_utf8_before_contact_links_without_panicking() {
    let mut contact = CvContact::default();
    backfill_contact(
        "Óscar João — óscar.joao@example.com — https://github.com/oscarjoao",
        &mut contact,
    );

    assert_eq!(contact.email, "óscar.joao@example.com");
    assert_eq!(contact.github, "oscarjoao");
}

#[test]
fn backfill_extracts_profile_and_project_links_from_source() {
    let source = "LinkedIn: HTTPS://www.linkedin.com/in/jane-doe\n\
        GitHub: https://github.com/jane-doe\n\
        GitLab: www.gitlab.com/jane-doe\n\
        Portfolio: https://www.behance.net/gallery/99/brand\n\
        Project Alpha — https://github.com/jane-doe/project-alpha\n\
        Project Beta — gitlab.com/jane-doe/project-beta";
    let mut contact = CvContact::default();
    backfill_contact(source, &mut contact);
    assert_eq!(contact.linkedin, "jane-doe");
    assert_eq!(contact.github, "jane-doe");
    assert_eq!(contact.gitlab, "jane-doe");
    assert_eq!(contact.website, "https://www.behance.net/gallery/99/brand");

    let mut entries = vec![
        CvExperienceEntry {
            title: "Project Alpha".into(),
            ..Default::default()
        },
        CvExperienceEntry {
            title: "Project Beta".into(),
            ..Default::default()
        },
    ];
    backfill_project_links(source, &mut entries);
    assert_eq!(entries[0].url, "https://github.com/jane-doe/project-alpha");
    assert_eq!(entries[1].url, "https://gitlab.com/jane-doe/project-beta");
}

fn unique_tmp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("hiremeops-cv-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fixture(name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

#[tokio::test]
async fn read_bytes_returns_stored_content_and_errors_on_unknown_id() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    let tmp = unique_tmp_dir();
    let svc = CvServiceImpl::new(pool.clone(), tmp.clone());
    let pdf = fixture("sample.pdf");

    let id = svc.import_document("p1", &pdf).await.unwrap();

    let got = svc.read_bytes(&id).await.unwrap();
    let expected = std::fs::read(&pdf).unwrap();
    assert_eq!(got, expected);
    assert!(!got.is_empty());

    let err = svc.read_bytes("does-not-exist").await.unwrap_err();
    assert!(matches!(err, DomainError::InvalidInput(_)));
}

#[tokio::test]
async fn imports_pdf_persists_metadata_and_is_idempotent() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    let tmp = unique_tmp_dir();
    let svc = CvServiceImpl::new(pool.clone(), tmp.clone());
    let pdf = fixture("sample.pdf");

    let id1 = svc.import_document("p1", &pdf).await.unwrap();

    let (ft, pages, size, ver): (String, Option<i64>, Option<i64>, Option<String>) =
        sqlx::query_as(
            "SELECT file_type, page_count, size_bytes, parser_version
                 FROM cv_documents WHERE id = ?1",
        )
        .bind(&id1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ft, "pdf");
    assert_eq!(pages, Some(2));
    assert!(size.unwrap() > 0);
    assert_eq!(ver.as_deref(), Some(cv::PARSER_VERSION));

    assert!(tmp.join("p1").read_dir().unwrap().next().is_some());

    let id2 = svc.import_document("p1", &pdf).await.unwrap();
    assert_eq!(id1, id2);
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn imports_docx_with_no_page_count() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    let tmp = unique_tmp_dir();
    let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

    let id = svc
        .import_document("p1", &fixture("sample.docx"))
        .await
        .unwrap();
    let (ft, pages): (String, Option<i64>) =
        sqlx::query_as("SELECT file_type, page_count FROM cv_documents WHERE id = ?1")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(ft, "docx");
    assert_eq!(pages, None);

    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn rejects_unsupported_extension_without_persisting() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1").await;
    let tmp = unique_tmp_dir();
    let svc = CvServiceImpl::new(pool.clone(), tmp.clone());

    let err = svc
        .import_document("p1", "/nonexistent/whatever.txt")
        .await
        .unwrap_err();
    assert!(matches!(err, DomainError::InvalidInput(_)));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cv_documents")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);

    std::fs::remove_dir_all(&tmp).ok();
}
