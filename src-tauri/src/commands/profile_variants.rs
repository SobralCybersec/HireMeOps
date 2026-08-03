//! Profile-variant Tauri commands: IPC wrappers over `ProfileVariantService`
//! plus the per-site (LinkedIn/Catho/Gupy/InfoJobs) resume push/login flows.
//! Key: open_all_logins/check_all_logins — one shared Chromium window/jar covering every job site's login + status probe
//! Key: push_variant_to_linkedin/_catho/_gupy/_infojobs — build a variant's data into site-specific sections and fill them via Playwright
//! Key: the *_login commands (catho_login, gupy_login, infojobs_login) — open a headed session on the shared profile dir for one-time manual sign-in
//! Key: gupy_profile_from_variant — flattens a variant's experience/skills/LinkedIn into the Gupy fill payload

use tauri::State;

#[cfg(feature = "real-browser")]
use crate::domain::profile_sync::plan_from_variant;
use crate::domain::profile_sync::{build_sync_plan, ProfileSyncPlan, SyncSectionResult};
use crate::domain::profile_variants::{
    ProfileVariantDto, ProfileVariantService, ProfileVariantServiceImpl, UpdateVariantInput,
};
use crate::AppState;

fn service(state: &AppState) -> ProfileVariantServiceImpl {
    ProfileVariantServiceImpl::new(state.db.clone())
}

#[tauri::command]
pub async fn create_profile_variant(
    state: State<'_, AppState>,
    profile_id: String,
    rewrite_id: String,
    name: Option<String>,
) -> Result<ProfileVariantDto, String> {
    service(&state)
        .create_from_rewrite(&profile_id, &rewrite_id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_profile_variants(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<ProfileVariantDto>, String> {
    service(&state)
        .list(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_profile_variant(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProfileVariantDto, String> {
    service(&state).get(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_profile_variant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    service(&state).delete(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_profile_variant(
    state: State<'_, AppState>,
    id: String,
    input: UpdateVariantInput,
) -> Result<ProfileVariantDto, String> {
    service(&state)
        .update(&id, input)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoConnectResult {
    pub sent: u32,
    pub status: String,
}

#[cfg(feature = "real-browser")]
#[tauri::command]
pub async fn auto_connect_linkedin(
    state: State<'_, AppState>,
    max_count: Option<u32>,
    delay_ms: Option<u32>,
    channel: tauri::ipc::Channel<crate::browser::playwright::AutoConnectProgress>,
) -> Result<AutoConnectResult, String> {
    use crate::storage::paths::automation_profile_dir;
    let active_profile_id = crate::storage::settings::load(&state.db, &state.paths)
        .await
        .ok()
        .and_then(|s| s.active_profile_id)
        .unwrap_or_else(|| "default".to_string());
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &active_profile_id)
        .to_string_lossy()
        .into_owned();

    let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
    let headless = crate::storage::settings::read_automation_headless_for(
        &state.db,
        "linkedin_connect",
        global_headless,
    )
    .await;

    let (sent, status) = state
        .playwright
        .auto_connect(
            &user_data_dir,
            max_count.unwrap_or(200),
            delay_ms.unwrap_or(2_000),
            headless,
            Some(channel),
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(AutoConnectResult { sent, status })
}

#[cfg(not(feature = "real-browser"))]
#[tauri::command]
pub async fn auto_connect_linkedin(
    _state: State<'_, AppState>,
    _max_count: Option<u32>,
    _delay_ms: Option<u32>,
    /* stub build never emits progress; payload type just needs to exist without the browser module */
    _channel: tauri::ipc::Channel<serde_json::Value>,
) -> Result<AutoConnectResult, String> {
    Err("LinkedIn auto-connect requires the real-browser feature flag.".to_string())
}

#[tauri::command]
pub async fn build_profile_sync_plan(
    state: State<'_, AppState>,
    variant_id: String,
) -> Result<ProfileSyncPlan, String> {
    build_sync_plan(&service(&state), &variant_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(feature = "real-browser")]
#[tauri::command]
pub async fn push_variant_to_linkedin(
    state: State<'_, AppState>,
    variant_id: String,
    section_ids: Option<Vec<String>>,
) -> Result<Vec<SyncSectionResult>, String> {
    let variant = service(&state)
        .get(&variant_id)
        .await
        .map_err(|e| e.to_string())?;

    let plan = plan_from_variant(&variant);

    let sections: Vec<_> = match section_ids {
        None => plan.sections,
        Some(ids) => plan
            .sections
            .into_iter()
            .filter(|s| ids.contains(&s.id))
            .collect(),
    };

    use crate::storage::paths::automation_profile_dir;
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &variant.profile_id)
        .to_string_lossy()
        .into_owned();

    let global_headless = crate::storage::settings::read_automation_headless(&state.db).await;
    let headless = crate::storage::settings::read_automation_headless_for(
        &state.db,
        "linkedin_push",
        global_headless,
    )
    .await;

    state
        .playwright
        .push_profile_sections(&user_data_dir, &sections, headless)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(not(feature = "real-browser"))]
#[tauri::command]
pub async fn push_variant_to_linkedin(
    _state: State<'_, AppState>,
    _variant_id: String,
    _section_ids: Option<Vec<String>>,
) -> Result<Vec<SyncSectionResult>, String> {
    Err("LinkedIn auto-sync requires the real-browser feature flag.".to_string())
}

#[tauri::command]
pub async fn catho_login(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "catho".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .navigate(&handle, "https://www.catho.com.br/signin/")
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(feature = "real-browser")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CathoSection {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

#[cfg(feature = "real-browser")]
fn catho_sections_from_variant(
    variant: &crate::domain::profile_variants::ProfileVariantDto,
) -> Vec<CathoSection> {
    let text_section = |kind: &str, label: &str, text: String| CathoSection {
        kind: kind.into(),
        label: label.into(),
        text,
        metadata: None,
    };

    let mut sections = Vec::new();

    let target = variant.target_title.trim();
    if !target.is_empty() {
        sections.push(text_section(
            "objetivo",
            "Objetivo profissional",
            target.to_string(),
        ));
    }

    let summary = variant.summary.trim();
    if !summary.is_empty() {
        sections.push(text_section(
            "summary",
            "Resumo das qualificações",
            summary.to_string(),
        ));
    }

    for exp in &variant.experience {
        if exp.title.trim().is_empty() {
            continue;
        }
        let label = if exp.organization.trim().is_empty() {
            exp.title.clone()
        } else {
            format!("{} @ {}", exp.title.trim(), exp.organization.trim())
        };
        sections.push(CathoSection {
            kind: "experience".into(),
            label,
            text: String::new(),
            metadata: serde_json::to_string(exp).ok(),
        });
    }

    for edu in &variant.education {
        if edu.degree.trim().is_empty() {
            continue;
        }
        let label = if edu.institution.trim().is_empty() {
            edu.degree.clone()
        } else {
            format!("{} — {}", edu.degree.trim(), edu.institution.trim())
        };
        sections.push(CathoSection {
            kind: "education".into(),
            label,
            text: String::new(),
            metadata: serde_json::to_string(edu).ok(),
        });
    }

    if let Some(website) = variant.contact.website.as_deref().map(str::trim) {
        if !website.is_empty() {
            sections.push(text_section(
                "additional_info",
                "Informações adicionais",
                website.to_string(),
            ));
        }
    }

    sections
}

#[cfg(feature = "real-browser")]
#[tauri::command]
pub async fn push_variant_to_catho(
    state: State<'_, AppState>,
    variant_id: String,
    section_ids: Option<Vec<String>>,
) -> Result<Vec<SyncSectionResult>, String> {
    let variant = service(&state)
        .get(&variant_id)
        .await
        .map_err(|e| e.to_string())?;

    let sections: Vec<CathoSection> = catho_sections_from_variant(&variant)
        .into_iter()
        .filter(|s| section_ids.as_ref().is_none_or(|ids| ids.contains(&s.kind)))
        .collect();

    if sections.is_empty() {
        return Ok(Vec::new());
    }

    use crate::storage::paths::automation_profile_dir;
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &variant.profile_id)
        .to_string_lossy()
        .into_owned();

    let headless =
        crate::storage::settings::read_automation_headless_for(&state.db, "catho_fill", false)
            .await;
    state
        .playwright
        .push_catho_sections(&user_data_dir, &sections, headless)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(not(feature = "real-browser"))]
#[tauri::command]
pub async fn push_variant_to_catho(
    _state: State<'_, AppState>,
    _variant_id: String,
    _section_ids: Option<Vec<String>>,
) -> Result<Vec<SyncSectionResult>, String> {
    Err("Catho auto-sync requires the real-browser feature flag.".to_string())
}

#[cfg(feature = "real-browser")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GupyExperience {
    pub company: String,
    pub role: String,
    pub dates: String,
    pub bullets: Vec<String>,
}

#[cfg(feature = "real-browser")]
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GupyProfile {
    pub experiences: Vec<GupyExperience>,
    pub skills: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub linkedin_url: String,
}

#[cfg(feature = "real-browser")]
fn gupy_profile_from_variant(
    variant: &crate::domain::profile_variants::ProfileVariantDto,
) -> GupyProfile {
    let experiences = variant
        .experience
        .iter()
        .filter(|e| !e.title.trim().is_empty())
        .map(|e| GupyExperience {
            company: e.organization.trim().to_string(),
            role: e.title.trim().to_string(),
            dates: e.dates.trim().to_string(),
            bullets: e
                .bullets
                .iter()
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty())
                .collect(),
        })
        .collect();

    let mut seen = std::collections::HashSet::new();
    let mut skills = Vec::new();
    for group in &variant.skills {
        for s in group.skills.split([',', '\n', ';']) {
            let s = s.trim();
            if !s.is_empty() && seen.insert(s.to_lowercase()) {
                skills.push(s.to_string());
            }
        }
    }

    let linkedin_url = variant
        .contact
        .website
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .to_string();

    GupyProfile {
        experiences,
        skills,
        linkedin_url,
    }
}

#[cfg(feature = "real-browser")]
#[tauri::command]
pub async fn push_variant_to_gupy(
    state: State<'_, AppState>,
    variant_id: String,
) -> Result<Vec<SyncSectionResult>, String> {
    let variant = service(&state)
        .get(&variant_id)
        .await
        .map_err(|e| e.to_string())?;

    let profile = gupy_profile_from_variant(&variant);
    if profile.experiences.is_empty()
        && profile.skills.is_empty()
        && profile.linkedin_url.is_empty()
    {
        return Ok(Vec::new());
    }

    use crate::storage::paths::automation_profile_dir;
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &variant.profile_id)
        .to_string_lossy()
        .into_owned();

    let headless =
        crate::storage::settings::read_automation_headless_for(&state.db, "gupy_fill", false).await;
    state
        .playwright
        .push_gupy_profile(&user_data_dir, &profile, headless)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(not(feature = "real-browser"))]
#[tauri::command]
pub async fn push_variant_to_gupy(
    _state: State<'_, AppState>,
    _variant_id: String,
) -> Result<Vec<SyncSectionResult>, String> {
    Err("Gupy auto-fill requires the real-browser feature flag.".to_string())
}

#[tauri::command]
pub async fn gupy_login(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::SessionSpec;
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "gupy".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .gupy_start_login(&handle)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(feature = "real-browser")]
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfojobsEducation {
    pub degree: String,
    pub institution: String,
    pub dates: String,
}

#[cfg(feature = "real-browser")]
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfojobsProfile {
    pub first_name: String,
    pub surname: String,
    #[serde(rename = "abstract")]
    pub summary: String,
    pub phone_ddd: String,
    pub phone_number: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub linkedin_url: String,
    pub skills: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub experiences: Vec<GupyExperience>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub education: Vec<InfojobsEducation>,
}

#[cfg(feature = "real-browser")]
fn split_first_surname(full: &str) -> (String, String) {
    let mut it = full.split_whitespace();
    let first = it.next().unwrap_or("").to_string();
    let surname = it.collect::<Vec<_>>().join(" ");
    (first, surname)
}

#[cfg(feature = "real-browser")]
fn split_br_phone(raw: &str) -> (String, String) {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 10 {
        (digits[..2].to_string(), digits[2..].to_string())
    } else {
        (String::new(), digits)
    }
}

#[cfg(feature = "real-browser")]
fn infojobs_profile_from_variant(
    variant: &crate::domain::profile_variants::ProfileVariantDto,
) -> InfojobsProfile {
    let (first_name, surname) = split_first_surname(variant.contact.name.trim());
    let (phone_ddd, phone_number) = variant
        .contact
        .phone
        .as_deref()
        .map(split_br_phone)
        .unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    let mut skills = Vec::new();
    for group in &variant.skills {
        for s in group.skills.split([',', '\n', ';']) {
            let s = s.trim();
            if !s.is_empty() && seen.insert(s.to_lowercase()) {
                skills.push(s.to_string());
            }
        }
    }

    let experiences = variant
        .experience
        .iter()
        .filter(|e| !e.title.trim().is_empty())
        .map(|e| GupyExperience {
            company: e.organization.trim().to_string(),
            role: e.title.trim().to_string(),
            dates: e.dates.trim().to_string(),
            bullets: e
                .bullets
                .iter()
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty())
                .collect(),
        })
        .collect();

    let education = variant
        .education
        .iter()
        .filter(|e| !e.degree.trim().is_empty())
        .map(|e| InfojobsEducation {
            degree: e.degree.trim().to_string(),
            institution: e.institution.trim().to_string(),
            dates: e.dates.trim().to_string(),
        })
        .collect();

    InfojobsProfile {
        first_name,
        surname,
        summary: variant.summary.trim().to_string(),
        phone_ddd,
        phone_number,
        linkedin_url: variant
            .contact
            .website
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .to_string(),
        skills,
        experiences,
        education,
    }
}

#[cfg(feature = "real-browser")]
#[tauri::command]
pub async fn push_variant_to_infojobs(
    state: State<'_, AppState>,
    variant_id: String,
) -> Result<Vec<SyncSectionResult>, String> {
    let variant = service(&state)
        .get(&variant_id)
        .await
        .map_err(|e| e.to_string())?;

    let profile = infojobs_profile_from_variant(&variant);
    if profile.first_name.is_empty() && profile.summary.is_empty() && profile.skills.is_empty() {
        return Ok(Vec::new());
    }

    use crate::storage::paths::automation_profile_dir;
    let user_data_dir = automation_profile_dir(&state.paths.data_dir, &variant.profile_id)
        .to_string_lossy()
        .into_owned();

    let headless =
        crate::storage::settings::read_automation_headless_for(&state.db, "infojobs_fill", false)
            .await;
    state
        .playwright
        .push_infojobs_profile(&user_data_dir, &profile, headless)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(not(feature = "real-browser"))]
#[tauri::command]
pub async fn push_variant_to_infojobs(
    _state: State<'_, AppState>,
    _variant_id: String,
) -> Result<Vec<SyncSectionResult>, String> {
    Err("InfoJobs auto-fill requires the real-browser feature flag.".to_string())
}

#[tauri::command]
pub async fn infojobs_login(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "infojobs".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .navigate(
                &handle,
                "https://www.infojobs.com.br/candidate/cv/insert2.aspx",
            )
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn open_all_logins(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::SessionSpec;
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "logins".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .open_login_tabs(
                &handle,
                &["linkedin", "catho", "infojobs", "indeed", "gupy"],
            )
            .await
            .map_err(|e| e.to_string())?;

        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::ai::browser_bridge::manual_login("chatgpt").await {
                tracing::warn!("ChatGPT bridge login (from Universal Login) failed: {e:#}");
            }
        });

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn check_all_logins(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let status = state
            .playwright
            .check_logins(&dir)
            .await
            .map_err(|e| e.to_string())?;
        Ok(serde_json::Value::Object(status))
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[tauri::command]
pub async fn open_gmail(state: State<'_, AppState>, profile_id: String) -> Result<(), String> {
    #[cfg(feature = "real-browser")]
    {
        use crate::domain::automation::{BrowserDriver, SessionSpec};
        use crate::storage::paths::automation_profile_dir;

        let dir = automation_profile_dir(&state.paths.data_dir, &profile_id)
            .to_string_lossy()
            .into_owned();

        let handle = state
            .playwright
            .open_login_session(&SessionSpec {
                profile_id,
                platform: "gmail".into(),
                user_data_dir: dir,
                extensions: vec![],
                headless: false,
            })
            .await
            .map_err(|e| e.to_string())?;

        state
            .playwright
            .navigate(&handle, "https://mail.google.com/mail/u/0/#inbox")
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(feature = "real-browser"))]
    {
        let _ = (state, profile_id);
        Err("real-browser feature not enabled".to_string())
    }
}

#[cfg(all(test, feature = "real-browser"))]
mod catho_section_tests {
    use super::*;
    use crate::ai::prompt::{CvEducationEntry, CvExperienceEntry};
    use crate::domain::profile_variants::{ContactInfo, ProfileVariantDto};

    fn variant() -> ProfileVariantDto {
        ProfileVariantDto {
            id: "v1".into(),
            profile_id: "p1".into(),
            name: "Base".into(),
            target_title: String::new(),
            headline: String::new(),
            summary: String::new(),
            about_text: String::new(),
            keywords: vec![],
            positions: vec![],
            skills: vec![],
            experience: vec![],
            education: vec![],
            contact: ContactInfo::default(),
            source_cv_document_id: None,
            source_rewrite_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn kinds(sections: &[CathoSection]) -> Vec<&str> {
        sections.iter().map(|s| s.kind.as_str()).collect()
    }

    #[test]
    fn empty_variant_yields_no_sections() {
        assert!(catho_sections_from_variant(&variant()).is_empty());
    }

    #[test]
    fn emits_text_sections_only_when_populated() {
        let mut v = variant();
        v.target_title = "Engenheiro de Software".into();
        v.summary = "Backend dev.".into();
        v.contact.website = Some("https://github.com/x".into());

        let s = catho_sections_from_variant(&v);
        assert_eq!(kinds(&s), vec!["objetivo", "summary", "additional_info"]);
        let obj = &s[0];
        assert_eq!(obj.text, "Engenheiro de Software");
        assert!(obj.metadata.is_none());
    }

    #[test]
    fn whitespace_and_blank_website_are_skipped() {
        let mut v = variant();
        v.target_title = "   ".into();
        v.summary = "\n\t".into();
        v.contact.website = Some("   ".into());
        assert!(catho_sections_from_variant(&v).is_empty());
    }

    #[test]
    fn one_section_per_experience_with_json_metadata() {
        let mut v = variant();
        v.experience = vec![
            CvExperienceEntry {
                title: "Engenheiro".into(),
                organization: "Acme".into(),
                dates: "12/2023 - Atual".into(),
                bullets: vec!["Fez X".into()],
                ..Default::default()
            },
            CvExperienceEntry {
                title: "Instrutor".into(),
                organization: String::new(),
                ..Default::default()
            },
            CvExperienceEntry::default(),
        ];

        let s = catho_sections_from_variant(&v);
        assert_eq!(kinds(&s), vec!["experience", "experience"]);
        assert_eq!(s[0].label, "Engenheiro @ Acme");
        assert_eq!(s[1].label, "Instrutor");

        let meta: CvExperienceEntry =
            serde_json::from_str(s[0].metadata.as_deref().unwrap()).unwrap();
        assert_eq!(meta.title, "Engenheiro");
        assert_eq!(meta.dates, "12/2023 - Atual");
    }

    #[test]
    fn education_labels_and_blank_degree_skip() {
        let mut v = variant();
        v.education = vec![
            CvEducationEntry {
                degree: "Graduação".into(),
                institution: "UNESA".into(),
                ..Default::default()
            },
            CvEducationEntry {
                degree: "Ensino Médio".into(),
                institution: String::new(),
                ..Default::default()
            },
            CvEducationEntry::default(),
        ];

        let s = catho_sections_from_variant(&v);
        assert_eq!(kinds(&s), vec!["education", "education"]);
        assert_eq!(s[0].label, "Graduação — UNESA");
        assert_eq!(s[1].label, "Ensino Médio");
    }

    #[test]
    fn full_variant_orders_sections_deterministically() {
        let mut v = variant();
        v.target_title = "Dev".into();
        v.summary = "S".into();
        v.experience = vec![CvExperienceEntry {
            title: "Eng".into(),
            ..Default::default()
        }];
        v.education = vec![CvEducationEntry {
            degree: "Graduação".into(),
            ..Default::default()
        }];
        v.contact.website = Some("https://x".into());

        assert_eq!(
            kinds(&catho_sections_from_variant(&v)),
            vec![
                "objetivo",
                "summary",
                "experience",
                "education",
                "additional_info"
            ],
        );
    }
}

#[cfg(all(test, feature = "real-browser"))]
mod gupy_profile_tests {
    use super::*;
    use crate::ai::prompt::{CvExperienceEntry, CvSkillGroup};
    use crate::domain::profile_variants::{ContactInfo, ProfileVariantDto};

    fn variant() -> ProfileVariantDto {
        ProfileVariantDto {
            id: "v1".into(),
            profile_id: "p1".into(),
            name: "Base".into(),
            target_title: String::new(),
            headline: String::new(),
            summary: String::new(),
            about_text: String::new(),
            keywords: vec![],
            positions: vec![],
            skills: vec![],
            experience: vec![],
            education: vec![],
            contact: ContactInfo::default(),
            source_cv_document_id: None,
            source_rewrite_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn flattens_and_dedups_skills_case_insensitively() {
        let mut v = variant();
        v.skills = vec![
            CvSkillGroup {
                category: "Back".into(),
                skills: "Java, Spring Boot; Redis".into(),
            },
            CvSkillGroup {
                category: "More".into(),
                skills: "redis\nDocker".into(),
            },
        ];
        let p = gupy_profile_from_variant(&v);
        assert_eq!(p.skills, vec!["Java", "Spring Boot", "Redis", "Docker"]);
    }

    #[test]
    fn maps_experiences_and_skips_titleless() {
        let mut v = variant();
        v.experience = vec![
            CvExperienceEntry {
                title: "Dev".into(),
                organization: "ACME".into(),
                dates: "2023 - Present".into(),
                bullets: vec!["Built X".into(), "  ".into()],
                ..Default::default()
            },
            CvExperienceEntry {
                title: "  ".into(),
                ..Default::default()
            },
        ];
        let p = gupy_profile_from_variant(&v);
        assert_eq!(p.experiences.len(), 1);
        assert_eq!(p.experiences[0].role, "Dev");
        assert_eq!(p.experiences[0].company, "ACME");
        assert_eq!(p.experiences[0].bullets, vec!["Built X"]);
    }

    #[test]
    fn linkedin_from_contact_website() {
        let mut v = variant();
        v.contact.website = Some("https://linkedin.com/in/x".into());
        assert_eq!(
            gupy_profile_from_variant(&v).linkedin_url,
            "https://linkedin.com/in/x"
        );
    }
}

#[cfg(all(test, feature = "real-browser"))]
mod infojobs_profile_tests {
    use super::*;
    use crate::ai::prompt::CvSkillGroup;
    use crate::domain::profile_variants::{ContactInfo, ProfileVariantDto};

    fn variant() -> ProfileVariantDto {
        ProfileVariantDto {
            id: "v1".into(),
            profile_id: "p1".into(),
            name: "Base".into(),
            target_title: String::new(),
            headline: String::new(),
            summary: String::new(),
            about_text: String::new(),
            keywords: vec![],
            positions: vec![],
            skills: vec![],
            experience: vec![],
            education: vec![],
            contact: ContactInfo::default(),
            source_cv_document_id: None,
            source_rewrite_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn splits_name_into_first_and_surname() {
        assert_eq!(
            split_first_surname("Matheus Sobral da Silva"),
            ("Matheus".to_string(), "Sobral da Silva".to_string())
        );
        assert_eq!(
            split_first_surname("Madonna"),
            ("Madonna".to_string(), String::new())
        );
    }

    #[test]
    fn parses_br_phone_into_ddd_and_number() {
        assert_eq!(
            split_br_phone("(21) 97290-8975"),
            ("21".to_string(), "972908975".to_string())
        );
        assert_eq!(
            split_br_phone("21972908975"),
            ("21".to_string(), "972908975".to_string())
        );
        assert_eq!(
            split_br_phone("12345"),
            (String::new(), "12345".to_string())
        );
    }

    #[test]
    fn maps_variant_summary_linkedin_and_skills() {
        let mut v = variant();
        v.contact.name = "Ana Paula Souza".into();
        v.contact.phone = Some("(11) 3333-4444".into());
        v.contact.website = Some("https://linkedin.com/in/ana".into());
        v.summary = "  Backend dev  ".into();
        v.skills = vec![CvSkillGroup {
            category: "x".into(),
            skills: "Java, java; Spring".into(),
        }];

        let p = infojobs_profile_from_variant(&v);
        assert_eq!(p.first_name, "Ana");
        assert_eq!(p.surname, "Paula Souza");
        assert_eq!(p.summary, "Backend dev");
        assert_eq!(p.linkedin_url, "https://linkedin.com/in/ana");
        assert_eq!(p.skills, vec!["Java", "Spring"]);
    }
}
