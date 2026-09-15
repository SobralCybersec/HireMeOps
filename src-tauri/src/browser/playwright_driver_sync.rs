use super::*;

impl PlaywrightDriver {
    async fn run_profile_push<T: serde::Serialize>(
        &self,
        user_data_dir: &str,
        headless: bool,
        command: &str,
        payload_name: &str,
        payload: &T,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        let open_reply = self
            .rpc(json!({
                "cmd": "open",
                "user_data_dir": user_data_dir,
                "extensions": [],
                "headless": headless,
            }))
            .await?;
        let handle = open_reply
            .get("handle")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DomainError::Other(anyhow::anyhow!("open reply missing handle")))?;
        self.remember_session(&handle).await;

        let payload = serde_json::to_value(payload)
            .map_err(|e| DomainError::Other(anyhow::anyhow!("serialize {payload_name}: {e}")))?;
        let mut request = json!({ "cmd": command, "handle": handle });
        request[payload_name] = payload;
        let push_result = self.rpc(request).await;
        let _ = self.rpc(json!({ "cmd": "close", "handle": handle })).await;

        let data = push_result?;
        Ok(data
            .get("results")
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn push_profile_sections(
        &self,
        user_data_dir: &str,
        sections: &[SyncSection],
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        self.run_profile_push(
            user_data_dir,
            headless,
            "push_profile",
            "sections",
            &sections,
        )
        .await
    }

    pub async fn push_catho_sections<S: serde::Serialize>(
        &self,
        user_data_dir: &str,
        sections: &[S],
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        self.run_profile_push(
            user_data_dir,
            headless,
            "catho_push_profile",
            "sections",
            &sections,
        )
        .await
    }

    pub async fn push_gupy_profile<P: serde::Serialize>(
        &self,
        user_data_dir: &str,
        profile: &P,
        headless: bool,
    ) -> DomainResult<Vec<SyncSectionResult>> {
        self.run_profile_push(
            user_data_dir,
            headless,
            "gupy_push_profile",
            "profile",
            profile,
        )
        .await
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
        self.run_profile_push(
            user_data_dir,
            headless,
            "infojobs_push_profile",
            "profile",
            profile,
        )
        .await
    }
}
