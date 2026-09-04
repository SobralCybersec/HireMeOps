use super::*;

impl PlaywrightDriver {
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
}
