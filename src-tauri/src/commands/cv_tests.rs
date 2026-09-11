use super::*;
use crate::ai::prompt::CvRewrite;

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
