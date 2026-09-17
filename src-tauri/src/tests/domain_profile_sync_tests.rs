use super::*;
use crate::ai::prompt::{CvExperienceEntry, CvSkillGroup};
use crate::domain::profile_variants::{ContactInfo, UpdateVariantInput};

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
            url: String::new(),
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

#[test]
fn skill_and_bullet_helpers_ignore_blanks_and_preserve_existing_bullets() {
    let mut variant = sample_variant();
    variant.skills = vec![
        CvSkillGroup {
            skills: " Rust, ; Docker\n".into(),
            ..Default::default()
        },
        CvSkillGroup {
            skills: "docker; Kubernetes".into(),
            ..Default::default()
        },
    ];
    variant.keywords = vec!["KUBERNETES".into(), "Terraform".into(), " ".into()];
    assert_eq!(
        flatten_skills(&variant),
        "Rust, Docker, Kubernetes, Terraform"
    );
    assert_eq!(
        bullets_text(&[" first ".into(), "• already formatted".into(), " ".into()]),
        "• first\n• already formatted"
    );
    assert_eq!(bullets_text(&[]), "");
    assert_eq!(truncate_chars("ééé", 2), "é…");
}

#[test]
fn education_and_experience_sections_cover_labels_and_empty_entries() {
    let mut variant = sample_variant();
    variant.headline.clear();
    variant.about_text.clear();
    variant.skills.clear();
    variant.keywords.clear();
    variant.education = vec![
        crate::ai::prompt::CvEducationEntry {
            degree: "Degree".into(),
            institution: "School".into(),
            location: "City".into(),
            dates: "2020".into(),
            bullets: vec!["Coursework".into()],
        },
        crate::ai::prompt::CvEducationEntry::default(),
    ];
    variant.experience = vec![
        CvExperienceEntry {
            title: "Title".into(),
            bullets: vec!["body".into()],
            ..Default::default()
        },
        CvExperienceEntry {
            organization: "Org".into(),
            bullets: vec!["body".into()],
            ..Default::default()
        },
        CvExperienceEntry {
            bullets: vec!["body".into()],
            ..Default::default()
        },
        CvExperienceEntry::default(),
    ];
    let plan = plan_from_variant(&variant);
    let labels: Vec<&str> = plan
        .sections
        .iter()
        .map(|section| section.label.as_str())
        .collect();
    assert!(labels.contains(&"Education — School"));
    assert!(labels.contains(&"Experience — Title"));
    assert!(labels.contains(&"Experience — Org"));
    assert!(labels.contains(&"Experience #3"));
    assert_eq!(plan.sections.len(), 4);
    assert!(plan.sections[0]
        .copy_text
        .contains("Degree\nSchool\nCity\n2020"));
    assert!(plan.sections[0].metadata.is_some());
}

#[tokio::test]
async fn empty_sync_plan_id_is_rejected_before_service_access() {
    struct NeverCalled;

    impl ProfileVariantService for NeverCalled {
        async fn create_from_rewrite(
            &self,
            _: &str,
            _: &str,
            _: Option<String>,
        ) -> DomainResult<ProfileVariantDto> {
            unreachable!("invalid id must stop before service access")
        }

        async fn list(&self, _: &str) -> DomainResult<Vec<ProfileVariantDto>> {
            unreachable!("invalid id must stop before service access")
        }

        async fn get(&self, _: &str) -> DomainResult<ProfileVariantDto> {
            unreachable!("invalid id must stop before service access")
        }

        async fn update(&self, _: &str, _: UpdateVariantInput) -> DomainResult<ProfileVariantDto> {
            unreachable!("invalid id must stop before service access")
        }

        async fn delete(&self, _: &str) -> DomainResult<()> {
            unreachable!("invalid id must stop before service access")
        }
    }

    assert!(matches!(
        build_sync_plan(&NeverCalled, "  ").await,
        Err(DomainError::InvalidInput(message)) if message == "variant_id is empty"
    ));
}
