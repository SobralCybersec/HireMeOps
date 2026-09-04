use super::*;

impl<D: BrowserDriver> BrowserSupervisor<D> {
    #[tracing::instrument(
        target = "hiremeops::automation",
        skip(self, input, handle),
        fields(url = %input.url, platform = %input.platform)
    )]
    pub(super) async fn drive(
        &self,
        task_id: &str,
        input: &EasyApplyInput,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        self.driver.navigate(handle, &input.url).await?;
        if self.stop.load(Ordering::SeqCst) {
            self.abort(session_id, task_id, handle).await?;
            return Ok(TaskOutcome::Aborted);
        }
        match self.driver.probe(handle).await? {
            PageState::CaptchaWall => self.handle_captcha(task_id, session_id, handle).await,
            PageState::ApplyForm => self.handle_apply(task_id, input, session_id, handle).await,
            PageState::NoAction => self.complete_no_action(task_id, session_id, handle).await,
            PageState::DailyLimitReached => {
                self.fail_daily_limit(task_id, session_id, handle).await
            }
        }
    }

    async fn handle_captcha(
        &self,
        task_id: &str,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        let shot = self.driver.screenshot(handle).await?;
        self.record_evidence(task_id, EvidenceKind::Screenshot, Some(&shot), None)
            .await?;
        let dom = self.driver.dom_snapshot(handle).await?;
        self.record_evidence(task_id, EvidenceKind::DomSnapshot, None, Some(&dom))
            .await?;

        let now = now_iso();
        sqlx::query(
            "UPDATE browser_sessions SET status = 'paused_captcha', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "UPDATE automation_tasks SET status = 'paused_captcha', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await?;
        self.update_application_outcome(task_id, session_id, "paused_for_captcha", "needs_review")
            .await?;

        self.set_status(AutomationStatus::PausedForCaptcha);
        Ok(TaskOutcome::PausedForCaptcha)
    }

    async fn handle_apply(
        &self,
        task_id: &str,
        input: &EasyApplyInput,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        let enriched = self
            .enrich_apply_input(task_id, input, session_id, handle)
            .await;
        let unanswered = self
            .driver
            .fill_easy_apply_collect(handle, &enriched)
            .await?;
        let needs_human = self.answer_unanswered(task_id, handle, &unanswered).await;
        if needs_human > 0 {
            tracing::info!(
                task_id,
                needs_human,
                "Easy Apply: questions still need the human"
            );
        }
        if self.stop.load(Ordering::SeqCst) {
            self.abort(session_id, task_id, handle).await?;
            return Ok(TaskOutcome::Aborted);
        }

        self.record_apply_evidence(task_id, handle, input).await?;
        if self
            .try_submit(task_id, session_id, handle, &enriched)
            .await?
        {
            return Ok(TaskOutcome::Completed);
        }
        self.park_for_review(task_id, session_id, &enriched).await
    }

    async fn enrich_apply_input(
        &self,
        task_id: &str,
        input: &EasyApplyInput,
        session_id: &str,
        handle: &str,
    ) -> EasyApplyInput {
        let (hr_name, hr_link) = self.extract_hiring_manager(task_id, handle).await;
        let cover_letter = input.cover_letter.as_deref().map(|template| {
            let mut text = template.to_owned();
            if let Some(name) = &hr_name {
                text = text.replace("{{hr_name}}", name);
            }
            if let Some(link) = &hr_link {
                text = text.replace("{{hr_link}}", link);
            }
            text
        });
        EasyApplyInput {
            hr_name,
            hr_link,
            cover_letter,
            task_id: Some(task_id.to_owned()),
            session_id: Some(session_id.to_owned()),
            ..input.clone()
        }
    }

    async fn extract_hiring_manager(
        &self,
        task_id: &str,
        handle: &str,
    ) -> (Option<String>, Option<String>) {
        let raw = self.driver.extract_hr(handle).await.unwrap_or(None);
        let Some(json) = raw else { return (None, None) };
        let value: serde_json::Value = serde_json::from_str(&json).unwrap_or_default();
        let name = value
            .get("name")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let link = value
            .get("profile_url")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        if let Some(name) = &name {
            tracing::info!(
                task_id,
                name = name.as_str(),
                "extract_hr: found hiring manager"
            );
        }
        (name, link)
    }

    async fn answer_unanswered(
        &self,
        task_id: &str,
        handle: &str,
        unanswered: &[serde_json::Value],
    ) -> usize {
        if unanswered.is_empty() {
            return 0;
        }
        let profile_id = sqlx::query_scalar::<_, String>(
            "SELECT profile_id FROM automation_tasks WHERE id = ?1",
        )
        .bind(task_id)
        .fetch_optional(&self.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
        let Ok((answers, mut needs_human)) =
            generate_form_answers(&self.db, &profile_id, unanswered).await
        else {
            tracing::warn!("Easy Apply answer generation failed; parking for review");
            return unanswered.len();
        };
        if answers.is_empty() {
            return needs_human + unanswered.len();
        }
        let payload = serde_json::json!({ "questions": serde_json::Value::Object(answers) });
        match self.driver.answer_easy_apply(handle, &payload).await {
            Ok(leftover) => {
                needs_human += leftover.len();
                if !leftover.is_empty() {
                    let labels: Vec<&str> = leftover
                        .iter()
                        .filter_map(|question| {
                            question.get("label").and_then(|value| value.as_str())
                        })
                        .collect();
                    tracing::info!(
                        task_id,
                        ?labels,
                        "Easy Apply: still unanswered after AI refill"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "Easy Apply AI refill failed");
                needs_human += unanswered.len();
            }
        }
        needs_human
    }

    async fn record_apply_evidence(
        &self,
        task_id: &str,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<()> {
        let form = serde_json::to_string(&input.answers).unwrap_or_else(|_| "[]".into());
        self.record_evidence(task_id, EvidenceKind::FormState, None, Some(&form))
            .await?;
        let shot = self.driver.screenshot(handle).await?;
        self.record_evidence(task_id, EvidenceKind::Screenshot, Some(&shot), None)
            .await
    }

    async fn try_submit(
        &self,
        task_id: &str,
        session_id: &str,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<bool> {
        match self.driver.confirm_submit(handle).await {
            Ok(true) => {
                self.mark_submitted(task_id, session_id, handle, input)
                    .await?;
                tracing::info!(task_id, "Easy Apply auto-submitted");
                Ok(true)
            }
            Ok(false) => {
                tracing::warn!(
                    task_id,
                    "auto-submit bounced (required field blank) — parking for review"
                );
                Ok(false)
            }
            Err(error) => {
                tracing::warn!(task_id, error = %error, "auto-submit failed — parking for review");
                Ok(false)
            }
        }
    }

    async fn mark_submitted(
        &self,
        task_id: &str,
        session_id: &str,
        handle: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<()> {
        let now = now_iso();
        if let Ok(after) = self.driver.screenshot(handle).await {
            self.record_evidence(task_id, EvidenceKind::Screenshot, Some(&after), None)
                .await?;
        }
        self.driver.close(handle).await.ok();
        sqlx::query(
            "UPDATE browser_sessions SET status = 'closed', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await?;
        self.update_application_outcome(task_id, session_id, "submitted", "applied")
            .await?;
        sqlx::query(
            "UPDATE automation_tasks SET status = 'completed', finished_at = ?1, hr_name = ?3, hr_link = ?4, result_json = '{\"outcome\":\"submitted\"}', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .bind(input.hr_name.as_deref())
        .bind(input.hr_link.as_deref())
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn park_for_review(
        &self,
        task_id: &str,
        session_id: &str,
        input: &EasyApplyInput,
    ) -> DomainResult<TaskOutcome> {
        let now = now_iso();
        sqlx::query(
            "UPDATE browser_sessions SET status = 'paused_review', updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await?;
        self.update_application_outcome(task_id, session_id, "needs_review", "needs_review")
            .await?;
        sqlx::query(
            "UPDATE automation_tasks SET status = 'pending_review', hr_name = ?3, hr_link = ?4, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .bind(input.hr_name.as_deref())
        .bind(input.hr_link.as_deref())
        .execute(&self.db)
        .await?;
        self.set_status(AutomationStatus::PausedForReview);
        Ok(TaskOutcome::PausedForReview)
    }

    async fn complete_no_action(
        &self,
        task_id: &str,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        let dom = self.driver.dom_snapshot(handle).await?;
        self.record_evidence(task_id, EvidenceKind::DomSnapshot, None, Some(&dom))
            .await?;
        self.driver.close(handle).await?;

        let now = now_iso();
        sqlx::query(
                    "UPDATE browser_sessions SET status = 'closed', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
                )
                .bind(&now)
                .bind(session_id)
                .execute(&self.db)
                .await?;
        sqlx::query(
            "UPDATE automation_tasks
                     SET status = 'completed', finished_at = ?1,
                         result_json = '{\"outcome\":\"completed\"}', updated_at = ?1
                     WHERE id = ?2",
        )
        .bind(&now)
        .bind(task_id)
        .execute(&self.db)
        .await?;

        self.set_status(AutomationStatus::Idle);
        Ok(TaskOutcome::Completed)
    }

    async fn fail_daily_limit(
        &self,
        task_id: &str,
        session_id: &str,
        handle: &str,
    ) -> DomainResult<TaskOutcome> {
        self.driver.close(handle).await?;
        let now = now_iso();
        let msg = "LinkedIn daily Easy Apply limit reached — stopping run";
        sqlx::query(
            "UPDATE browser_sessions
                     SET status = 'failed', ended_at = ?1, updated_at = ?1
                     WHERE id = ?2",
        )
        .bind(&now)
        .bind(session_id)
        .execute(&self.db)
        .await?;
        sqlx::query(
            "UPDATE automation_tasks
                     SET status = 'failed', finished_at = ?1,
                         result_json = ?2, updated_at = ?1
                     WHERE id = ?3",
        )
        .bind(&now)
        .bind(format!(
            "{{\"outcome\":\"daily_limit_reached\",\"reason\":\"{msg}\"}}"
        ))
        .bind(task_id)
        .execute(&self.db)
        .await?;
        self.set_status(AutomationStatus::Idle);
        Err(DomainError::Message(msg.to_string()))
    }
}
