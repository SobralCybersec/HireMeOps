use super::*;

impl PlaywrightDriver {
    pub fn new(data_root: impl Into<PathBuf>) -> Self {
        let data_root: PathBuf = data_root.into();

        let worker_script = locate_worker_script();

        Self {
            worker_script,
            profiles_root: data_root.join("profiles"),
            conn: Mutex::new(None),
            screenshot_dir: data_root.join("screenshots"),
            parked: Mutex::new(None),
            parked_indeed: Mutex::new(None),
            login_session: Mutex::new(None),
            login_profile_id: Mutex::new(None),
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
    pub(super) async fn remember_session(&self, handle: &str) {
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
        *self.login_profile_id.lock().await = Some(spec.profile_id.clone());
        Ok(handle)
    }

    pub async fn login_session_for(&self, profile_id: &str) -> Option<String> {
        if self.login_profile_id.lock().await.as_deref() != Some(profile_id) {
            return None;
        }
        self.login_session.lock().await.clone()
    }

    pub(super) async fn conn(&self) -> DomainResult<Arc<WorkerConn>> {
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
        let c = WorkerConn::spawn(&self.worker_script, &self.profiles_root).await?;
        *slot = Some(c.clone());
        Ok(c)
    }

    pub(super) async fn rpc(&self, payload: Value) -> DomainResult<Map<String, Value>> {
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
        if self.login_session.lock().await.as_deref() == Some(handle) {
            *self.login_session.lock().await = None;
            *self.login_profile_id.lock().await = None;
        }
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
        let reply = self.check_logins_detailed(user_data_dir).await?;
        Ok(reply
            .get("status")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn check_logins_detailed(
        &self,
        user_data_dir: &str,
    ) -> DomainResult<Map<String, Value>> {
        self.rpc(json!({ "cmd": "check_logins", "user_data_dir": user_data_dir }))
            .await
    }

    pub async fn export_storage_state(&self, handle: &str) -> DomainResult<(i32, Value)> {
        let reply = self
            .rpc(json!({ "cmd": "export_storage_state", "handle": handle }))
            .await?;
        let version = reply
            .get("version")
            .and_then(Value::as_i64)
            .ok_or_else(|| {
                DomainError::Other(anyhow::anyhow!("storage state reply missing version"))
            })? as i32;
        let state = reply.get("storageState").cloned().ok_or_else(|| {
            DomainError::Other(anyhow::anyhow!("storage state reply missing state"))
        })?;
        Ok((version, state))
    }

    pub async fn import_storage_state(
        &self,
        handle: &str,
        version: i32,
        storage_state: Value,
    ) -> DomainResult<()> {
        self.rpc(json!({
            "cmd": "import_storage_state",
            "handle": handle,
            "version": version,
            "storageState": storage_state,
        }))
        .await?;
        Ok(())
    }
}
