//! Tauri IPC commands for the live-preview screencast (P1).
//! Key: `preview_open` — open a tab, start a CDP screencast, stream frames over `channel`.
//! Key: `preview_close` — stop the screencast and close the tab (idempotent).
//! Key: `PreviewFrame` — real impl behind `real-browser` feature; stub type otherwise so commands always compile.

#[cfg(feature = "real-browser")]
pub use crate::browser::screencast::PreviewFrame;

#[cfg(not(feature = "real-browser"))]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    pub data: String,
    pub width: u32,
    pub height: u32,
    pub seq: u64,
}

#[tauri::command]
pub async fn preview_open(
    url: String,
    headless: bool,
    channel: tauri::ipc::Channel<PreviewFrame>,
) -> Result<String, String> {
    #[cfg(feature = "real-browser")]
    {
        crate::browser::screencast::open_real(url, headless, channel).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (url, headless, channel);
        Err("real browser engine not enabled in this build".into())
    }
}

#[tauri::command]
pub async fn preview_close(handle: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        crate::browser::screencast::close_real(handle).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = handle;
        Err("real browser engine not enabled in this build".into())
    }
}

/// Attach the Evidence Viewer to the LIVE automation session (CDP screencast of the worker's own
/// page) instead of a throwaway browser. `handle` defaults to the driver's current session. Returns
/// the handle actually attached (pass it back to `preview_close_live`).
#[tauri::command]
pub async fn preview_open_live(
    state: tauri::State<'_, crate::AppState>,
    handle: Option<String>,
    channel: tauri::ipc::Channel<PreviewFrame>,
) -> Result<String, String> {
    #[cfg(feature = "real-browser")]
    {
        let h = match handle {
            Some(h) => h,
            None => state
                .playwright
                .current_session()
                .await
                .ok_or_else(|| "no active automation session to preview".to_string())?,
        };
        state
            .playwright
            .start_live_preview(&h, channel)
            .await
            .map_err(|e| e.to_string())?;
        Ok(h)
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, handle, channel);
        Err("real browser engine not enabled in this build".into())
    }
}

/// Navigate the embedded screencast browser (URL bar / Go).
#[tauri::command]
pub async fn preview_navigate(handle: String, url: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        crate::browser::screencast::navigate_real(handle, url).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (handle, url);
        Err("real browser engine not enabled in this build".into())
    }
}

/// Resize the embedded screencast browser's viewport so its page reflows to fit the pane.
#[tauri::command]
pub async fn preview_resize(
    handle: String,
    width: u32,
    height: u32,
    scale: Option<f64>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        crate::browser::screencast::resize_real(handle, width, height, scale.unwrap_or(1.0)).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (handle, width, height, scale);
        Err("real browser engine not enabled in this build".into())
    }
}

/// Forward a canvas input event (click/move/wheel/char/key/back/forward/reload) into the browser.
#[tauri::command]
pub async fn preview_input(handle: String, event: serde_json::Value) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        let ev = serde_json::from_value(event).map_err(|e| e.to_string())?;
        crate::browser::screencast::input_real(handle, ev).await
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (handle, event);
        Err("real browser engine not enabled in this build".into())
    }
}

#[tauri::command]
pub async fn preview_close_live(
    state: tauri::State<'_, crate::AppState>,
    handle: String,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        state
            .playwright
            .stop_live_preview(&handle)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, handle);
        Err("real browser engine not enabled in this build".into())
    }
}
