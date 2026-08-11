//! CV commands: import a PDF/DOCX into a profile's document store, and analyze.
//!
//! Key: render_rewrite_pdf — shared xelatex/lopdf render path behind export_cv_rewrite and save_cv_rewrite_pdf
//! Key: resolve_cvtex_dir — locates the bundled cvtex assets, falling back to the dev source tree
//! Key: save_cv_rewrite_pdf — native save-dialog path required because WebKitGTK drops blob downloads

use std::path::PathBuf;

use tauri::{Manager, State};

use crate::ai::prompt::Language;
use crate::domain::cv::{
    CvAnalysisReport, CvDocumentSummary, CvRewriteReport, CvService, CvServiceImpl,
};
use crate::domain::profile_variants::{
    ProfileVariantDto, ProfileVariantService, ProfileVariantServiceImpl,
};
use crate::AppState;

fn service(state: &AppState) -> CvServiceImpl {
    CvServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

fn resolve_cvtex_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(base) = app.path().resource_dir() {
        candidates.push(base.join("resources/cvtex"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex"));
    candidates
        .into_iter()
        .find(|p| p.join("curriculo.cls").is_file())
}

#[tauri::command]
pub async fn import_cv_document(
    state: State<'_, AppState>,
    profile_id: String,
    path: String,
) -> Result<String, String> {
    service(&state)
        .import_document(&profile_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn analyze_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
    language: Option<String>,
) -> Result<String, String> {
    let language = language.as_deref().map(Language::parse).unwrap_or_default();
    service(&state)
        .analyze(&cv_document_id, language)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rewrite_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
    target_title: Option<String>,
    language: Option<String>,
    extra_context: Option<String>,
) -> Result<String, String> {
    let language = language.as_deref().map(Language::parse).unwrap_or_default();
    service(&state)
        .rewrite(
            &cv_document_id,
            target_title.as_deref(),
            language,
            extra_context.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_first_time_cv_rewrite(
    state: State<'_, AppState>,
    profile_id: String,
    target_title: Option<String>,
    language: Option<String>,
    candidate_context: String,
) -> Result<String, String> {
    let language = language.as_deref().map(Language::parse).unwrap_or_default();
    service(&state)
        .create_first_time_rewrite(
            &profile_id,
            target_title.as_deref(),
            language,
            &candidate_context,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_variant_from_document(
    state: State<'_, AppState>,
    profile_id: String,
    cv_document_id: String,
    name: Option<String>,
    language: Option<String>,
) -> Result<ProfileVariantDto, String> {
    let lang = language.as_deref().map(Language::parse).unwrap_or_default();
    let cv_svc = service(&state);
    let rewrite_id = cv_svc
        .rewrite(&cv_document_id, None, lang, None)
        .await
        .map_err(|e| e.to_string())?;
    ProfileVariantServiceImpl::new(state.db.clone())
        .create_from_rewrite(&profile_id, &rewrite_id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
) -> Result<(), String> {
    service(&state)
        .delete_document(&cv_document_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cv_read_bytes(state: State<'_, AppState>, cv_id: String) -> Result<Vec<u8>, String> {
    service(&state)
        .read_bytes(&cv_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_cv_documents(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvDocumentSummary>, String> {
    service(&state)
        .list_documents(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_cv_analysis_reports(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvAnalysisReport>, String> {
    service(&state)
        .list_analysis_reports(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_cv_rewrites(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<CvRewriteReport>, String> {
    service(&state)
        .list_rewrites(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

/// Download a CV headshot for the LaTeX build. Returns None (never an error) for a
/// non-http URL, a non-2xx response, an oversized body, or any transport failure, so a
/// bad photo URL degrades to "no photo" instead of breaking the export.
async fn fetch_photo(url: &str) -> Option<Vec<u8>> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        tracing::warn!(target: "hiremeops::cv", "cv photo fetch {url}: HTTP {}", resp.status());
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    // ponytail: 8 MB cap — a headshot is never bigger; stops a hostile URL from ballooning RAM.
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return None;
    }
    Some(bytes.to_vec())
}

/// Persist CV-only appearance (accent hex + headshot URL) onto a stored rewrite's
/// `rewrite_json`, so the next export renders with them. The hex is stripped of a
/// leading `#`; `generate_resume_tex` validates it again before it reaches the TeX.
#[tauri::command]
pub async fn set_cv_rewrite_appearance(
    state: State<'_, AppState>,
    rewrite_id: String,
    accent_color: String,
    photo_url: String,
) -> Result<(), String> {
    use crate::ai::prompt::CvRewrite;

    let json: Option<String> =
        sqlx::query_scalar("SELECT rewrite_json FROM cv_rewrites WHERE id = ?1")
            .bind(&rewrite_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| e.to_string())?;
    let json = json.ok_or_else(|| format!("unknown cv_rewrite: {rewrite_id}"))?;

    let mut rewrite: CvRewrite =
        serde_json::from_str(&json).map_err(|e| format!("decode rewrite: {e}"))?;
    rewrite.accent_color = accent_color.trim().trim_start_matches('#').to_string();
    rewrite.photo_url = photo_url.trim().to_string();

    let updated = serde_json::to_string(&rewrite).map_err(|e| e.to_string())?;
    sqlx::query("UPDATE cv_rewrites SET rewrite_json = ?1 WHERE id = ?2")
        .bind(&updated)
        .bind(&rewrite_id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn render_rewrite_pdf(
    db: &sqlx::SqlitePool,
    rewrite_id: &str,
    mode: &str,
    cvtex_dir: Option<&std::path::Path>,
) -> Result<Vec<u8>, String> {
    use crate::ai::prompt::{CvMetadata, CvRewrite};
    use crate::cv::export::{self, ExportMode};

    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT rewrite_json, metadata_json, cv_document_id FROM cv_rewrites WHERE id = ?1",
    )
    .bind(rewrite_id)
    .fetch_optional(db)
    .await
    .map_err(|e| e.to_string())?;

    let (rewrite_json, metadata_json, cv_document_id) =
        row.ok_or_else(|| format!("unknown cv_rewrite: {rewrite_id}"))?;

    let rewrite: CvRewrite =
        serde_json::from_str(&rewrite_json).map_err(|e| format!("decode rewrite: {e}"))?;
    let metadata: CvMetadata =
        serde_json::from_str(&metadata_json).unwrap_or_else(|_| rewrite.cv_metadata());

    if ExportMode::parse(mode) == ExportMode::Modify {
        if let Some(doc_id) = cv_document_id {
            let stored: Option<String> =
                sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                    .bind(&doc_id)
                    .fetch_optional(db)
                    .await
                    .map_err(|e| e.to_string())?;
            if let Some(path) = stored {
                if let Ok(bytes) = std::fs::read(&path) {
                    if bytes.starts_with(b"%PDF") {
                        return export::embed_metadata(&bytes, &metadata);
                    }
                }
            }
        }
    }

    // Best-effort headshot fetch. A broken/slow URL must never fail the whole export —
    // on any error we fall through with no photo (build_pdf_tex drops \photo entirely).
    let photo_bytes = fetch_photo(&rewrite.photo_url).await;

    if let Some(dir) = cvtex_dir {
        match export::build_pdf_tex(&rewrite, &metadata, dir, photo_bytes.as_deref()) {
            Ok(bytes) => return Ok(bytes),
            Err(e) => tracing::warn!(
                target: "hiremeops::cv",
                "xelatex render failed, using lopdf fallback: {e}"
            ),
        }
    }

    export::build_pdf(&rewrite, &metadata)
}

#[tauri::command]
pub async fn export_cv_rewrite(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rewrite_id: String,
    mode: String,
) -> Result<Vec<u8>, String> {
    let cvtex_dir = resolve_cvtex_dir(&app);
    render_rewrite_pdf(&state.db, &rewrite_id, &mode, cvtex_dir.as_deref()).await
}

#[tauri::command]
pub async fn save_cv_rewrite_pdf(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rewrite_id: String,
    mode: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let cvtex_dir = resolve_cvtex_dir(&app);
    let bytes = render_rewrite_pdf(&state.db, &rewrite_id, &mode, cvtex_dir.as_deref()).await?;

    let file_name = if suggested_name.to_ascii_lowercase().ends_with(".pdf") {
        suggested_name
    } else {
        format!("{suggested_name}.pdf")
    };

    let chosen = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();

    let Some(file_path) = chosen else {
        return Ok(None);
    };

    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
