//! Playwright-backed BrowserDriver implementation.
//! Key: PlaywrightDriver — owns the worker connection + parked-session state for the human-in-the-loop submit flow.
//! Key: WorkerConn — stdin/stdout JSON-lines RPC to the `automation/worker.js` Node child process.
//! Key: locate_worker_script — resolves worker.js relative to the binary, CARGO_MANIFEST_DIR, or cwd.
//! Key: confirm_submit_parked / reject_submit_parked — resume the parked Easy Apply session after human review.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

use crate::domain::automation::{
    BrowserDriver, EasyApplyInput, GoogleResult, GoogleSearchResult, JobCard, LinkedInPost,
    LinkedInPostsResult, PageState, SearchJobsInput, SearchJobsResult, SessionSpec,
};
use crate::domain::profile_sync::{SyncSection, SyncSectionResult};
use crate::domain::{DomainError, DomainResult};

#[derive(Debug, Deserialize)]
struct WorkerReply {
    id: String,
    ok: bool,
    #[serde(flatten)]
    data: Map<String, Value>,
}

type PendingMap = Arc<std::sync::Mutex<HashMap<String, oneshot::Sender<WorkerReply>>>>;

/// One live-preview frame forwarded from the worker's CDP screencast (base64 JPEG + dims).
#[derive(Clone)]
pub struct LiveFrame {
    pub data: String,
    pub width: u32,
    pub height: u32,
}

/// Where the reader forwards `screencast_frame` events. Set while an Evidence Viewer is attached,
/// None otherwise (frames are then simply dropped).
type FrameSlot = Arc<std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<LiveFrame>>>>;

/// One real-time auto-connect progress tick (the running `sent` count + status), streamed to the UI
/// as each invite is confirmed — so the count updates live instead of only when the call returns.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoConnectProgress {
    pub sent: u32,
    pub status: String, // "ok" while sending, "limit" when LinkedIn's weekly cap is hit
}

/// Where the reader forwards `auto_connect_progress` events — set only while an auto-connect run is
/// streaming, None otherwise.
type ProgressSlot =
    Arc<std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<AutoConnectProgress>>>>;

struct WorkerConn {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    frame_tx: FrameSlot,
    progress_tx: ProgressSlot,
    _child: Mutex<Child>,
    _reader: tokio::task::JoinHandle<()>,
}

impl WorkerConn {
    async fn spawn(script: &PathBuf) -> DomainResult<Arc<Self>> {
        use std::process::Stdio;
        use tokio::process::Command;

        let mut child = Command::new("node")
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                DomainError::Other(anyhow::anyhow!(
                    "Failed to spawn patchright worker at {}: {e}",
                    script.display()
                ))
            })?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let pending: PendingMap = Arc::new(std::sync::Mutex::new(HashMap::new()));
        let frame_tx: FrameSlot = Arc::new(std::sync::Mutex::new(None));
        let progress_tx: ProgressSlot = Arc::new(std::sync::Mutex::new(None));

        let pending_r = pending.clone();
        let frame_r = frame_tx.clone();
        let progress_r = progress_tx.clone();
        let reader = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim().to_owned();
                if line.is_empty() {
                    continue;
                }

                let v: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("patchright worker: unparseable reply: {e} — {line}");
                        continue;
                    }
                };

                // Unsolicited screencast frames carry an `event` field (never present on replies),
                // so this diversion leaves the id-keyed reply routing below untouched.
                if v.get("event").and_then(Value::as_str) == Some("screencast_frame") {
                    if let Some(tx) = frame_r.lock().unwrap().as_ref() {
                        let _ = tx.send(LiveFrame {
                            data: v
                                .get("data")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_owned(),
                            width: v.get("width").and_then(Value::as_u64).unwrap_or(0) as u32,
                            height: v.get("height").and_then(Value::as_u64).unwrap_or(0) as u32,
                        });
                    }
                    continue;
                }

                // Unsolicited auto-connect progress ticks — route to the streaming channel if a run
                // is attached; drop otherwise.
                if v.get("event").and_then(Value::as_str) == Some("auto_connect_progress") {
                    if let Some(tx) = progress_r.lock().unwrap().as_ref() {
                        let _ = tx.send(AutoConnectProgress {
                            sent: v.get("sent").and_then(Value::as_u64).unwrap_or(0) as u32,
                            status: v
                                .get("status")
                                .and_then(Value::as_str)
                                .unwrap_or("ok")
                                .to_owned(),
                        });
                    }
                    continue;
                }

                match serde_json::from_value::<WorkerReply>(v) {
                    Ok(reply) => {
                        if let Some(tx) = pending_r.lock().unwrap().remove(&reply.id) {
                            let _ = tx.send(reply);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("patchright worker: unparseable reply: {e} — {line}");
                    }
                }
            }
            pending_r.lock().unwrap().clear();
            tracing::info!("patchright worker stdout closed");
        });

        Ok(Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            frame_tx,
            progress_tx,
            _child: Mutex::new(child),
            _reader: reader,
        }))
    }

    async fn send(&self, mut payload: Value) -> DomainResult<Map<String, Value>> {
        let id = Uuid::new_v4().to_string();
        payload["id"] = Value::String(id.clone());

        let line = serde_json::to_string(&payload)
            .map_err(|e| DomainError::Other(anyhow::anyhow!(e)))?
            + "\n";

        let (tx, rx) = oneshot::channel::<WorkerReply>();
        self.pending.lock().unwrap().insert(id.clone(), tx);

        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await.map_err(|e| {
                DomainError::Other(anyhow::anyhow!("write to patchright worker: {e}"))
            })?;
            stdin.flush().await.map_err(|e| {
                DomainError::Other(anyhow::anyhow!("flush to patchright worker: {e}"))
            })?;
        }

        let reply = rx.await.map_err(|_| {
            DomainError::Other(anyhow::anyhow!("patchright worker reply channel closed"))
        })?;

        if !reply.ok {
            let err = reply
                .data
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            return Err(DomainError::Other(anyhow::anyhow!(
                "patchright worker: {err}"
            )));
        }

        Ok(reply.data)
    }
}

struct ParkedInfo {
    handle: String,
    task_id: Option<String>,
    session_id: Option<String>,
}

pub struct PostSubmitMeta {
    pub screenshot_path: Option<String>,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
}

pub struct PlaywrightDriver {
    worker_script: PathBuf,
    conn: Mutex<Option<Arc<WorkerConn>>>,
    screenshot_dir: PathBuf,
    parked: Mutex<Option<ParkedInfo>>,
    parked_indeed: Mutex<Option<String>>,
    login_session: Mutex<Option<String>>,
    current_session: Mutex<Option<String>>,
}

impl PlaywrightDriver {
    pub fn new(data_root: impl Into<PathBuf>) -> Self {
        let data_root: PathBuf = data_root.into();

        let worker_script = locate_worker_script();

        Self {
            worker_script,
            conn: Mutex::new(None),
            screenshot_dir: data_root.join("screenshots"),
            parked: Mutex::new(None),
            parked_indeed: Mutex::new(None),
            login_session: Mutex::new(None),
            current_session: Mutex::new(None),
        }
    }

    /// The handle of the most recently opened session — what the Evidence Viewer screencasts when
    /// no explicit handle is given.
    pub async fn current_session(&self) -> Option<String> {
        self.current_session.lock().await.clone()
    }

    /// Record `handle` as the current live session so the Evidence Viewer / preview_open_live(null)
    /// can attach to ANY automation, not just the driver `open()` path.
    async fn remember_session(&self, handle: &str) {
        *self.current_session.lock().await = Some(handle.to_owned());
    }

    /// Start CDP-screencasting the live automation page for `handle` and forward frames to `channel`.
    /// Reuses the worker's own page (no throwaway browser, no second CDP client racing).
    pub async fn start_live_preview(
        &self,
        handle: &str,
        channel: tauri::ipc::Channel<crate::browser::screencast::PreviewFrame>,
    ) -> DomainResult<()> {
        let conn = self.conn().await?;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<LiveFrame>();
        *conn.frame_tx.lock().unwrap() = Some(tx);

        tokio::spawn(async move {
            let mut seq = 0u64;
            while let Some(f) = rx.recv().await {
                let pf = crate::browser::screencast::PreviewFrame {
                    data: f.data,
                    width: f.width,
                    height: f.height,
                    seq,
                };
                seq = seq.wrapping_add(1);
                if channel.send(pf).is_err() {
                    break; // frontend closed the channel
                }
            }
        });

        self.rpc(json!({ "cmd": "start_screencast", "handle": handle }))
            .await?;
        Ok(())
    }

    /// Stop the live screencast and detach the frame forwarder.
    pub async fn stop_live_preview(&self, handle: &str) -> DomainResult<()> {
        let _ = self
            .rpc(json!({ "cmd": "stop_screencast", "handle": handle }))
            .await;
        if let Some(c) = self.conn.lock().await.as_ref() {
            *c.frame_tx.lock().unwrap() = None;
        }
        Ok(())
    }

    pub async fn open_login_session(&self, spec: &SessionSpec) -> DomainResult<String> {
        if let Some(prev) = self.login_session.lock().await.take() {
            self.close_session(&prev).await;
        }
        let handle = self.open(spec).await?;
        *self.login_session.lock().await = Some(handle.clone());
        Ok(handle)
    }

    async fn conn(&self) -> DomainResult<Arc<WorkerConn>> {
        let mut slot = self.conn.lock().await;
        if let Some(c) = slot.as_ref() {
            if !c._reader.is_finished() {
                return Ok(c.clone());
            }
            *slot = None;
        }
        tracing::info!(
            script = %self.worker_script.display(),
            "spawning patchright worker"
        );
        let c = WorkerConn::spawn(&self.worker_script).await?;
        *slot = Some(c.clone());
        Ok(c)
    }

    async fn rpc(&self, payload: Value) -> DomainResult<Map<String, Value>> {
        self.conn().await?.send(payload).await
    }

    pub async fn prewarm(&self) {
        match self.conn().await {
            Ok(_) => tracing::info!("patchright worker pre-warmed"),
            Err(e) => tracing::warn!("playwright prewarm failed (will spawn lazily): {e}"),
        }
    }

    pub async fn close_session(&self, handle: &str) {
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;
    }

    pub async fn check_login(&self, user_data_dir: &str) -> DomainResult<bool> {
        let reply = self
            .rpc(json!({ "cmd": "check_login", "user_data_dir": user_data_dir }))
            .await?;
        Ok(reply
            .get("logged_in")
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }

    pub async fn open_login_tabs(&self, handle: &str, sites: &[&str]) -> DomainResult<Vec<String>> {
        let reply = self
            .rpc(json!({ "cmd": "open_login_tabs", "handle": handle, "sites": sites }))
            .await?;
        Ok(reply
            .get("opened")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn check_logins(&self, user_data_dir: &str) -> DomainResult<Map<String, Value>> {
        let reply = self
            .rpc(json!({ "cmd": "check_logins", "user_data_dir": user_data_dir }))
            .await?;
        Ok(reply
            .get("status")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn push_profile_sections(
        &self,
        user_data_dir: &str,
        sections: &[SyncSection],
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        let open_reply = self
            .rpc(json!({
                "cmd":           "open",
                "user_data_dir": user_data_dir,
                "extensions":    [],
                "headless":      headless,
            }))
            .await?;

        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let sections_json = serde_json::to_value(sections)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize sections: {e}")))?;

        let push_result = self
            .rpc(json!({
                "cmd":      "push_profile",
                "handle":   handle,
                "sections": sections_json,
            }))
            .await;

        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = push_result?;
        let results: Vec<SyncSectionResult> = data
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok(results)
    }

    pub async fn push_catho_sections<S: serde::Serialize>(
        &self,
        user_data_dir: &str,
        sections: &[S],
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        let open_reply = self
            .rpc(json!({
                "cmd":           "open",
                "user_data_dir": user_data_dir,
                "extensions":    [],
                "headless":      headless,
            }))
            .await?;

        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let sections_json = serde_json::to_value(sections)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize sections: {e}")))?;

        let push_result = self
            .rpc(json!({
                "cmd":      "catho_push_profile",
                "handle":   handle,
                "sections": sections_json,
            }))
            .await;

        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = push_result?;
        let results: Vec<SyncSectionResult> = data
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok(results)
    }

    pub async fn push_gupy_profile<P: serde::Serialize>(
        &self,
        user_data_dir: &str,
        profile: &P,
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        let open_reply = self
            .rpc(json!({
                "cmd":           "open",
                "user_data_dir": user_data_dir,
                "extensions":    [],
                "headless":      headless,
            }))
            .await?;

        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let profile_json = serde_json::to_value(profile)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize gupy profile: {e}")))?;

        let push_result = self
            .rpc(json!({
                "cmd":     "gupy_push_profile",
                "handle":  handle,
                "profile": profile_json,
            }))
            .await;

        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = push_result?;
        let results: Vec<SyncSectionResult> = data
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok(results)
    }

    pub async fn gupy_start_login(&self, handle: &str) -> DomainResult<()> {
        self.rpc(json!({ "cmd": "gupy_start_login", "handle": handle }))
            .await?;
        Ok(())
    }

    pub async fn push_infojobs_profile<P: serde::Serialize>(
        &self,
        user_data_dir: &str,
        profile: &P,
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        let open_reply = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let profile_json = serde_json::to_value(profile)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize infojobs profile: {e}")))?;

        let push_result = self
            .rpc(json!({
                "cmd":     "infojobs_push_profile",
                "handle":  handle,
                "profile": profile_json,
            }))
            .await;

        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = push_result?;
        let results: Vec<SyncSectionResult> = data
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok(results)
    }

    #[allow(clippy::too_many_arguments)] // scraper param set; Builder refactor tracked in REFACTOR_PLAN
    pub async fn search_catho_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        area_ids: &[i64],
        work_models: &[String],
        last_days: Option<i64>,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": false, "hidden": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "catho_search_jobs",
                "handle": handle,
                "query": query,
                "area_ids": area_ids,
                "work_models": work_models,
                "last_days": last_days,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    #[allow(clippy::too_many_arguments)] // scraper param set; Builder refactor tracked in REFACTOR_PLAN
    pub async fn search_infojobs_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        location: &str,
        work_models: &[String],
        last_days: Option<i64>,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "infojobs_search_jobs",
                "handle": handle,
                "query": query,
                "location": location,
                "work_models": work_models,
                "last_days": last_days,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn search_upwork_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        sort: &str,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": false, "hidden": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "upwork_search_jobs",
                "handle": handle,
                "query": query,
                "sort": sort,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn search_freelas99_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "freelas99_search_jobs",
                "handle": handle,
                "query": query,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn search_programathor_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "programathor_search_jobs",
                "handle": handle,
                "query": query,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn search_geekhunter_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        remote_only: bool,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "geekhunter_search_jobs",
                "handle": handle,
                "query": query,
                "remote_only": remote_only,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn search_gupy_jobs(
        &self,
        user_data_dir: &str,
        query: &str,
        remote_only: bool,
        max_pages: u32,
        headless: bool,
    ) -> DomainResult<SearchJobsResult> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "search_gupy_jobs",
                "handle": handle,
                "query": query,
                "remote_only": remote_only,
                "max_pages": max_pages,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let reply = result?;
        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn catho_apply(
        &self,
        user_data_dir: &str,
        offer_id: &str,
        apply_url: &str,
        headless: bool,
    ) -> DomainResult<Value> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let result = self
            .rpc(json!({
                "cmd": "catho_apply",
                "handle": handle,
                "offer_id": offer_id,
                "apply_url": apply_url,
            }))
            .await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        Ok(Value::Object(result?))
    }

    pub async fn infojobs_apply(
        &self,
        user_data_dir: &str,
        offer_id: &str,
        apply_url: &str,
        answers: Option<&Value>,
        headless: bool,
    ) -> DomainResult<Value> {
        let open = self
            .rpc(json!({ "cmd": "open", "user_data_dir": user_data_dir, "extensions": [], "headless": headless }))
            .await?;
        let handle = open
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let mut req = json!({
            "cmd": "infojobs_apply",
            "handle": handle,
            "offer_id": offer_id,
            "apply_url": apply_url,
        });
        // Phase 2: the AI-drafted killer-question answers. Absent on phase 1, where the worker
        // just reports the questions back for drafting.
        if let Some(a) = answers {
            req["answers"] = a.clone();
        }
        let result = self.rpc(req).await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        Ok(Value::Object(result?))
    }

    pub async fn auto_connect(
        &self,
        user_data_dir: &str,
        max_count: u32,
        delay_ms: u32,
        headless: bool,
        progress: Option<tauri::ipc::Channel<AutoConnectProgress>>,
    ) -> DomainResult<(u32, String)> {
        let open_reply = self
            .rpc(json!({
                "cmd":           "open",
                "user_data_dir": user_data_dir,
                "extensions":    [],
                "headless":      headless,
            }))
            .await?;

        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        // Stream `auto_connect_progress` ticks to the UI channel for the duration of this run.
        let conn = self.conn().await?;
        if let Some(channel) = progress {
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<AutoConnectProgress>();
            *conn.progress_tx.lock().unwrap() = Some(tx);
            tokio::spawn(async move {
                while let Some(p) = rx.recv().await {
                    if channel.send(p).is_err() {
                        break; // frontend dropped the channel
                    }
                }
            });
        }

        let result = self
            .rpc(json!({
                "cmd":       "auto_connect",
                "handle":    handle,
                "max_count": max_count,
                "delay_ms":  delay_ms,
            }))
            .await;

        *conn.progress_tx.lock().unwrap() = None; // stop streaming once the run returns
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = result?;
        let sent = data.get("sent").and_then(Value::as_u64).unwrap_or(0) as u32;
        let status = data
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("ok")
            .to_owned();
        Ok((sent, status))
    }

    pub async fn confirm_submit_parked(&self) -> DomainResult<PostSubmitMeta> {
        let info =
            self.parked.lock().await.take().ok_or_else(|| {
                DomainError::Other(anyhow::anyhow!("no session parked for review"))
            })?;

        self.rpc(json!({ "cmd": "confirm_submit", "handle": info.handle }))
            .await?;

        let screenshot_path = {
            tokio::fs::create_dir_all(&self.screenshot_dir).await.ok();
            let dest = self
                .screenshot_dir
                .join(format!("{}-submit.png", Uuid::new_v4()))
                .to_string_lossy()
                .into_owned();
            self.rpc(json!({ "cmd": "screenshot", "handle": info.handle, "path": dest }))
                .await
                .ok()
                .and_then(|r| r.get("path").and_then(Value::as_str).map(str::to_owned))
        };

        let _ = self
            .rpc(json!({ "cmd": "close", "handle": info.handle }))
            .await;

        Ok(PostSubmitMeta {
            screenshot_path,
            task_id: info.task_id,
            session_id: info.session_id,
        })
    }

    pub async fn reject_submit_parked(&self) -> DomainResult<()> {
        let info =
            self.parked.lock().await.take().ok_or_else(|| {
                DomainError::Other(anyhow::anyhow!("no session parked for review"))
            })?;

        self.rpc(json!({ "cmd": "reject_submit", "handle": info.handle }))
            .await?;
        let _ = self
            .rpc(json!({ "cmd": "close", "handle": info.handle }))
            .await;
        Ok(())
    }

    pub async fn search_indeed_jobs(
        &self,
        handle: &str,
        keywords: &str,
        location: &str,
        page_index: u32,
        remote_only: bool,
    ) -> DomainResult<SearchJobsResult> {
        let reply = self
            .rpc(json!({
                "cmd":        "search_indeed_jobs",
                "handle":     handle,
                "keywords":   keywords,
                "location":   location,
                "page_index": page_index,
                "remote_only": remote_only,
            }))
            .await?;

        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }

    pub async fn fill_indeed_apply(
        &self,
        handle: &str,
        url: &str,
        answers: &serde_json::Value,
    ) -> DomainResult<serde_json::Value> {
        let reply = self
            .rpc(json!({
                "cmd":     "fill_indeed_apply",
                "handle":  handle,
                "url":     url,
                "answers": answers,
            }))
            .await?;

        *self.parked_indeed.lock().await = Some(handle.to_owned());
        Ok(Value::Object(reply))
    }

    pub async fn answer_indeed_free_text(
        &self,
        handle: &str,
        answers: &serde_json::Value,
    ) -> DomainResult<serde_json::Value> {
        let reply = self
            .rpc(json!({
                "cmd":     "answer_indeed_free_text",
                "handle":  handle,
                "answers": answers,
            }))
            .await?;
        *self.parked_indeed.lock().await = Some(handle.to_owned());
        Ok(Value::Object(reply))
    }

    pub async fn confirm_indeed_submit_parked(&self) -> DomainResult<PostSubmitMeta> {
        let handle = self.parked_indeed.lock().await.take().ok_or_else(|| {
            DomainError::Other(anyhow::anyhow!("no Indeed session parked for review"))
        })?;

        self.rpc(json!({ "cmd": "confirm_indeed_submit", "handle": handle }))
            .await?;

        let screenshot_path = {
            tokio::fs::create_dir_all(&self.screenshot_dir).await.ok();
            let dest = self
                .screenshot_dir
                .join(format!("{}-indeed-submit.png", Uuid::new_v4()))
                .to_string_lossy()
                .into_owned();
            self.rpc(json!({ "cmd": "screenshot", "handle": handle, "path": dest }))
                .await
                .ok()
                .and_then(|r| r.get("path").and_then(Value::as_str).map(str::to_owned))
        };

        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        Ok(PostSubmitMeta {
            screenshot_path,
            task_id: None,
            session_id: None,
        })
    }

    pub async fn reject_indeed_submit_parked(&self) -> DomainResult<()> {
        let handle = self.parked_indeed.lock().await.take().ok_or_else(|| {
            DomainError::Other(anyhow::anyhow!("no Indeed session parked for review"))
        })?;

        self.rpc(json!({ "cmd": "reject_indeed_submit", "handle": handle }))
            .await?;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;
        Ok(())
    }

    pub async fn search_google(
        &self,
        handle: &str,
        query: &str,
        page_index: u32,
    ) -> DomainResult<GoogleSearchResult> {
        let reply = self
            .rpc(json!({
                "cmd":        "search_google",
                "handle":     handle,
                "query":      query,
                "page_index": page_index,
            }))
            .await?;

        let results: Vec<GoogleResult> = reply
            .get("results")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let blocked = reply
            .get("blocked")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let has_next_page = reply
            .get("hasNextPage")
            .or_else(|| reply.get("has_next_page"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

        Ok(GoogleSearchResult {
            results,
            blocked,
            has_next_page,
        })
    }

    pub async fn search_linkedin_posts(
        &self,
        handle: &str,
        keywords: &str,
        page_index: u32,
    ) -> DomainResult<LinkedInPostsResult> {
        let reply = self
            .rpc(json!({
                "cmd":        "search_linkedin_posts",
                "handle":     handle,
                "keywords":   keywords,
                "page_index": page_index,
            }))
            .await?;

        let posts: Vec<LinkedInPost> = reply
            .get("posts")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let has_next_page = reply
            .get("hasNextPage")
            .or_else(|| reply.get("has_next_page"))
            .and_then(Value::as_bool)
            .unwrap_or(false);

        Ok(LinkedInPostsResult {
            posts,
            has_next_page,
        })
    }

    pub async fn gmail_send(
        &self,
        handle: &str,
        to: &str,
        subject: &str,
        body: &str,
        attachment_path: Option<&str>,
    ) -> DomainResult<bool> {
        let reply = self
            .rpc(json!({
                "cmd":             "gmail_send",
                "handle":          handle,
                "to":              to,
                "subject":         subject,
                "body":            body,
                "attachment_path": attachment_path,
            }))
            .await?;

        let sent = reply.get("sent").and_then(Value::as_bool).unwrap_or(false);

        if sent {
            Ok(true)
        } else {
            let msg = reply
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("gmail send failed")
                .to_owned();
            Err(DomainError::Other(anyhow::anyhow!("{msg}")))
        }
    }
}

impl BrowserDriver for PlaywrightDriver {
    async fn open(&self, spec: &SessionSpec) -> DomainResult<String> {
        let reply = self
            .rpc(json!({
                "cmd":          "open",
                "profile_id":   spec.profile_id,
                "user_data_dir": spec.user_data_dir,
                "extensions":   spec.extensions,
                "headless":     spec.headless,
            }))
            .await?;

        let handle = reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        // Remember the live session so the Evidence Viewer can attach without a handle.
        *self.current_session.lock().await = Some(handle.clone());
        Ok(handle)
    }

    async fn navigate(&self, handle: &str, url: &str) -> DomainResult<()> {
        self.rpc(json!({ "cmd": "navigate", "handle": handle, "url": url }))
            .await?;
        Ok(())
    }

    async fn probe(&self, handle: &str) -> DomainResult<PageState> {
        let reply = self
            .rpc(json!({ "cmd": "probe", "handle": handle }))
            .await?;
        Ok(
            match reply
                .get("state")
                .and_then(Value::as_str)
                .unwrap_or("NoAction")
            {
                "CaptchaWall" => PageState::CaptchaWall,
                "ApplyForm" => PageState::ApplyForm,
                _ => PageState::NoAction,
            },
        )
    }

    async fn fill_easy_apply(&self, handle: &str, input: &EasyApplyInput) -> DomainResult<()> {
        self.rpc(json!({
            "cmd":         "fill_easy_apply",
            "handle":      handle,
            "url":         input.url,
            "answers":     input.answers,
            "cover_letter": input.cover_letter,
            "cv_path":     input.cv_path,
        }))
        .await?;

        *self.parked.lock().await = Some(ParkedInfo {
            handle: handle.to_owned(),
            task_id: input.task_id.clone(),
            session_id: input.session_id.clone(),
        });
        Ok(())
    }

    async fn fill_easy_apply_collect(
        &self,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<Vec<Value>> {
        let reply = self
            .rpc(json!({
                "cmd":         "fill_easy_apply",
                "handle":      handle,
                "url":         input.url,
                "answers":     input.answers,
                "cover_letter": input.cover_letter,
                "cv_path":     input.cv_path,
            }))
            .await?;

        *self.parked.lock().await = Some(ParkedInfo {
            handle: handle.to_owned(),
            task_id: input.task_id.clone(),
            session_id: input.session_id.clone(),
        });

        Ok(reply
            .get("unanswered")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    async fn answer_easy_apply(&self, handle: &str, questions: &Value) -> DomainResult<Vec<Value>> {
        let reply = self
            .rpc(json!({
                "cmd":       "answer_easy_apply",
                "handle":    handle,
                "questions": questions.get("questions").cloned().unwrap_or_else(|| questions.clone()),
            }))
            .await?;
        Ok(reply
            .get("unanswered")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }

    async fn confirm_submit(&self, handle: &str) -> DomainResult<bool> {
        let reply = self
            .rpc(json!({ "cmd": "confirm_submit", "handle": handle }))
            .await?;
        Ok(reply
            .get("submitted")
            .and_then(Value::as_bool)
            .unwrap_or(true))
    }

    async fn screenshot(&self, handle: &str) -> DomainResult<String> {
        tokio::fs::create_dir_all(&self.screenshot_dir)
            .await
            .map_err(|e| DomainError::Other(anyhow::anyhow!("mkdir screenshots: {e}")))?;

        let dest = self
            .screenshot_dir
            .join(format!("{}.png", Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();

        let reply = self
            .rpc(json!({ "cmd": "screenshot", "handle": handle, "path": dest }))
            .await?;

        Ok(reply
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or(&dest)
            .to_owned())
    }

    async fn dom_snapshot(&self, handle: &str) -> DomainResult<String> {
        let reply = self
            .rpc(json!({ "cmd": "dom_snapshot", "handle": handle }))
            .await?;
        Ok(reply
            .get("dom")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned())
    }

    async fn close(&self, handle: &str) -> DomainResult<()> {
        self.rpc(json!({ "cmd": "close", "handle": handle }))
            .await?;
        Ok(())
    }

    async fn extract_hr(&self, handle: &str) -> DomainResult<Option<String>> {
        let reply = self
            .rpc(json!({ "cmd": "extract_hr", "handle": handle }))
            .await?;

        let name = reply.get("hr_name").and_then(Value::as_str);
        let profile_url = reply.get("hr_profile_url").and_then(Value::as_str);

        match (name, profile_url) {
            (None, None) => Ok(None),
            (n, p) => Ok(Some(
                serde_json::json!({ "name": n, "profile_url": p }).to_string(),
            )),
        }
    }

    async fn search_jobs(
        &self,
        handle: &str,
        input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult> {
        let reply = self
            .rpc(json!({
                "cmd":            "search_jobs",
                "handle":         handle,
                "keywords":       input.keywords,
                "location":       input.location,
                "page_index":     input.page_index,
                "filters": {
                    "easy_apply_only": input.easy_apply_only,
                    "remote_only":     input.remote_only,
                    "date_posted":     input.date_posted,
                },
            }))
            .await?;

        let jobs: Vec<JobCard> = reply
            .get("jobs")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let has_next_page = reply
            .get("has_next_page")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        Ok(SearchJobsResult {
            jobs,
            has_next_page,
        })
    }
}

impl BrowserDriver for std::sync::Arc<PlaywrightDriver> {
    async fn open(&self, spec: &SessionSpec) -> DomainResult<String> {
        (**self).open(spec).await
    }
    async fn navigate(&self, handle: &str, url: &str) -> DomainResult<()> {
        (**self).navigate(handle, url).await
    }
    async fn probe(&self, handle: &str) -> DomainResult<PageState> {
        (**self).probe(handle).await
    }
    async fn fill_easy_apply(&self, handle: &str, input: &EasyApplyInput) -> DomainResult<()> {
        (**self).fill_easy_apply(handle, input).await
    }
    async fn fill_easy_apply_collect(
        &self,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<Vec<Value>> {
        (**self).fill_easy_apply_collect(handle, input).await
    }
    async fn answer_easy_apply(&self, handle: &str, questions: &Value) -> DomainResult<Vec<Value>> {
        (**self).answer_easy_apply(handle, questions).await
    }
    async fn confirm_submit(&self, handle: &str) -> DomainResult<bool> {
        (**self).confirm_submit(handle).await
    }
    async fn screenshot(&self, handle: &str) -> DomainResult<String> {
        (**self).screenshot(handle).await
    }
    async fn dom_snapshot(&self, handle: &str) -> DomainResult<String> {
        (**self).dom_snapshot(handle).await
    }
    async fn close(&self, handle: &str) -> DomainResult<()> {
        (**self).close(handle).await
    }
    async fn extract_hr(&self, handle: &str) -> DomainResult<Option<String>> {
        (**self).extract_hr(handle).await
    }
    async fn search_jobs(
        &self,
        handle: &str,
        input: &SearchJobsInput,
    ) -> DomainResult<SearchJobsResult> {
        (**self).search_jobs(handle, input).await
    }
}

fn locate_worker_script() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe
            .parent()
            .map(|d| d.join("automation").join("worker.js"))
            .unwrap_or_default();
        if candidate.exists() {
            return candidate;
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(&manifest)
            .parent()
            .map(|r| r.join("automation").join("worker.js"))
            .unwrap_or_default();
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("automation/worker.js")
}
