//! Profile variants built from an extracted/rewritten CV: role-targeted snapshots the UI renders and the LinkedIn sync assistant reads.
//! Key: ProfileVariantService — trait: create_from_rewrite, list, get, update, delete
//! Key: ProfileVariantServiceImpl::create_from_rewrite — pure transform over a cv_rewrites row, then persists
//! Key: ProfileVariantDto — full view-model, camelCase for the TS frontend
//! Key: build_headline / build_about — deterministic headline/About draft generation (no AI call)

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::ai::prompt::{CvEducationEntry, CvExperienceEntry, CvMetadata, CvRewrite, CvSkillGroup};
use crate::domain::{DomainError, DomainResult};
use crate::util::now_iso;

const HEADLINE_MAX: usize = 220;
const ABOUT_MAX: usize = 2600;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContactInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub website: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileVariantDto {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub target_title: String,
    pub headline: String,
    pub summary: String,
    pub about_text: String,
    pub keywords: Vec<String>,
    pub positions: Vec<String>,
    pub skills: Vec<CvSkillGroup>,
    pub experience: Vec<CvExperienceEntry>,
    pub education: Vec<CvEducationEntry>,
    pub contact: ContactInfo,
    pub source_cv_document_id: Option<String>,
    pub source_rewrite_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut = max.saturating_sub(1);
    let mut out: String = s.chars().take(cut).collect();
    out.push('…');
    out
}

fn build_headline(positions: &[String], fallback: &str) -> String {
    let joined = positions
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");
    let headline = if joined.is_empty() {
        fallback.trim()
    } else {
        &joined
    };
    truncate_chars(headline, HEADLINE_MAX)
}

fn split_keywords(raw: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for kw in raw.split([',', ';', '\n']) {
        let kw = kw.trim();
        if kw.is_empty() {
            continue;
        }
        if !seen.iter().any(|k| k.eq_ignore_ascii_case(kw)) {
            seen.push(kw.to_string());
        }
    }
    seen
}

fn build_about(summary: &str, skills: &[CvSkillGroup]) -> String {
    let mut out = summary.trim().to_string();
    let skill_line = skills
        .iter()
        .filter(|g| !g.skills.trim().is_empty())
        .map(|g| g.skills.trim())
        .collect::<Vec<_>>()
        .join(" · ");
    if !skill_line.is_empty() {
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str("Core skills: ");
        out.push_str(&skill_line);
    }
    truncate_chars(&out, ABOUT_MAX)
}

#[derive(sqlx::FromRow)]
struct VariantRow {
    id: String,
    profile_id: String,
    name: String,
    target_title: String,
    summary: Option<String>,
    headline: Option<String>,
    keywords_json: Option<String>,
    positions_json: Option<String>,
    skills_json: Option<String>,
    experience_json: Option<String>,
    education_json: Option<String>,
    contact_json: Option<String>,
    about_text: Option<String>,
    source_cv_document_id: Option<String>,
    source_rewrite_id: Option<String>,
    created_at: String,
    updated_at: String,
}

const SELECT_BY_PROFILE: &str = "SELECT id, profile_id, name, target_title, summary, headline, \
    keywords_json, positions_json, skills_json, experience_json, education_json, \
    contact_json, about_text, source_cv_document_id, source_rewrite_id, \
    created_at, updated_at \
    FROM profile_variants WHERE profile_id = ?1 ORDER BY created_at DESC";

const SELECT_BY_ID: &str = "SELECT id, profile_id, name, target_title, summary, headline, \
    keywords_json, positions_json, skills_json, experience_json, education_json, \
    contact_json, about_text, source_cv_document_id, source_rewrite_id, \
    created_at, updated_at \
    FROM profile_variants WHERE id = ?1";

fn decode_vec<T: for<'de> Deserialize<'de>>(s: &Option<String>) -> Vec<T> {
    s.as_deref()
        .and_then(|raw| serde_json::from_str::<Vec<T>>(raw).ok())
        .unwrap_or_default()
}

fn row_to_dto(r: VariantRow) -> ProfileVariantDto {
    let contact = r
        .contact_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<ContactInfo>(raw).ok())
        .unwrap_or_default();
    ProfileVariantDto {
        id: r.id,
        profile_id: r.profile_id,
        name: r.name,
        target_title: r.target_title,
        summary: r.summary.unwrap_or_default(),
        headline: r.headline.unwrap_or_default(),
        keywords: decode_vec(&r.keywords_json),
        positions: decode_vec(&r.positions_json),
        skills: decode_vec(&r.skills_json),
        experience: decode_vec(&r.experience_json),
        education: decode_vec(&r.education_json),
        contact,
        about_text: r.about_text.unwrap_or_default(),
        source_cv_document_id: r.source_cv_document_id,
        source_rewrite_id: r.source_rewrite_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVariantInput {
    pub name: Option<String>,
    pub headline: Option<String>,
    pub summary: Option<String>,
    pub about_text: Option<String>,
    pub keywords: Option<String>,
}

pub trait ProfileVariantService: Send + Sync {
    async fn create_from_rewrite(
        &self,
        profile_id: &str,
        rewrite_id: &str,
        name: Option<String>,
    ) -> DomainResult<ProfileVariantDto>;

    async fn list(&self, profile_id: &str) -> DomainResult<Vec<ProfileVariantDto>>;

    async fn get(&self, id: &str) -> DomainResult<ProfileVariantDto>;

    async fn update(&self, id: &str, input: UpdateVariantInput) -> DomainResult<ProfileVariantDto>;

    async fn delete(&self, id: &str) -> DomainResult<()>;
}

pub struct ProfileVariantServiceImpl {
    db: SqlitePool,
}

impl ProfileVariantServiceImpl {
    pub fn new(db: SqlitePool) -> Self {
        Self { db }
    }
}

impl ProfileVariantService for ProfileVariantServiceImpl {
    async fn create_from_rewrite(
        &self,
        profile_id: &str,
        rewrite_id: &str,
        name: Option<String>,
    ) -> DomainResult<ProfileVariantDto> {
        let row: Option<(String, Option<String>, String, String)> = sqlx::query_as(
            "SELECT profile_id, cv_document_id, rewrite_json, metadata_json
             FROM cv_rewrites WHERE id = ?1",
        )
        .bind(rewrite_id)
        .fetch_optional(&self.db)
        .await?;
        let (row_profile, cv_document_id, rewrite_json, metadata_json) = row.ok_or_else(|| {
            DomainError::InvalidInput(format!("unknown cv_rewrite: {rewrite_id}"))
        })?;
        if row_profile != profile_id {
            return Err(DomainError::InvalidInput(format!(
                "cv_rewrite {rewrite_id} belongs to a different profile"
            )));
        }

        let rewrite: CvRewrite = serde_json::from_str(&rewrite_json)
            .map_err(|e| DomainError::InvalidInput(format!("corrupt rewrite_json: {e}")))?;
        let metadata: CvMetadata = serde_json::from_str(&metadata_json).unwrap_or_default();

        let profile_location: Option<String> =
            sqlx::query_scalar("SELECT location FROM profiles WHERE id = ?1")
                .bind(profile_id)
                .fetch_optional(&self.db)
                .await?
                .flatten();
        let location = profile_location
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                rewrite
                    .experience
                    .iter()
                    .map(|e| e.location.trim())
                    .find(|l| !l.is_empty())
                    .map(str::to_string)
            })
            .unwrap_or_default();

        let target_title = rewrite.positions.first().cloned().unwrap_or_default();
        let headline = build_headline(&rewrite.positions, &target_title);
        let about_text = build_about(&rewrite.summary, &rewrite.skills);
        let keywords = split_keywords(&metadata.keywords);
        let variant_name = name
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| {
                if target_title.trim().is_empty() {
                    "CV Variant".to_string()
                } else {
                    target_title.clone()
                }
            });
        let contact = ContactInfo {
            name: rewrite.name.clone(),
            location,
            ..Default::default()
        };

        let id = Uuid::new_v4().to_string();
        let now = now_iso();
        let positions_json =
            serde_json::to_string(&rewrite.positions).unwrap_or_else(|_| "[]".into());
        let skills_json = serde_json::to_string(&rewrite.skills).unwrap_or_else(|_| "[]".into());
        let experience_json =
            serde_json::to_string(&rewrite.experience).unwrap_or_else(|_| "[]".into());
        let education_json =
            serde_json::to_string(&rewrite.education).unwrap_or_else(|_| "[]".into());
        let keywords_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".into());
        let contact_json = serde_json::to_string(&contact).unwrap_or_else(|_| "{}".into());

        sqlx::query(
            "INSERT INTO profile_variants (
                id, profile_id, name, target_title, summary, headline,
                keywords_json, preferred_cv_document_id, positions_json, skills_json,
                experience_json, education_json, contact_json, about_text,
                source_cv_document_id, source_rewrite_id, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(&variant_name)
        .bind(&target_title)
        .bind(&rewrite.summary)
        .bind(&headline)
        .bind(&keywords_json)
        .bind(&cv_document_id)
        .bind(&positions_json)
        .bind(&skills_json)
        .bind(&experience_json)
        .bind(&education_json)
        .bind(&contact_json)
        .bind(&about_text)
        .bind(&cv_document_id)
        .bind(rewrite_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.db)
        .await?;

        self.get(&id).await
    }

    async fn list(&self, profile_id: &str) -> DomainResult<Vec<ProfileVariantDto>> {
        let rows: Vec<VariantRow> = sqlx::query_as(SELECT_BY_PROFILE)
            .bind(profile_id)
            .fetch_all(&self.db)
            .await?;
        Ok(rows.into_iter().map(row_to_dto).collect())
    }

    async fn get(&self, id: &str) -> DomainResult<ProfileVariantDto> {
        let row: Option<VariantRow> = sqlx::query_as(SELECT_BY_ID)
            .bind(id)
            .fetch_optional(&self.db)
            .await?;
        row.map(row_to_dto)
            .ok_or_else(|| DomainError::InvalidInput(format!("unknown profile_variant: {id}")))
    }

    async fn update(&self, id: &str, input: UpdateVariantInput) -> DomainResult<ProfileVariantDto> {
        let now = now_iso();
        if let Some(v) = &input.name {
            sqlx::query("UPDATE profile_variants SET name = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(v.trim())
                .bind(&now)
                .bind(id)
                .execute(&self.db)
                .await?;
        }
        if let Some(v) = &input.headline {
            sqlx::query("UPDATE profile_variants SET headline = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(v.trim())
                .bind(&now)
                .bind(id)
                .execute(&self.db)
                .await?;
        }
        if let Some(v) = &input.summary {
            sqlx::query("UPDATE profile_variants SET summary = ?1, updated_at = ?2 WHERE id = ?3")
                .bind(v.trim())
                .bind(&now)
                .bind(id)
                .execute(&self.db)
                .await?;
        }
        if let Some(v) = &input.about_text {
            sqlx::query(
                "UPDATE profile_variants SET about_text = ?1, updated_at = ?2 WHERE id = ?3",
            )
            .bind(v.trim())
            .bind(&now)
            .bind(id)
            .execute(&self.db)
            .await?;
        }
        if let Some(v) = &input.keywords {
            let kws = split_keywords(v);
            let json = serde_json::to_string(&kws).unwrap_or_else(|_| "[]".into());
            sqlx::query(
                "UPDATE profile_variants SET keywords_json = ?1, updated_at = ?2 WHERE id = ?3",
            )
            .bind(&json)
            .bind(&now)
            .bind(id)
            .execute(&self.db)
            .await?;
        }
        self.get(id).await
    }

    async fn delete(&self, id: &str) -> DomainResult<()> {
        sqlx::query("DELETE FROM profile_variants WHERE id = ?1")
            .bind(id)
            .execute(&self.db)
            .await?;
        Ok(())
    }
}
