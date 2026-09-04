use super::*;

#[tauri::command]
pub async fn catho_apply(
    state: State<'_, AppState>,
    profile_id: String,
    offer_id: String,
    apply_url: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let headless =
            crate::storage::settings::read_automation_headless_for(&state.db, "catho_apply", false)
                .await;
        state
            .playwright
            .catho_apply(&dir, &offer_id, &apply_url, headless)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, offer_id, apply_url);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn infojobs_apply(
    state: State<'_, AppState>,
    profile_id: String,
    offer_id: String,
    apply_url: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;
        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "infojobs_apply",
            false,
        )
        .await;

        // Phase 1: apply. If InfoJobs blocks on a killer-questions form, the worker returns the
        // questions instead of submitting.
        let first = state
            .playwright
            .infojobs_apply(&dir, &offer_id, &apply_url, None, headless)
            .await
            .map_err(|e| e.to_string())?;

        if first.get("status").and_then(serde_json::Value::as_str) != Some("needs_answers") {
            return Ok(first);
        }
        let questions = match first.get("questions").and_then(|v| v.as_array()) {
            Some(q) if !q.is_empty() => q.clone(),
            _ => return Ok(first),
        };

        // Reuse the SAME AI form-answering the LinkedIn Easy Apply flow uses: draft answers from
        // the CV/profile, then refill + submit. If the AI can't answer, return the questions so
        // the (visible) window stays parked for a human.
        match crate::domain::automation::generate_form_answers(&state.db, &profile_id, &questions)
            .await
        {
            Ok((answers, _needs_human)) if !answers.is_empty() => {
                let answers = serde_json::Value::Object(answers);
                state
                    .playwright
                    .infojobs_apply(&dir, &offer_id, &apply_url, Some(&answers), headless)
                    .await
                    .map_err(|e| e.to_string())
            }
            _ => Ok(first),
        }
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, offer_id, apply_url);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn gmail_send_application(
    state: State<'_, AppState>,
    profile_id: String,
    to: String,
    subject: String,
    body: String,
    cv_document_id: Option<String>,
) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let cv_path: Option<String> = if let Some(ref doc_id) = cv_document_id {
            sqlx::query_scalar("SELECT stored_path FROM cv_documents WHERE id = ?1")
                .bind(doc_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| e.to_string())?
        } else {
            None
        };

        let profile_dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
        let headless = crate::storage::settings::read_automation_headless_for(
            &state.db,
            "gmail_send",
            global_headless,
        )
        .await;

        let handle = state
            .playwright
            .open(&SessionSpec {
                profile_id: profile_id.clone(),
                platform: "gmail".into(),
                user_data_dir: profile_dir,
                extensions: vec![],
                headless,
            })
            .await
            .map_err(|e| e.to_string())?;

        let outcome: Result<(), String> = async {
            state
                .playwright
                .gmail_send(&handle, &to, &subject, &body, cv_path.as_deref())
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        .await;

        state.playwright.close_session(&handle).await;
        outcome
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id, to, subject, body, cv_document_id);
        Err("real-browser feature not enabled".to_string())
    }
}
