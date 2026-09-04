use super::*;

impl PlaywrightDriver {
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
