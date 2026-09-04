use super::*;

pub(crate) struct CathoSearchOptions<'a> {
    pub user_data_dir: &'a str,
    pub query: &'a str,
    pub area_ids: &'a [i64],
    pub work_models: &'a [String],
    pub last_days: Option<i64>,
    pub max_pages: u32,
    pub headless: bool,
}

pub(crate) struct InfojobsSearchOptions<'a> {
    pub user_data_dir: &'a str,
    pub query: &'a str,
    pub location: &'a str,
    pub work_models: &'a [String],
    pub last_days: Option<i64>,
    pub max_pages: u32,
    pub headless: bool,
}

impl PlaywrightDriver {
    pub(crate) async fn search_catho_jobs(
        &self,
        options: CathoSearchOptions<'_>,
    ) -> DomainResult<SearchJobsResult> {
        let CathoSearchOptions {
            user_data_dir,
            query,
            area_ids,
            work_models,
            last_days,
            max_pages,
            headless,
        } = options;
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

    pub(crate) async fn search_infojobs_jobs(
        &self,
        options: InfojobsSearchOptions<'_>,
    ) -> DomainResult<SearchJobsResult> {
        let InfojobsSearchOptions {
            user_data_dir,
            query,
            location,
            work_models,
            last_days,
            max_pages,
            headless,
        } = options;
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
}
