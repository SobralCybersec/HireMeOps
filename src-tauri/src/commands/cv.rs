//! CV commands: import a PDF/DOCX into a profile's document store, and analyze.
//! Thin IPC wrappers that delegate to the concrete `CvService` and flatten
//! `DomainError` into a `String` for the frontend.

use std::path::PathBuf;

use tauri::{Manager, State};

use crate::ai::prompt::Language;
use crate::domain::cv::{
    CvAnalysisReport, CvDocumentSummary, CvRewriteReport, CvService, CvServiceImpl,
};
use crate::domain::profile_variants::{ProfileVariantDto, ProfileVariantService, ProfileVariantServiceImpl};
use crate::AppState;

fn service(state: &AppState) -> CvServiceImpl {
    CvServiceImpl::new(state.db.clone(), state.paths.cv_files_dir.clone())
}

/// Resolve the bundled `resources/cvtex` directory (holding `curriculo.cls` and
/// `fontdir/`) for the xelatex render path. Prefers Tauri's bundled resource dir;
/// falls back to the compile-time source tree so `tauri dev` / `cargo test` (where
/// resources aren't copied into the target dir) still find the assets. Returns
/// `None` when neither location exists, so the caller degrades to the lopdf
/// fallback rather than erroring.
fn resolve_cvtex_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(base) = app.path().resource_dir() {
        candidates.push(base.join("resources/cvtex"));
    }
    // Dev / test fallback: the assets live beside this crate's Cargo.toml.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex"));
    candidates.into_iter().find(|p| p.join("curriculo.cls").is_file())
}

/// Import a CV file from an absolute path into `profile_id`'s document store.
/// Returns the (new or, on re-import, existing) `cv_documents.id`.
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

/// Run gap/quality analysis for a stored CV document (AI-backed, Phase 4).
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

/// Produce a REWRITTEN CV (not a critique) tailored to `target_title`, tailored
/// to the source document, persist it plus its derived PDF metadata, and return
/// the new `cv_rewrites.id`. Invoked as
/// `rewrite_cv_document({ cvDocumentId, targetTitle })`; Tauri maps the camelCase
/// args to `cv_document_id` / `target_title`.
#[tauri::command]
pub async fn rewrite_cv_document(
    state: State<'_, AppState>,
    cv_document_id: String,
    target_title: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let language = language.as_deref().map(Language::parse).unwrap_or_default();
    service(&state)
        .rewrite(&cv_document_id, target_title.as_deref(), language)
        .await
        .map_err(|e| e.to_string())
}

/// One-shot: rewrite a CV document with AI then immediately build a profile
/// variant from the result. Combines `rewrite_cv_document` + `create_profile_variant`
/// so the frontend doesn't need to orchestrate two separate round-trips.
/// Returns the new `ProfileVariantDto` ready to display.
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
        .rewrite(&cv_document_id, None, lang)
        .await
        .map_err(|e| e.to_string())?;
    ProfileVariantServiceImpl::new(state.db.clone())
        .create_from_rewrite(&profile_id, &rewrite_id, name)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a CV document and its stored file from disk. Analysis rows are
/// cascade-deleted; rewrite rows lose their FK but survive. Invoked as
/// `delete_cv_document({ cvDocumentId })`.
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

/// Read the raw bytes of a stored CV document, for the frontend PDF viewer.
/// The frontend loader (`pdf.ts`) invokes this as `cv_read_bytes({ cvId })`;
/// Tauri maps `cvId` → `cv_id`.
#[tauri::command]
pub async fn cv_read_bytes(state: State<'_, AppState>, cv_id: String) -> Result<Vec<u8>, String> {
    service(&state)
        .read_bytes(&cv_id)
        .await
        .map_err(|e| e.to_string())
}

/// List a profile's CV documents, enriched for the CV Library page (active
/// flag, latest analysis score, assigned variants). Invoked from the frontend
/// as `list_cv_documents({ profileId })`; Tauri maps `profileId` → `profile_id`.
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

/// List a profile's persisted CV analysis reports, newest first, for the CV
/// Analysis history panel. Invoked as `list_cv_analysis_reports({ profileId })`;
/// Tauri maps `profileId` → `profile_id`.
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

/// List a profile's persisted CV rewrites, newest first, for the CV rewrite
/// history / display. Invoked as `list_cv_rewrites({ profileId })`; Tauri maps
/// `profileId` → `profile_id`.
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

/// Render a persisted CV rewrite to PDF bytes. Shared by `export_cv_rewrite`
/// (returns the bytes to JS) and `save_cv_rewrite_pdf` (writes them to disk via
/// a native dialog), so the DB read + render logic lives in exactly one place.
///
/// `mode` is `"new"` (render a fresh PDF from the structured rewrite) or
/// `"modify"` (inject the derived PDF metadata into a copy of the *source*
/// document's existing PDF — the `ResumeService.addPDFMetadata` path). `"modify"`
/// gracefully falls back to `"new"` when the source is missing or isn't a PDF
/// (e.g. a DOCX import), so a caller always gets bytes.
///
/// Reads `cv_rewrites` / `cv_documents` directly here (rather than adding a
/// method to `CvServiceImpl`) to keep the shared `domain/cv.rs` untouched.
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
    // Recompute metadata from the rewrite if the stored column is malformed —
    // mirrors `list_rewrites`' self-healing so a drifted row still exports.
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
        // Source unavailable / not a PDF — fall through to a fresh render.
    }

    // Prefer the real xelatex + curriculo.cls render; fall back to the always
    // -available lopdf path when the toolchain or assets are missing, or when a
    // compile fails (a broken toolchain must never block an export).
    if let Some(dir) = cvtex_dir {
        match export::build_pdf_tex(&rewrite, &metadata, dir) {
            Ok(bytes) => return Ok(bytes),
            Err(e) => eprintln!("cv export: xelatex render failed, using lopdf fallback: {e}"),
        }
    }

    export::build_pdf(&rewrite, &metadata)
}

/// Export a persisted CV rewrite as a PDF, returning the raw bytes. Invoked as
/// `export_cv_rewrite({ rewriteId, mode })`; Tauri maps `rewriteId` →
/// `rewrite_id`. See [`render_rewrite_pdf`] for `mode` semantics.
///
/// Prefer [`save_cv_rewrite_pdf`] for the "Export PDF" button: the WebKitGTK
/// webview (Tauri on Linux) silently drops blob `<a download>` saves, so bytes
/// handed back to JS cannot reliably land on disk. This variant is kept for
/// callers that consume the bytes in-webview (e.g. an inline preview).
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

/// Render a persisted CV rewrite and write it to disk via a **native save
/// dialog**. Invoked as `save_cv_rewrite_pdf({ rewriteId, mode, suggestedName })`.
/// Resolves to the saved absolute path, or `null` if the user cancelled the
/// dialog. Rejects with the render/write error otherwise.
///
/// The entire render → dialog → write sequence runs in Rust because the
/// WebKitGTK webview silently ignores programmatic blob downloads; going through
/// the native file dialog + `std::fs::write` is the only reliable save path on
/// Linux (and works identically on macOS/Windows).
#[tauri::command]
pub async fn save_cv_rewrite_pdf(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    rewrite_id: String,
    mode: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Render first so a failure surfaces before we ever pop a dialog.
    let cvtex_dir = resolve_cvtex_dir(&app);
    let bytes = render_rewrite_pdf(&state.db, &rewrite_id, &mode, cvtex_dir.as_deref()).await?;

    // Ensure the suggested name carries a `.pdf` extension for the dialog.
    let file_name = if suggested_name.to_ascii_lowercase().ends_with(".pdf") {
        suggested_name
    } else {
        format!("{suggested_name}.pdf")
    };

    // `blocking_save_file` must not run on the main/UI thread; Tauri commands
    // run on a worker thread, so this is safe and dispatches the GTK/native
    // dialog to the UI thread internally.
    let chosen = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();

    let Some(file_path) = chosen else {
        return Ok(None); // user cancelled
    };

    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
