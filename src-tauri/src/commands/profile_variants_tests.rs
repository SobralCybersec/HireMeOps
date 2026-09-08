#[cfg(all(test, feature = "real-browser"))]
mod catho_section_tests {
    use super::super::{catho_sections_from_variant, CathoSection};
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
    use super::super::gupy_profile_from_variant;
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
    use super::super::{infojobs_profile_from_variant, split_br_phone, split_first_surname};
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
