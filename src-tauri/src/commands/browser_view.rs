//! Embedded native-webview browser panes (ported from terax-ai's `modules/browser.rs`). Instead of
//! spawning a SEPARATE Chromium window, this mounts a real OS webview (WebView2 / WKWebView /
//! WebKitGTK) as a CHILD of the main window, positioned over a placeholder `<div>` whose bounds the
//! frontend keeps synced. Interactive browsing/login happens inside our own UI. Requires tauri's
//! `unstable` feature (multi-webview `add_child`).
//!
//! NOTE ON ENGINE BOUNDARY: this is the OS webview — a DIFFERENT engine from the patchright
//! automation browser. It does not share the automation cookie jar and cannot be driven by the
//! worker. Use it for in-app browsing panes; to WATCH the automation itself in-app, use the CDP
//! Evidence Viewer (`preview_open_live`), which mirrors the live worker page as a frame stream.

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

const URL_EVENT: &str = "hiremeops:preview-webview-url";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewWebviewUrlPayload {
    pub label: String,
    pub url: String,
}

#[tauri::command]
pub async fn preview_webview_create(
    app: tauri::AppHandle,
    window_label: String,
    label: String,
    url: String,
    bounds: WebviewBounds,
) -> Result<(), String> {
    validate_webview_label(&label)?;
    validate_bounds(bounds)?;
    let url = parse_preview_url(&url)?;
    let window = app
        .get_window(&window_label)
        .ok_or_else(|| format!("window not found: {window_label}"))?;

    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.close();
    }

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .focused(false)
        .disable_drag_drop_handler()
        .enable_clipboard_access()
        .zoom_hotkeys_enabled(true)
        .on_page_load(|webview, payload| {
            let _ = webview.emit(
                URL_EVENT,
                PreviewWebviewUrlPayload {
                    label: webview.label().to_string(),
                    url: payload.url().to_string(),
                },
            );
        })
        .on_new_window(|_, _| NewWindowResponse::Allow);

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|e| e.to_string())?;
    let _ = webview.show();
    Ok(())
}

#[tauri::command]
pub async fn preview_webview_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    validate_webview_label(&label)?;
    let url = parse_preview_url(&url)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview.navigate(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_webview_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_webview_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview.reload().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_webview_go_back(app: tauri::AppHandle, label: String) -> Result<(), String> {
    eval_preview_history(app, label, "history.back()")
}

#[tauri::command]
pub async fn preview_webview_go_forward(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    eval_preview_history(app, label, "history.forward()")
}

#[tauri::command]
pub async fn preview_webview_set_bounds(
    app: tauri::AppHandle,
    label: String,
    bounds: WebviewBounds,
) -> Result<(), String> {
    validate_webview_label(&label)?;
    validate_bounds(bounds)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_webview_show(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_webview_label(&label)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_webview_hide(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_webview_label(&label)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn preview_webview_close(app: tauri::AppHandle, label: String) -> Result<(), String> {
    validate_webview_label(&label)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn parse_preview_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("unsupported browser URL scheme: {scheme}")),
    }
}

fn validate_webview_label(label: &str) -> Result<(), String> {
    if !label.starts_with("preview_native_") {
        return Err("invalid preview webview label".to_string());
    }
    if label
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '/' | ':' | '_'))
    {
        Ok(())
    } else {
        Err("invalid preview webview label".to_string())
    }
}

fn validate_bounds(bounds: WebviewBounds) -> Result<(), String> {
    if bounds.x.is_finite()
        && bounds.y.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width >= 1.0
        && bounds.height >= 1.0
    {
        Ok(())
    } else {
        Err("invalid preview webview bounds".to_string())
    }
}

fn eval_preview_history(
    app: tauri::AppHandle,
    label: String,
    script: &'static str,
) -> Result<(), String> {
    validate_webview_label(&label)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview.eval(script).map_err(|e| e.to_string())
}
