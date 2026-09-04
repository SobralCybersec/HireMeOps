use super::*;

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
