use super::*;

fn outcome_state(outcome: TaskOutcome) -> &'static str {
    match outcome {
        TaskOutcome::Completed => "Completed",
        TaskOutcome::PausedForCaptcha => "PausedForCaptcha",
        TaskOutcome::PausedForReview => "NeedsReview",
        TaskOutcome::Aborted => "Stopped",
    }
}

async fn task_metadata(db: &SqlitePool, task_id: &str) -> (Option<String>, Option<String>) {
    let job_url = sqlx::query_scalar::<_, Option<String>>(
        "SELECT json_extract(payload_json, '$.url') FROM automation_tasks WHERE id = ?1",
    )
    .bind(task_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten();
    let platform = sqlx::query_scalar::<_, Option<String>>(
        "SELECT json_extract(payload_json, '$.platform') FROM automation_tasks WHERE id = ?1",
    )
    .bind(task_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .flatten();
    (job_url, platform)
}

async fn review_contact(
    db: &SqlitePool,
    task_id: &str,
    outcome: TaskOutcome,
) -> (Option<String>, Option<String>) {
    if !matches!(outcome, TaskOutcome::PausedForReview) {
        return (None, None);
    }
    sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT hr_name, hr_link FROM automation_tasks WHERE id = ?1",
    )
    .bind(task_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .map_or((None, None), |(name, link)| (name, link))
}

fn count_outcome(summary: &mut QueueRunSummary, outcome: TaskOutcome) {
    summary.ran += 1;
    match outcome {
        TaskOutcome::Completed => summary.completed += 1,
        TaskOutcome::PausedForCaptcha | TaskOutcome::PausedForReview => summary.paused += 1,
        TaskOutcome::Aborted => summary.aborted += 1,
    }
}

async fn rate_limited(db: &SqlitePool, platform: Option<&str>) -> Option<String> {
    let platform = platform?;
    let decision = crate::domain::rate::rate_check(db, platform).await;
    if decision.allowed {
        return None;
    }
    let detail = decision
        .reason
        .unwrap_or_else(|| format!("{platform}: rate limited"));
    tracing::info!(platform, "rate governor: {detail}");
    Some(detail)
}

pub async fn run_automation_queue<D, F>(
    db: &SqlitePool,
    driver: D,
    stop: Arc<AtomicBool>,
    data_dir: PathBuf,
    mut emit: F,
) -> DomainResult<QueueRunSummary>
where
    D: BrowserDriver,
    F: FnMut(&str, Option<&str>, Option<&str>, Option<&str>, Option<&str>),
{
    emit("PreparingBrowser", None, None, None, None);
    let queued: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM automation_tasks WHERE task_type = 'apply_job' AND status = 'queued' ORDER BY priority DESC, created_at ASC",
    )
    .fetch_all(db)
    .await?;
    let mut summary = QueueRunSummary {
        was_empty: queued.is_empty(),
        ..Default::default()
    };
    let sup = BrowserSupervisor::with_stop_flag(db.clone(), driver, stop.clone(), data_dir);

    for task_id in &queued {
        if stop.load(Ordering::SeqCst) {
            emit("Stopped", None, None, None, None);
            summary.aborted += 1;
            return Ok(summary);
        }
        let (job_url, platform) = task_metadata(db, task_id).await;
        if let Some(detail) = rate_limited(db, platform.as_deref()).await {
            emit(
                "RetryScheduled",
                Some(task_id),
                job_url.as_deref(),
                Some(&detail),
                None,
            );
            summary.skipped += 1;
            continue;
        }

        let outcome = sup.run_task(task_id).await?;
        count_outcome(&mut summary, outcome);
        let (hr_name, hr_link) = review_contact(db, task_id, outcome).await;
        emit(
            outcome_state(outcome),
            Some(task_id),
            job_url.as_deref(),
            hr_name.as_deref(),
            hr_link.as_deref(),
        );
        if matches!(outcome, TaskOutcome::Aborted) {
            emit("Stopped", None, None, None, None);
            return Ok(summary);
        }
        if matches!(
            outcome,
            TaskOutcome::PausedForCaptcha | TaskOutcome::PausedForReview
        ) {
            return Ok(summary);
        }
    }
    if summary.was_empty {
        emit("Completed", None, None, None, None);
    }
    Ok(summary)
}
