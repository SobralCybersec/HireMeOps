//! LinkedIn draft-and-review sync assistant: turns a profile variant into a copy-paste plan (no evasion bot, nothing auto-written).
//! Key: plan_from_variant — pure transform: ProfileVariantDto -> ProfileSyncPlan
//! Key: build_sync_plan — fetches a persisted variant then renders plan_from_variant
//! Key: SyncSection / SyncSectionKind — one reviewable copy-paste unit (headline/about/skills/education/experience)
//! Key: SyncSectionResult — per-section outcome after the automation worker runs

use serde::{Deserialize, Serialize};

use crate::domain::profile_variants::{ProfileVariantDto, ProfileVariantService};
use crate::domain::{DomainError, DomainResult};
use crate::util::now_iso;

const ABOUT_MAX: usize = 2600;
const HEADLINE_MAX: usize = 220;
const EXPERIENCE_DESC_MAX: usize = 2000;

const URL_INTRO_EDIT: &str = "https://www.linkedin.com/in/me/edit/intro/";
const URL_ABOUT_EDIT: &str = "https://www.linkedin.com/in/me/edit/forms/summary/new/";
const URL_SKILLS_EDIT: &str = "https://www.linkedin.com/in/me/skills/edit/forms/new/";
const URL_PROFILE_ROOT: &str = "https://www.linkedin.com/in/me/";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncSectionKind {
    Headline,
    About,
    Skills,
    Education,
    Experience,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSection {
    pub id: String,
    pub kind: SyncSectionKind,
    pub label: String,
    pub edit_url: String,
    pub copy_text: String,
    pub char_limit: Option<usize>,
    pub over_limit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSectionResult {
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copy_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSyncPlan {
    pub variant_id: String,
    pub profile_id: String,
    pub variant_name: String,
    pub target_title: String,
    pub sections: Vec<SyncSection>,
    pub disclaimer: String,
    pub generated_at: String,
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

fn flatten_skills(variant: &ProfileVariantDto) -> String {
    let mut seen: Vec<String> = Vec::new();
    for group in &variant.skills {
        for skill in group.skills.split([',', ';', '\n']) {
            let skill = skill.trim();
            if skill.is_empty() {
                continue;
            }
            if !seen.iter().any(|s| s.eq_ignore_ascii_case(skill)) {
                seen.push(skill.to_string());
            }
        }
    }
    for kw in &variant.keywords {
        let kw = kw.trim();
        if kw.is_empty() {
            continue;
        }
        if !seen.iter().any(|s| s.eq_ignore_ascii_case(kw)) {
            seen.push(kw.to_string());
        }
    }
    seen.join(", ")
}

fn bullets_text(bullets: &[String]) -> String {
    bullets
        .iter()
        .map(|b| b.trim())
        .filter(|b| !b.is_empty())
        .map(|b| {
            if b.starts_with('•') {
                b.to_string()
            } else {
                format!("• {b}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn experience_body(entry: &crate::ai::prompt::CvExperienceEntry) -> String {
    let body = bullets_text(&entry.bullets);
    truncate_chars(&body, EXPERIENCE_DESC_MAX)
}

fn education_body(entry: &crate::ai::prompt::CvEducationEntry) -> String {
    let mut lines: Vec<String> = Vec::new();
    for field in [
        &entry.degree,
        &entry.institution,
        &entry.location,
        &entry.dates,
    ] {
        let s = field.trim();
        if !s.is_empty() {
            lines.push(s.to_string());
        }
    }
    let bullet_block = bullets_text(&entry.bullets);
    if !bullet_block.is_empty() {
        lines.push(bullet_block);
    }
    lines.join("\n")
}

pub fn plan_from_variant(variant: &ProfileVariantDto) -> ProfileSyncPlan {
    let mut sections: Vec<SyncSection> = Vec::new();

    if !variant.headline.trim().is_empty() {
        sections.push(SyncSection {
            id: "headline".to_string(),
            kind: SyncSectionKind::Headline,
            label: "Headline".to_string(),
            edit_url: URL_INTRO_EDIT.to_string(),
            copy_text: truncate_chars(variant.headline.trim(), HEADLINE_MAX),
            char_limit: Some(HEADLINE_MAX),
            over_limit: false,
            metadata: None,
        });
    }

    if !variant.about_text.trim().is_empty() {
        sections.push(SyncSection {
            id: "about".to_string(),
            kind: SyncSectionKind::About,
            label: "About".to_string(),
            edit_url: URL_ABOUT_EDIT.to_string(),
            copy_text: truncate_chars(variant.about_text.trim(), ABOUT_MAX),
            char_limit: Some(ABOUT_MAX),
            over_limit: false,
            metadata: None,
        });
    }

    let skills = flatten_skills(variant);
    if !skills.is_empty() {
        sections.push(SyncSection {
            id: "skills".to_string(),
            kind: SyncSectionKind::Skills,
            label: "Skills".to_string(),
            edit_url: URL_SKILLS_EDIT.to_string(),
            copy_text: skills,
            char_limit: None,
            over_limit: false,
            metadata: None,
        });
    }

    for (i, entry) in variant.education.iter().enumerate() {
        if entry.institution.trim().is_empty() {
            continue;
        }
        let label = format!("Education — {}", entry.institution.trim());
        let copy_text = education_body(entry);
        let metadata = serde_json::to_string(entry).ok();
        sections.push(SyncSection {
            id: format!("education-{i}"),
            kind: SyncSectionKind::Education,
            label,
            edit_url: URL_PROFILE_ROOT.to_string(),
            copy_text,
            char_limit: None,
            over_limit: false,
            metadata,
        });
    }

    for (i, entry) in variant.experience.iter().enumerate() {
        let body = experience_body(entry);
        if body.is_empty() {
            continue;
        }
        let title = entry.title.trim();
        let org = entry.organization.trim();
        let label = match (title.is_empty(), org.is_empty()) {
            (false, false) => format!("Experience — {title} @ {org}"),
            (false, true) => format!("Experience — {title}"),
            (true, false) => format!("Experience — {org}"),
            (true, true) => format!("Experience #{}", i + 1),
        };
        sections.push(SyncSection {
            id: format!("experience-{i}"),
            kind: SyncSectionKind::Experience,
            label,
            edit_url: URL_PROFILE_ROOT.to_string(),
            copy_text: body,
            char_limit: Some(EXPERIENCE_DESC_MAX),
            over_limit: false,
            metadata: serde_json::to_string(entry).ok(),
        });
    }

    ProfileSyncPlan {
        variant_id: variant.id.clone(),
        profile_id: variant.profile_id.clone(),
        variant_name: variant.name.clone(),
        target_title: variant.target_title.clone(),
        sections,
        disclaimer: "Review every section before applying. Nothing is written to \
             LinkedIn automatically — you copy each field yourself and click Save."
            .to_string(),
        generated_at: now_iso(),
    }
}

pub async fn build_sync_plan(
    variants: &impl ProfileVariantService,
    variant_id: &str,
) -> DomainResult<ProfileSyncPlan> {
    let id = variant_id.trim();
    if id.is_empty() {
        return Err(DomainError::InvalidInput("variant_id is empty".to_string()));
    }
    let variant = variants.get(id).await?;
    Ok(plan_from_variant(&variant))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompt::{CvExperienceEntry, CvSkillGroup};
    use crate::domain::profile_variants::ContactInfo;

    fn sample_variant() -> ProfileVariantDto {
        ProfileVariantDto {
            id: "var-1".to_string(),
            profile_id: "prof-1".to_string(),
            name: "Backend focus".to_string(),
            target_title: "Senior Backend Engineer".to_string(),
            headline: "Senior Backend Engineer | Rust | Distributed Systems".to_string(),
            summary: "Backend engineer.".to_string(),
            about_text: "I build reliable backend systems.".to_string(),
            keywords: vec!["Rust".to_string(), "PostgreSQL".to_string()],
            positions: vec!["Senior Backend Engineer".to_string()],
            skills: vec![CvSkillGroup {
                category: "Languages".to_string(),
                skills: "Rust, Java, Rust".to_string(),
            }],
            experience: vec![CvExperienceEntry {
                title: "Senior Engineer".to_string(),
                organization: "Acme".to_string(),
                location: "Remote".to_string(),
                dates: "2020–2025".to_string(),
                bullets: vec![
                    "Led a team of five.".to_string(),
                    "Cut latency 40%.".to_string(),
                ],
            }],
            education: vec![],
            contact: ContactInfo::default(),
            source_cv_document_id: None,
            source_rewrite_id: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn plan_has_expected_sections_in_order() {
        let plan = plan_from_variant(&sample_variant());
        let kinds: Vec<SyncSectionKind> = plan.sections.iter().map(|s| s.kind).collect();
        assert_eq!(
            kinds,
            vec![
                SyncSectionKind::Headline,
                SyncSectionKind::About,
                SyncSectionKind::Skills,
                SyncSectionKind::Experience,
            ]
        );
    }

    #[test]
    fn skills_are_deduped_case_insensitively_and_merge_keywords() {
        let plan = plan_from_variant(&sample_variant());
        let skills = plan
            .sections
            .iter()
            .find(|s| s.kind == SyncSectionKind::Skills)
            .unwrap();
        assert_eq!(skills.copy_text, "Rust, Java, PostgreSQL");
    }

    #[test]
    fn experience_body_joins_bullets_with_newlines() {
        let plan = plan_from_variant(&sample_variant());
        let exp = plan
            .sections
            .iter()
            .find(|s| s.kind == SyncSectionKind::Experience)
            .unwrap();
        assert_eq!(exp.copy_text, "• Led a team of five.\n• Cut latency 40%.");
        assert_eq!(exp.label, "Experience — Senior Engineer @ Acme");
    }

    #[test]
    fn headline_is_truncated_to_limit() {
        let mut v = sample_variant();
        v.headline = "x".repeat(HEADLINE_MAX + 50);
        let plan = plan_from_variant(&v);
        let hl = plan
            .sections
            .iter()
            .find(|s| s.kind == SyncSectionKind::Headline)
            .unwrap();
        assert_eq!(hl.copy_text.chars().count(), HEADLINE_MAX);
        assert!(hl.copy_text.ends_with('…'));
    }

    #[test]
    fn empty_variant_yields_no_sections_but_valid_plan() {
        let mut v = sample_variant();
        v.headline = String::new();
        v.about_text = String::new();
        v.skills = vec![];
        v.keywords = vec![];
        v.experience = vec![];
        let plan = plan_from_variant(&v);
        assert!(plan.sections.is_empty());
        assert!(!plan.disclaimer.is_empty());
    }
}
