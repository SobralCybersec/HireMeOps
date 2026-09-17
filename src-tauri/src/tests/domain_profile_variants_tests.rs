use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;

async fn mem_pool() -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn insert_profile(pool: &SqlitePool, id: &str, location: Option<&str>) {
    sqlx::query(
        "INSERT INTO profiles (id, display_name, location, created_at, updated_at, is_active)
             VALUES (?1, 'Test profile', ?2, '2026-01-01T00:00:00Z',
                     '2026-01-01T00:00:00Z', 1)",
    )
    .bind(id)
    .bind(location)
    .execute(pool)
    .await
    .unwrap();
}

fn rewrite() -> CvRewrite {
    CvRewrite {
        name: "Test Person".into(),
        positions: vec!["Backend Engineer".into(), "Rust Developer".into()],
        summary: "Builds reliable services.".into(),
        skills: vec![CvSkillGroup {
            category: "Backend".into(),
            skills: "Rust, PostgreSQL".into(),
        }],
        experience: vec![CvExperienceEntry {
            title: "Engineer".into(),
            organization: "Example Co".into(),
            location: "Lisbon".into(),
            ..Default::default()
        }],
        education: vec![CvEducationEntry {
            degree: "Computer Science".into(),
            institution: "Example University".into(),
            ..Default::default()
        }],
        ..Default::default()
    }
}

async fn insert_rewrite(pool: &SqlitePool, id: &str, profile_id: &str, value: &CvRewrite) {
    let rewrite_json = serde_json::to_string(value).unwrap();
    let metadata = CvMetadata {
        keywords: "Rust, rust; PostgreSQL\nTokio".into(),
        ..Default::default()
    };
    sqlx::query(
        "INSERT INTO cv_rewrites
             (id, profile_id, rewrite_json, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .bind(profile_id)
    .bind(rewrite_json)
    .bind(serde_json::to_string(&metadata).unwrap())
    .execute(pool)
    .await
    .unwrap();
}

#[test]
fn text_builders_trim_deduplicate_and_truncate() {
    assert_eq!(truncate_chars("abc", 3), "abc");
    assert_eq!(truncate_chars("abcdef", 4), "abc…");
    assert_eq!(truncate_chars("éééé", 3), "éé…");
    assert_eq!(build_headline(&[], "  Default title  "), "Default title");
    assert_eq!(
        build_headline(&[" Backend ".into(), "".into(), "Rust".into()], "fallback"),
        "Backend | Rust"
    );
    assert_eq!(
        split_keywords("Rust, rust; SQL\nRust  "),
        vec!["Rust", "SQL"]
    );
    assert!(build_about("summary", &[]).eq("summary"));
    assert_eq!(
        build_about(
            "summary",
            &[CvSkillGroup {
                skills: "Rust".into(),
                ..Default::default()
            }]
        ),
        "summary\n\nCore skills: Rust"
    );
}

#[test]
fn row_decoder_handles_missing_and_malformed_json() {
    let row = VariantRow {
        id: "v1".into(),
        profile_id: "p1".into(),
        name: "Variant".into(),
        target_title: "Backend".into(),
        summary: None,
        headline: None,
        keywords_json: Some("not-json".into()),
        positions_json: None,
        skills_json: Some("[]".into()),
        experience_json: None,
        education_json: None,
        contact_json: Some("not-json".into()),
        about_text: None,
        source_cv_document_id: None,
        source_rewrite_id: None,
        created_at: "now".into(),
        updated_at: "now".into(),
    };
    let dto = row_to_dto(row);
    assert_eq!(dto.summary, "");
    assert_eq!(dto.headline, "");
    assert!(dto.keywords.is_empty());
    assert!(dto.skills.is_empty());
    assert_eq!(dto.contact, ContactInfo::default());
}

#[tokio::test]
async fn service_creates_reads_updates_and_deletes_variant() {
    let pool = mem_pool().await;
    insert_profile(&pool, "p1", Some("São Paulo")).await;
    let source = rewrite();
    insert_rewrite(&pool, "rw1", "p1", &source).await;
    let service = ProfileVariantServiceImpl::new(pool.clone());

    let created = service
        .create_from_rewrite("p1", "rw1", Some("  ".into()))
        .await
        .unwrap();
    assert_eq!(created.name, "Backend Engineer");
    assert_eq!(created.headline, "Backend Engineer | Rust Developer");
    assert!(created.about_text.contains("Core skills: Rust, PostgreSQL"));
    assert_eq!(created.keywords, vec!["Rust", "PostgreSQL", "Tokio"]);
    assert_eq!(created.contact.name, "Test Person");
    assert_eq!(created.contact.location, "São Paulo");

    let listed = service.list("p1").await.unwrap();
    assert_eq!(listed.len(), 1);
    let updated = service
        .update(
            &created.id,
            UpdateVariantInput {
                name: Some("  Custom name ".into()),
                headline: Some(" Custom headline ".into()),
                summary: Some(" New summary ".into()),
                about_text: Some(" New about ".into()),
                keywords: Some("Rust; Docker, rust".into()),
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "Custom name");
    assert_eq!(updated.headline, "Custom headline");
    assert_eq!(updated.summary, "New summary");
    assert_eq!(updated.about_text, "New about");
    assert_eq!(updated.keywords, vec!["Rust", "Docker"]);

    service.delete(&created.id).await.unwrap();
    assert!(matches!(
        service.get(&created.id).await,
        Err(DomainError::InvalidInput(_))
    ));
}

#[tokio::test]
async fn source_validation_and_location_fallbacks_are_explicit() {
    let pool = mem_pool().await;
    let source = rewrite();
    insert_profile(&pool, "p1", None).await;
    insert_profile(&pool, "p2", Some("Curitiba")).await;
    insert_rewrite(&pool, "rw1", "p1", &source).await;
    let service = ProfileVariantServiceImpl::new(pool.clone());

    assert!(matches!(
        service.create_from_rewrite("p2", "rw1", None).await,
        Err(DomainError::InvalidInput(message)) if message.contains("different profile")
    ));
    assert!(matches!(
        service.create_from_rewrite("p1", "missing", None).await,
        Err(DomainError::InvalidInput(message)) if message.contains("unknown cv_rewrite")
    ));
    assert!(matches!(
        service.get("missing").await,
        Err(DomainError::InvalidInput(message)) if message.contains("unknown profile_variant")
    ));
    assert_eq!(variant_location(&pool, "p1", &source).await, "Lisbon");
    assert_eq!(variant_location(&pool, "p2", &source).await, "Curitiba");

    let mut no_location = source;
    no_location.experience[0].location = "  ".into();
    assert_eq!(variant_location(&pool, "p1", &no_location).await, "");
}
