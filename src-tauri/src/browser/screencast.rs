//! Live-preview screencast engine — real implementation behind `real-browser`.
//! Key: open_real — launches Chrome, subscribes to EventScreencastFrame, forwards PreviewFrame over the Tauri channel.
//! Key: close_real — stops the screencast, signals the forwarding task, closes page + browser.
//! Key: PreviewFrame — per-tick frame payload sent to the frontend (base64 JPEG + dims + seq).
//! Key: REGISTRY — global handle → PreviewSession map.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::emulation::SetDeviceMetricsOverrideParams;
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
};
use chromiumoxide::cdp::browser_protocol::page::{
    EventScreencastFrame, ScreencastFrameAckParams, StartScreencastFormat, StartScreencastParams,
    StopScreencastParams,
};
use chromiumoxide::layout::Point;
use chromiumoxide::listeners::EventStream;
use futures::StreamExt as _;
use tokio::sync::{oneshot, Mutex};

use crate::util;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    pub data: String,
    pub width: u32,
    pub height: u32,
    pub seq: u64,
}

struct PreviewSession {
    browser: Browser,
    page: chromiumoxide::page::Page,
    stop_tx: oneshot::Sender<()>,
    user_data_dir: std::path::PathBuf,
}

static REGISTRY: std::sync::OnceLock<Arc<Mutex<HashMap<String, PreviewSession>>>> =
    std::sync::OnceLock::new();

fn registry() -> Arc<Mutex<HashMap<String, PreviewSession>>> {
    REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

pub async fn open_real(
    url: String,
    headless: bool,
    channel: tauri::ipc::Channel<PreviewFrame>,
) -> Result<String, String> {
    let user_data_dir = std::env::temp_dir().join(format!("hiremeops-preview-{}", util::new_id()));
    let config = browser_config(&user_data_dir, headless)?;

    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("Browser::launch: {e}"))?;

    tokio::spawn(async move {
        while let Some(h) = handler.next().await {
            if let Err(e) = h {
                tracing::debug!("preview handler: {e}");
            }
        }
    });

    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|e| format!("new_page: {e}"))?;

    page.goto(&url)
        .await
        .map_err(|e| format!("goto {url}: {e}"))?;

    let frame_stream = page
        .event_listener::<EventScreencastFrame>()
        .await
        .map_err(|e| format!("event_listener<EventScreencastFrame>: {e}"))?;

    // High-quality JPEG at full-HD; cap the streamed frame so HiDPI scaling stays within HD bandwidth.
    let start_params = StartScreencastParams::builder()
        .format(StartScreencastFormat::Jpeg)
        .quality(95_i64)
        .max_width(2560_i64)
        .max_height(1440_i64)
        .every_nth_frame(1_i64)
        .build();

    page.execute(start_params)
        .await
        .map_err(|e| format!("Page.startScreencast: {e}"))?;

    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let page_for_task = page.clone();
    let seq = Arc::new(AtomicU64::new(0));

    tokio::spawn(forward_frames(
        frame_stream,
        page_for_task,
        channel,
        stop_rx,
        seq,
    ));

    let handle = util::new_id();
    registry().lock().await.insert(
        handle.clone(),
        PreviewSession {
            browser,
            page,
            stop_tx,
            user_data_dir,
        },
    );

    tracing::info!(handle = %handle, url = %url, headless, "preview_open: screencast started");
    Ok(handle)
}

fn browser_config(
    user_data_dir: &std::path::Path,
    headless: bool,
) -> Result<BrowserConfig, String> {
    let mut builder = BrowserConfig::builder()
        .arg("--no-sandbox")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--window-size=1920,1080")
        .arg("--force-device-scale-factor=1")
        .arg("--high-dpi-support=1")
        .arg("--disable-blink-features=AutomationControlled")
        .arg("--lang=en-US,en")
        .arg(
            "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        )
        .user_data_dir(user_data_dir);
    if headless {
        builder = builder.arg("--headless=new");
    }
    builder
        .build()
        .map_err(|e| format!("BrowserConfig::build: {e}"))
}

async fn forward_frames(
    mut frame_stream: EventStream<EventScreencastFrame>,
    page: chromiumoxide::page::Page,
    channel: tauri::ipc::Channel<PreviewFrame>,
    mut stop_rx: oneshot::Receiver<()>,
    seq: Arc<AtomicU64>,
) {
    loop {
        tokio::select! {
            _ = &mut stop_rx => {
                tracing::debug!("preview frame task: stop signal received");
                break;
            }
            maybe_frame = frame_stream.next() => {
                let Some(ev) = maybe_frame else {
                    tracing::debug!("preview frame stream ended");
                    break;
                };
                if !send_frame(&channel, &page, &seq, ev).await {
                    break;
                }
            }
        }
    }
}

async fn send_frame(
    channel: &tauri::ipc::Channel<PreviewFrame>,
    page: &chromiumoxide::page::Page,
    seq: &AtomicU64,
    ev: Arc<EventScreencastFrame>,
) -> bool {
    let frame = PreviewFrame {
        data: AsRef::<str>::as_ref(&ev.data).to_owned(),
        width: ev.metadata.device_width as u32,
        height: ev.metadata.device_height as u32,
        seq: seq.fetch_add(1, Ordering::Relaxed),
    };
    if channel.send(frame).is_err() {
        tracing::debug!("preview channel closed by frontend");
        return false;
    }
    let ack = ScreencastFrameAckParams::new(ev.session_id);
    if let Err(e) = page.execute(ack).await {
        tracing::warn!("screencastFrameAck failed: {e}");
    }
    true
}

pub async fn close_real(handle: String) -> Result<(), String> {
    let session = registry()
        .lock()
        .await
        .remove(&handle)
        .ok_or_else(|| format!("preview_close: unknown handle '{handle}'"))?;

    let _ = session.stop_tx.send(());

    if let Err(e) = session.page.execute(StopScreencastParams::default()).await {
        tracing::warn!(handle = %handle, "Page.stopScreencast failed (non-fatal): {e}");
    }

    if let Err(e) = session.page.close().await {
        tracing::warn!(handle = %handle, "preview page.close error (non-fatal): {e}");
    }

    let mut browser = session.browser;
    if let Err(e) = browser.close().await {
        tracing::warn!(handle = %handle, "preview browser.close error (non-fatal): {e}");
    }

    // Best-effort cleanup of the per-launch profile dir so /tmp doesn't accumulate them.
    let _ = std::fs::remove_dir_all(&session.user_data_dir);

    tracing::info!(handle = %handle, "preview_close: done");
    Ok(())
}

/// One input event forwarded from the embedded-browser canvas (coords are in device pixels of the
/// streamed frame — the frontend scales CSS → frame before sending).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputEvent {
    pub kind: String, // "click" | "move" | "wheel" | "char" | "key"
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub delta_y: f64,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub key_code: Option<i64>,
    #[serde(default)]
    pub text: Option<String>,
}

async fn page_for(handle: &str) -> Result<chromiumoxide::page::Page, String> {
    let reg = registry();
    let guard = reg.lock().await;
    guard
        .get(handle)
        .map(|s| s.page.clone())
        .ok_or_else(|| format!("unknown preview handle '{handle}'"))
}

/// Navigate the embedded browser to `url` (URL-bar / Go button).
pub async fn navigate_real(handle: String, url: String) -> Result<(), String> {
    let page = page_for(&handle).await?;
    page.goto(url.as_str()).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Forward one canvas input event into the browser via CDP (click, move, wheel, typing, key).
pub async fn input_real(handle: String, ev: InputEvent) -> Result<(), String> {
    let page = page_for(&handle).await?;
    match ev.kind.as_str() {
        "click" | "move" | "wheel" => dispatch_mouse(&page, &ev).await?,
        "keydown" | "keyup" => dispatch_key(&page, ev).await?,
        "back" | "forward" | "reload" => navigate_history(&page, ev.kind.as_str()).await,
        _ => {}
    }
    Ok(())
}

async fn dispatch_mouse(page: &chromiumoxide::page::Page, ev: &InputEvent) -> Result<(), String> {
    match ev.kind.as_str() {
        "click" => page
            .click(Point::new(ev.x, ev.y))
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        "move" => page
            .move_mouse(Point::new(ev.x, ev.y))
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
        _ => dispatch_wheel(page, ev).await,
    }
}

async fn dispatch_wheel(page: &chromiumoxide::page::Page, ev: &InputEvent) -> Result<(), String> {
    let params = DispatchMouseEventParams::builder()
        .r#type(DispatchMouseEventType::MouseWheel)
        .x(ev.x)
        .y(ev.y)
        .delta_x(0.0)
        .delta_y(ev.delta_y)
        .build()
        .map_err(|e| e.to_string())?;
    page.execute(params)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn dispatch_key(page: &chromiumoxide::page::Page, ev: InputEvent) -> Result<(), String> {
    let etype = if ev.kind == "keydown" {
        DispatchKeyEventType::KeyDown
    } else {
        DispatchKeyEventType::KeyUp
    };
    let mut builder = DispatchKeyEventParams::builder().r#type(etype);
    if let Some(key) = ev.key {
        builder = builder.key(key);
    }
    if let Some(code) = ev.code {
        builder = builder.code(code);
    }
    if let Some(key_code) = ev.key_code.filter(|code| *code > 0) {
        builder = builder
            .windows_virtual_key_code(key_code)
            .native_virtual_key_code(key_code);
    }
    if ev.kind == "keydown" {
        if let Some(text) = ev.text.filter(|text| !text.is_empty()) {
            builder = builder.text(text.clone()).unmodified_text(text);
        }
    }
    let params = builder.build().map_err(|e| e.to_string())?;
    page.execute(params)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

async fn navigate_history(page: &chromiumoxide::page::Page, kind: &str) {
    let script = match kind {
        "back" => "history.back()",
        "forward" => "history.forward()",
        _ => "location.reload()",
    };
    let _ = page.evaluate(script).await;
}

/// Resize the embedded browser's viewport so the page REFLOWS to fit the pane (true responsiveness,
/// not a stretched canvas). Frames then arrive at the new size; the canvas matches 1:1.
pub async fn resize_real(
    handle: String,
    width: u32,
    height: u32,
    scale: f64,
) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Ok(());
    }
    // device_scale_factor = the pane's devicePixelRatio (clamped) so the page renders at HiDPI and
    // the screencast frame comes back crisp; width/height stay in CSS px so the layout is correct.
    let dsf = scale.clamp(1.0, 2.0);
    let page = page_for(&handle).await?;
    let params = SetDeviceMetricsOverrideParams::builder()
        .width(width as i64)
        .height(height as i64)
        .device_scale_factor(dsf)
        .mobile(false)
        .build()
        .map_err(|e| e.to_string())?;
    page.execute(params).await.map_err(|e| e.to_string())?;
    Ok(())
}
