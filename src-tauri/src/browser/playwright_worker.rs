use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

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

pub(super) struct WorkerConn {
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    pub(super) frame_tx: FrameSlot,
    pub(super) progress_tx: ProgressSlot,
    pub(super) _child: Mutex<Child>,
    pub(super) _reader: tokio::task::JoinHandle<()>,
}

/// True when the user opted the worker into Docker (`HIREMEOPS_USE_DOCKER=1`) AND the
/// image is available locally. `docker images -q` needs a live daemon, so a success
/// here also proves the daemon is up — one probe covers the whole gate. Any failure
/// (opt-out, no docker, daemon down, image missing) falls back to the host `node` path.
fn docker_worker_enabled() -> bool {
    if std::env::var("HIREMEOPS_USE_DOCKER").as_deref() != Ok("1") {
        return false;
    }
    std::process::Command::new("docker")
        .args(["images", "-q", crate::commands::docker::WORKER_IMAGE])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

impl WorkerConn {
    pub(super) async fn spawn(
        script: &PathBuf,
        profiles_root: &std::path::Path,
    ) -> DomainResult<Arc<Self>> {
        let use_docker = docker_worker_enabled();
        let mut child = spawn_child(script, profiles_root, use_docker).await?;

        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let pending: PendingMap = Arc::new(std::sync::Mutex::new(HashMap::new()));
        let frame_tx: FrameSlot = Arc::new(std::sync::Mutex::new(None));
        let progress_tx: ProgressSlot = Arc::new(std::sync::Mutex::new(None));

        let reader = start_reader(
            stdout,
            pending.clone(),
            frame_tx.clone(),
            progress_tx.clone(),
        );

        Ok(Arc::new(Self {
            stdin: Mutex::new(stdin),
            pending,
            frame_tx,
            progress_tx,
            _child: Mutex::new(child),
            _reader: reader,
        }))
    }

    pub(super) async fn send(&self, mut payload: Value) -> DomainResult<Map<String, Value>> {
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

async fn spawn_child(
    script: &PathBuf,
    profiles_root: &std::path::Path,
    use_docker: bool,
) -> DomainResult<Child> {
    use std::process::Stdio;
    let mut command = build_worker_command(script, profiles_root, use_docker);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            let target = if use_docker {
                "docker".to_owned()
            } else {
                script.display().to_string()
            };
            DomainError::Other(anyhow::anyhow!(
                "Failed to spawn patchright worker via {target}: {error}"
            ))
        })
}

fn build_worker_command(
    script: &PathBuf,
    profiles_root: &std::path::Path,
    use_docker: bool,
) -> tokio::process::Command {
    if use_docker {
        tracing::info!(
            image = crate::commands::docker::WORKER_IMAGE,
            "spawning patchright worker in Docker"
        );
        let mount = format!("{p}:{p}", p = profiles_root.display());
        let mut command = tokio::process::Command::new("docker");
        command
            .args([
                "run",
                "--rm",
                "-i",
                "--init",
                "--ipc=host",
                "--shm-size=2g",
                "--cap-add=SYS_ADMIN",
                "-v",
            ])
            .arg(mount)
            .arg(crate::commands::docker::WORKER_IMAGE);
        return command;
    }
    let mut command = tokio::process::Command::new("node");
    command.arg(script);
    command
}

fn start_reader(
    stdout: ChildStdout,
    pending: PendingMap,
    frame_tx: FrameSlot,
    progress_tx: ProgressSlot,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move { read_worker_lines(stdout, pending, frame_tx, progress_tx).await })
}

async fn read_worker_lines(
    stdout: ChildStdout,
    pending: PendingMap,
    frame_tx: FrameSlot,
    progress_tx: ProgressSlot,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(raw_line)) = lines.next_line().await {
        let line = raw_line.trim().to_owned();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!("patchright worker: unparseable reply: {error} — {line}");
                continue;
            }
        };
        if route_event(&value, &frame_tx, &progress_tx) {
            continue;
        }
        route_reply(value, &line, &pending);
    }
    pending.lock().unwrap().clear();
    tracing::info!("patchright worker stdout closed");
}

fn route_event(value: &Value, frame_tx: &FrameSlot, progress_tx: &ProgressSlot) -> bool {
    match value.get("event").and_then(Value::as_str) {
        Some("screencast_frame") => {
            route_frame(value, frame_tx);
            true
        }
        Some("auto_connect_progress") => {
            route_progress(value, progress_tx);
            true
        }
        _ => false,
    }
}

fn route_frame(value: &Value, frame_tx: &FrameSlot) {
    if let Some(tx) = frame_tx.lock().unwrap().as_ref() {
        let _ = tx.send(LiveFrame {
            data: value
                .get("data")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            width: value.get("width").and_then(Value::as_u64).unwrap_or(0) as u32,
            height: value.get("height").and_then(Value::as_u64).unwrap_or(0) as u32,
        });
    }
}

fn route_progress(value: &Value, progress_tx: &ProgressSlot) {
    if let Some(tx) = progress_tx.lock().unwrap().as_ref() {
        let _ = tx.send(AutoConnectProgress {
            sent: value.get("sent").and_then(Value::as_u64).unwrap_or(0) as u32,
            status: value
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("ok")
                .to_owned(),
        });
    }
}

fn route_reply(value: Value, line: &str, pending: &PendingMap) {
    match serde_json::from_value::<WorkerReply>(value) {
        Ok(reply) => {
            if let Some(tx) = pending.lock().unwrap().remove(&reply.id) {
                let _ = tx.send(reply);
            }
        }
        Err(error) => tracing::warn!("patchright worker: unparseable reply: {error} — {line}"),
    }
}
