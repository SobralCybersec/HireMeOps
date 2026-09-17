use super::*;
use crate::ai::prompt::CvRewrite;
use tauri::Manager;

#[tokio::test]
async fn exports_saved_summary_json_as_a_structured_pdf() {
    let db = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query("CREATE TABLE cv_rewrites (id TEXT, rewrite_json TEXT, metadata_json TEXT, cv_document_id TEXT)")
        .execute(&db).await.unwrap();
    let saved = CvRewrite {
        summary: include_str!("../../tests/fixtures/summary-rewrite.txt").to_string(),
        ..Default::default()
    };
    sqlx::query("INSERT INTO cv_rewrites VALUES ('saved', ?1, ?2, NULL)")
        .bind(serde_json::to_string(&saved).unwrap())
        .bind(serde_json::to_string(&saved.cv_metadata()).unwrap())
        .execute(&db)
        .await
        .unwrap();
    let (rewrite, metadata, _) = load_rewrite_export_data(&db, "saved").await.unwrap();
    assert_eq!(metadata.author, "Candidate");
    assert_eq!(metadata.description, "Design gráfico e direção de arte.");
    let bytes = render_rewrite_pdf(&db, "saved", "new", None).await.unwrap();
    let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(text.contains("Candidate"));
    assert!(text.contains("candidate@example.com"));
    assert!(text.contains("Figma"));
    assert!(!text.contains("\"name\""));
    assert!(!lopdf::Document::load_mem(&bytes)
        .unwrap()
        .get_pages()
        .is_empty());

    if std::process::Command::new("xelatex")
        .arg("--version")
        .output()
        .is_ok()
    {
        let template = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
        let bytes = crate::cv::export::build_pdf_tex(&rewrite, &metadata, &template, None).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(text.contains("Candidate"));
        assert!(text.contains("candidate@example.com"));
        assert!(text.contains("Figma"));
        assert!(!text.contains("\"name\""));
    }
}

#[tokio::test]
async fn cv_commands_cover_document_and_rewrite_queries() {
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
    let stored =
        std::env::temp_dir().join(format!("hiremeops-cv-command-{}.pdf", uuid::Uuid::new_v4()));
    std::fs::write(&stored, b"synthetic cv").unwrap();
    sqlx::query(
        "INSERT INTO cv_documents
         (id, profile_id, file_name, file_type, file_hash, stored_path, size_bytes, page_count, created_at, updated_at)
         VALUES ('cv1', 'p1', 'candidate.pdf', 'pdf', 'hash', ?1, 12, 1, 'now', 'now')",
    )
    .bind(stored.to_string_lossy().as_ref())
    .execute(&db)
    .await
    .unwrap();
    let rewrite = CvRewrite {
        name: "Candidate".into(),
        summary: "Backend engineer".into(),
        ..Default::default()
    };
    sqlx::query(
        "INSERT INTO cv_rewrites
         (id, profile_id, cv_document_id, model_provider, model_name, rewrite_json, metadata_json, created_at)
         VALUES ('rw1', 'p1', 'cv1', 'fixture', 'model', ?1, ?2, 'now')",
    )
    .bind(serde_json::to_string(&rewrite).unwrap())
    .bind(serde_json::to_string(&rewrite.cv_metadata()).unwrap())
    .execute(&db)
    .await
    .unwrap();

    let app = crate::test_support::app_with_db(db);
    let state = app.state::<crate::AppState>();
    assert_eq!(
        list_cv_documents(state.clone(), "p1".into())
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(list_cv_analysis_reports(state.clone(), "p1".into())
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        list_cv_rewrites(state.clone(), "p1".into())
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get_cv_rewrite(state.clone(), "p1".into(), "rw1".into())
            .await
            .unwrap()
            .id,
        "rw1"
    );
    assert_eq!(
        cv_read_bytes(state.clone(), "cv1".into()).await.unwrap(),
        b"synthetic cv"
    );
    delete_cv_document(state.clone(), "cv1".into())
        .await
        .unwrap();
    assert!(cv_read_bytes(state, "cv1".into()).await.is_err());
    assert!(!stored.exists());
}
