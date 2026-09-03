//! Native Playwright browser bridge: spawns a Node child speaking
//! newline-delimited JSON-RPC to drive AI completions through a real,
//! logged-in browser session instead of a paid API key.
//! Key: PlaywrightBridge — one bridge per site; owns the Node subprocess, the pending-request map, and the JSON-RPC request/response cycle
//! Key: manual_login — opens a visible browser for one-time interactive login, returns the scanned model list
//! Key: ensure_init/chat — idempotent session init, then the `chat` RPC used for browser-backed completions
//! Key: resolve_helper_dir — locates the shipped `index.mjs` helper across dev/production layouts
//! Key: the process registry (REGISTRY/bridge_for) — process-wide site → bridge map so completions reuse one warm session

use anyhow::{anyhow, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStderr, ChildStdin, ChildStdout, Command},
    sync::{oneshot, Mutex},
};

// Outer RPC ceiling. Kept ABOVE the bridge's inner Playwright timeouts (the
// conversation POST + the completion poll) so a genuinely slow generation is
// aborted by the inner layer with a precise error, not guillotined here first.
const DEFAULT_BRIDGE_TIMEOUT_MS: u64 = 360_000;

const DEFAULT_LOGIN_TIMEOUT_MS: u64 = 315_000;

// Sites `index.mjs` implements a handler for. Mirrors BROWSER_SITES in
// src/pages/settings/BrowserProviderPanel.tsx — both lists must move together.
pub const BROWSER_SITES: &[&str] = &["chatgpt"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InitParams {
    pub runtime_dir: String,
    pub headless: bool,
    pub browser: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManualLoginParams {
    pub runtime_dir: String,
    pub browser: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct BridgeChatResponse {
    pub text: String,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowserModelList {
    #[serde(default)]
    pub data: Vec<BrowserModel>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct BrowserModel {
    pub id: String,
    #[serde(default)]
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct BrowserAuthStatus {
    #[serde(default)]
    logged_in: bool,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct RpcRequest<'a, T: Serialize> {
    id: u64,
    method: &'a str,
    provider: &'a str,
    params: T,
}

struct BridgeProcess {
    #[allow(dead_code)]
    pid: u32,
    stdin: Arc<Mutex<ChildStdin>>,
    #[allow(dead_code)]
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct PlaywrightBridge {
    site: String,
    helper_dir: PathBuf,
    node_path: PathBuf,
    process: Arc<Mutex<Option<BridgeProcess>>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>>,
    next_id: AtomicU64,
    initialized: Arc<Mutex<bool>>,
    request_timeout: Duration,
}

impl PlaywrightBridge {
    fn new(site: impl Into<String>) -> Self {
        let request_timeout = Duration::from_millis(
            std::env::var("HIREMEOPS_BROWSER_BRIDGE_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_BRIDGE_TIMEOUT_MS),
        );
        Self {
            site: site.into(),
            helper_dir: resolve_helper_dir(),
            node_path: resolve_node_path(),
            process: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            initialized: Arc::new(Mutex::new(false)),
            request_timeout,
        }
    }

    pub async fn is_initialized(&self) -> bool {
        *self.initialized.lock().await
    }

    pub async fn is_running(&self) -> bool {
        self.process.lock().await.is_some()
    }

    pub async fn ensure_init(&self) -> Result<()> {
        let mut initialized = self.initialized.lock().await;
        if *initialized {
            return Ok(());
        }
        let params = InitParams {
            runtime_dir: resolve_runtime_dir().to_string_lossy().into_owned(),
            headless: headless_default(),
            browser: default_browser(),
        };
        self.request_raw::<_, Value>("init", params).await?;
        *initialized = true;
        Ok(())
    }

    pub async fn manual_login(&self) -> Result<BrowserModelList> {
        let params = ManualLoginParams {
            runtime_dir: resolve_runtime_dir().to_string_lossy().into_owned(),
            browser: default_browser(),
            account_id: None,
        };
        let login_timeout = Duration::from_millis(
            std::env::var("HIREMEOPS_BROWSER_LOGIN_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(DEFAULT_LOGIN_TIMEOUT_MS),
        );
        let models = self
            .request_raw_timeout::<_, BrowserModelList>("manual_login", params, login_timeout)
            .await?;
        *self.initialized.lock().await = true;
        Ok(models)
    }

    pub async fn logout(&self) -> Result<()> {
        self.ensure_init().await?;
        self.request_raw::<_, Value>("logout", json!({})).await?;
        *self.initialized.lock().await = false;
        Ok(())
    }

    pub async fn is_logged_in(&self) -> bool {
        // Status may race app-start warm_up. Ensure the helper exists here so
        // the first status read can still discover a persisted session.
        if !self.is_running().await && self.ensure_process().await.is_err() {
            return false;
        }
        // The app warms the Node helper process before any browser context is
        // created. Initialize lazily here so status can discover a persisted
        // login instead of reporting false until a manual model load.
        if self.ensure_init().await.is_err() {
            return false;
        }
        self.request_raw_timeout::<_, BrowserAuthStatus>(
            "status",
            json!({}),
            Duration::from_secs(10),
        )
        .await
        .map(|status| status.logged_in)
        .unwrap_or(false)
    }

    pub async fn request<T: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: T,
    ) -> Result<R> {
        self.request_raw(method, params).await
    }

    async fn request_raw<T: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: T,
    ) -> Result<R> {
        self.request_raw_timeout(method, params, self.request_timeout)
            .await
    }

    async fn request_raw_timeout<T: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: T,
        timeout: Duration,
    ) -> Result<R> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = RpcRequest {
            id,
            method,
            provider: &self.site,
            params,
        };
        let payload = serde_json::to_vec(&request)?;

        let stdin = self.ensure_process().await?;
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);

        {
            let mut stdin = stdin.lock().await;
            stdin.write_all(&payload).await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
        }

        let value = match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result?,
            Ok(Err(_)) => {
                return Err(anyhow!(
                    "browser bridge response channel closed (site={}, method={method}, id={id})",
                    self.site
                ))
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(anyhow!(
                    "browser bridge request timed out (site={}, method={method})",
                    self.site
                ));
            }
        };
        Ok(serde_json::from_value(value)?)
    }

    async fn ensure_process(&self) -> Result<Arc<Mutex<ChildStdin>>> {
        let mut guard = self.process.lock().await;
        if let Some(process) = guard.as_ref() {
            return Ok(Arc::clone(&process.stdin));
        }

        let mut command = Command::new(&self.node_path);
        command
            .arg("index.mjs")
            .current_dir(&self.helper_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|e| {
            anyhow!(
                "failed to start browser bridge helper (node={}, cwd={}): {e}",
                self.node_path.display(),
                self.helper_dir.display()
            )
        })?;
        let child_id = child.id().unwrap_or_default();

        let stdin = Arc::new(Mutex::new(
            child
                .stdin
                .take()
                .ok_or_else(|| anyhow!("helper stdin unavailable"))?,
        ));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("helper stdout unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("helper stderr unavailable"))?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        self.spawn_stdout_reader(stdout);
        self.spawn_stderr_reader(stderr);
        self.spawn_exit_waiter(child, child_id, shutdown_rx);

        *guard = Some(BridgeProcess {
            pid: child_id,
            stdin: Arc::clone(&stdin),
            shutdown_tx: Some(shutdown_tx),
        });
        Ok(stdin)
    }

    fn spawn_stdout_reader(&self, stdout: ChildStdout) {
        let pending = Arc::clone(&self.pending);
        let site = self.site.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<RpcResponse>(&line) {
                            Ok(response) => {
                                if let Some(sender) = pending.lock().await.remove(&response.id) {
                                    let _ = sender.send(match response.error {
                                        Some(error) => Err(anyhow!(error)),
                                        None => Ok(response.result.unwrap_or(Value::Null)),
                                    });
                                }
                            }
                            Err(err) => {
                                tracing::warn!(
                                    site = %site,
                                    "browser bridge: unparsable helper output: {err}; line={line}"
                                );
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        tracing::warn!(site = %site, "browser bridge stdout error: {err}");
                        break;
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(&self, stderr: ChildStderr) {
        let site = self.site.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(site = %site, "browser bridge stderr: {line}");
            }
        });
    }

    fn spawn_exit_waiter(
        &self,
        mut child: tokio::process::Child,
        child_id: u32,
        mut shutdown_rx: oneshot::Receiver<()>,
    ) {
        let process = Arc::clone(&self.process);
        let pending = Arc::clone(&self.pending);
        let initialized = Arc::clone(&self.initialized);
        let site = self.site.clone();
        tokio::spawn(async move {
            let expected_shutdown = tokio::select! {
                _ = child.wait() => false,
                _ = &mut shutdown_rx => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    true
                }
            };

            {
                let mut guard = process.lock().await;
                if guard.as_ref().map(|p| p.pid) == Some(child_id) {
                    *guard = None;
                    *initialized.lock().await = false;
                }
            }

            let message = if expected_shutdown {
                format!("browser bridge helper shut down (site={site})")
            } else {
                format!("browser bridge helper exited unexpectedly (site={site})")
            };
            for (_, sender) in pending.lock().await.drain() {
                let _ = sender.send(Err(anyhow!(message.clone())));
            }
        });
    }

    #[allow(dead_code)]
    pub async fn shutdown(&self) -> Result<()> {
        if self.process.lock().await.is_none() {
            return Ok(());
        }
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            self.request_raw::<_, Value>("shutdown", json!({})),
        )
        .await;
        *self.initialized.lock().await = false;
        let shutdown_tx = self
            .process
            .lock()
            .await
            .as_mut()
            .and_then(|p| p.shutdown_tx.take());
        if let Some(tx) = shutdown_tx {
            let _ = tx.send(());
        }
        match result {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(anyhow!(
                "browser bridge shutdown timed out (site={})",
                self.site
            )),
        }
    }
}

static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<PlaywrightBridge>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, Arc<PlaywrightBridge>>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn bridge_for(site: &str) -> Arc<PlaywrightBridge> {
    let mut map = registry().lock().await;
    if let Some(bridge) = map.get(site) {
        return Arc::clone(bridge);
    }
    let bridge = Arc::new(PlaywrightBridge::new(site.to_string()));
    map.insert(site.to_string(), Arc::clone(&bridge));
    bridge
}

/// Spawn each site's helper process at app start so the first user action does
/// not pay for it. The Node child loads Playwright at module scope (`index.mjs`:
/// `const playwright = await importPlaywright()`), and that import — not the
/// login itself — is the bulk of a cold "Log in" click; pre-paying it here is
/// what makes the window open promptly instead of stalling for seconds.
///
/// Deliberately stops at the process: `init` is NOT sent. A warm init would
/// launch a HEADLESS persistent context, and `openChatGPTLogin` re-inits with
/// `headless: false`, so `initChatGPT` would tear that context down and relaunch
/// — paying the browser launch twice and reviving the headless flip that used to
/// log the site back out mid-login.
///
/// Registering the bridges is the other half of the fix: `status()` enumerates
/// these known sites, so the settings panel has rows on its first mount.
pub async fn warm_up() {
    for site in BROWSER_SITES {
        let bridge = bridge_for(site).await;
        match bridge.ensure_process().await {
            Ok(_) => tracing::info!(site = %site, "browser bridge helper warm"),
            // Non-fatal: login retries ensure_process, just without the head start.
            Err(err) => tracing::warn!(site = %site, "browser bridge warm-up failed: {err:#}"),
        }
    }
}

pub async fn chat(site: &str, model: &str, prompt: String, web_search: bool) -> Result<String> {
    let bridge = bridge_for(site).await;
    bridge.ensure_init().await?;
    let response: BridgeChatResponse = bridge
        .request(
            "chat",
            json!({
                "model": model,
                "prompt": prompt,
                "web_search": web_search,
            }),
        )
        .await?;
    if let Some(warning) = &response.warning {
        tracing::warn!(site = %site, "browser bridge chat warning: {warning}");
    }
    Ok(response.text)
}

pub async fn list_models(site: &str) -> Result<Vec<String>> {
    let bridge = bridge_for(site).await;
    bridge.ensure_init().await?;
    let response: BrowserModelList = bridge.request("list_models", json!({})).await?;
    Ok(response.data.into_iter().map(|m| m.id).collect())
}

pub async fn manual_login(site: &str) -> Result<Vec<String>> {
    let bridge = bridge_for(site).await;
    let response = bridge.manual_login().await?;
    Ok(response.data.into_iter().map(|m| m.id).collect())
}

pub async fn logout(site: &str) -> Result<()> {
    let bridge = bridge_for(site).await;
    bridge.logout().await
}

#[allow(dead_code)]
pub async fn ensure_initialized(site: &str) -> Result<()> {
    let bridge = bridge_for(site).await;
    bridge.ensure_init().await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProviderStatus {
    pub site: String,
    pub initialized: bool,
    pub running: bool,
    pub logged_in: bool,
}

pub async fn status() -> Vec<BrowserProviderStatus> {
    let mut bridges = Vec::with_capacity(BROWSER_SITES.len());
    for site in BROWSER_SITES {
        bridges.push(((*site).to_string(), bridge_for(site).await));
    }
    let mut out = Vec::with_capacity(bridges.len());
    for (site, bridge) in bridges {
        out.push(BrowserProviderStatus {
            site,
            initialized: bridge.is_initialized().await,
            running: bridge.is_running().await,
            logged_in: bridge.is_logged_in().await,
        });
    }
    out
}

fn resolve_helper_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HIREMEOPS_BROWSER_BRIDGE_DIR") {
        return PathBuf::from(dir);
    }

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()))
    {
        let bundled = exe_dir.join("resources").join("playwright-bridge");
        if bundled.exists() {
            return bundled;
        }
        let direct = exe_dir.join("playwright-bridge");
        if direct.exists() {
            return direct;
        }
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("playwright-bridge");
    if dev.exists() {
        return dev;
    }

    PathBuf::from("resources/playwright-bridge")
}

fn resolve_node_path() -> PathBuf {
    std::env::var("HIREMEOPS_NODE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("node"))
}

fn resolve_runtime_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HIREMEOPS_BROWSER_RUNTIME_DIR") {
        return PathBuf::from(dir);
    }
    std::env::temp_dir().join("hiremeops-browser")
}

fn default_browser() -> String {
    std::env::var("HIREMEOPS_BROWSER_ENGINE").unwrap_or_else(|_| "chromium".to_string())
}

fn headless_default() -> bool {
    std::env::var("HIREMEOPS_BROWSER_HEADLESS")
        .map(|v| !matches!(v.to_lowercase().as_str(), "false" | "0" | "no"))
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The registry half of the warm-up fix: `status()` walks the registry, so
    /// an unregistered site left the settings panel blank until the first login.
    /// Points the helper at an empty dir — the Node spawn is allowed to fail
    /// here; registration must happen either way.
    #[tokio::test]
    async fn warm_up_registers_every_known_site() {
        let tmp = std::env::temp_dir().join("hiremeops-bridge-warmup-test");
        let _ = std::fs::create_dir_all(&tmp);
        std::env::set_var("HIREMEOPS_BROWSER_BRIDGE_DIR", &tmp);

        warm_up().await;

        let map = registry().lock().await;
        for site in BROWSER_SITES {
            assert!(map.contains_key(*site), "warm_up did not register {site}");
        }
    }

    #[test]
    fn browser_model_list_preserves_order() {
        let list: BrowserModelList = serde_json::from_value(json!({
            "data": [
                { "id": "gpt-4o", "provider": "chatgpt" },
                { "id": "gpt-4o-mini", "provider": "chatgpt" },
                { "id": "o1", "provider": "chatgpt" },
            ]
        }))
        .expect("valid list_models payload");
        let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["gpt-4o", "gpt-4o-mini", "o1"]);
    }

    #[test]
    fn browser_model_list_single_fallback() {
        let list: BrowserModelList = serde_json::from_str(
            r#"{ "data": [ { "id": "chatgpt-web-session", "provider": "chatgpt" } ] }"#,
        )
        .expect("valid fallback payload");
        let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["chatgpt-web-session"]);
    }

    #[test]
    fn browser_model_list_empty_data() {
        let list: BrowserModelList =
            serde_json::from_value(json!({ "data": [] })).expect("valid empty payload");
        let ids: Vec<String> = list.data.into_iter().map(|m| m.id).collect();
        assert!(ids.is_empty());
    }
}
