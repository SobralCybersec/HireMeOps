use super::*;
use crate::ai::prompt::{
    CvCertificate, CvEducationEntry, CvExperienceEntry, CvSkillGroup, Language,
};

fn sample() -> CvRewrite {
    CvRewrite {
        name: "Ana Sobral".to_string(),
        contact: Default::default(),
        positions: vec!["Backend Engineer".to_string(), "Rust Developer".to_string()],
        summary: "Pragmatic engineer with a decade shipping local-first tools. ".repeat(6),
        skills: vec![CvSkillGroup {
            category: "Languages".to_string(),
            skills: "Rust, TypeScript, Python".to_string(),
        }],
        experience: vec![CvExperienceEntry {
            title: "Senior Engineer".to_string(),
            organization: "SobralCybersec".to_string(),
            location: "Remote".to_string(),
            dates: "2020—2025".to_string(),
            url: String::new(),
            bullets: vec!["Led the automation cockpit rewrite.".to_string()],
        }],
        education: vec![CvEducationEntry {
            degree: "BSc Computer Science".to_string(),
            institution: "Universidade Federal".to_string(),
            location: "Brazil".to_string(),
            dates: "2012—2016".to_string(),
            bullets: vec![],
        }],
        language: Language::En,
        ..Default::default()
    }
}

#[test]
fn build_pdf_emits_a_loadable_document() {
    let mut cv = sample();
    cv.certificates.push(CvCertificate {
        name: "Cloud Certificate".to_string(),
        issuer: "Issuer".to_string(),
        credential_id: "CERT-1".to_string(),
        date: "2025".to_string(),
        credential_url: "https://certs.example/CERT-1?a=1&b=2".to_string(),
    });
    let meta = cv.cv_metadata();
    let bytes = build_pdf(&cv, &meta).expect("build");
    assert!(bytes.starts_with(b"%PDF"), "must be a PDF");
    let doc = Document::load_mem(&bytes).expect("reload");
    let info_ref = doc.trailer.get(b"Info").expect("info");
    let info_id = match info_ref {
        Object::Reference(id) => *id,
        _ => panic!("Info not a reference"),
    };
    let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
    let title = info.get(b"Title").unwrap().as_str().unwrap();
    assert_eq!(title, meta.title.as_bytes());
    let category = info.get(b"Category").unwrap().as_str().unwrap();
    assert_eq!(category, b"CV");
}

#[test]
fn embed_metadata_preserves_pages_and_tags_info() {
    let cv = sample();
    let meta = cv.cv_metadata();
    let base = build_pdf(&cv, &meta).expect("build");
    let tagged = embed_metadata(&base, &meta).expect("embed");
    let doc = Document::load_mem(&tagged).expect("reload");
    assert_eq!(
        doc.get_pages().len(),
        Document::load_mem(&base).unwrap().get_pages().len()
    );
    let info_id = match doc.trailer.get(b"Info").unwrap() {
        Object::Reference(id) => *id,
        _ => panic!("no info"),
    };
    let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
    assert_eq!(
        info.get(b"Author").unwrap().as_str().unwrap(),
        meta.author.as_bytes()
    );
}

#[test]
fn fallback_certificate_layout_omits_credential_id_and_date() {
    let mut cv = sample();
    cv.certificates.push(CvCertificate {
        name: "Cloud Certificate".to_string(),
        issuer: "Issuer".to_string(),
        credential_id: "CERT-1".to_string(),
        date: "2025".to_string(),
        credential_url: String::new(),
    });
    let certificate_line = layout_lines(&cv)
        .into_iter()
        .map(|line| {
            line.runs
                .into_iter()
                .map(|run| run.text)
                .collect::<String>()
        })
        .find(|text| text.contains("Cloud Certificate"))
        .expect("certificate line");
    assert_eq!(certificate_line, "Cloud Certificate - Issuer");
}

#[test]
fn build_pdf_tex_compiles_via_xelatex() {
    if std::process::Command::new("xelatex")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: xelatex not available");
        return;
    }
    let cvtex = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
    if !cvtex.join("curriculo.cls").is_file() {
        eprintln!("skipping: resources/cvtex not present");
        return;
    }

    let mut cv = sample();
    cv.certificates.push(CvCertificate {
        name: "Cloud Certificate".to_string(),
        issuer: "Issuer".to_string(),
        credential_id: "CERT-1".to_string(),
        date: "2025".to_string(),
        credential_url: "https://certs.example/CERT-1?a=1&b=2".to_string(),
    });
    let meta = cv.cv_metadata();
    let bytes = build_pdf_tex(&cv, &meta, &cvtex, None).expect("xelatex compile");
    assert!(bytes.starts_with(b"%PDF"), "must be a PDF");

    let doc = Document::load_mem(&bytes).expect("reload");
    let info_id = match doc.trailer.get(b"Info").expect("info") {
        Object::Reference(id) => *id,
        _ => panic!("Info not a reference"),
    };
    let info = doc.get_object(info_id).unwrap().as_dict().unwrap();
    assert_eq!(
        info.get(b"Title").unwrap().as_str().unwrap(),
        meta.title.as_bytes()
    );
    assert_eq!(info.get(b"Category").unwrap().as_str().unwrap(), b"CV");
    assert!(!doc.get_pages().is_empty(), "must have at least one page");
    assert!(doc.objects.values().any(|object| {
        matches!(
            object,
            Object::Dictionary(dict)
                if matches!(dict.get(b"Subtype"), Ok(Object::Name(name)) if name == b"Link")
        )
    }));
}

#[test]
fn build_cover_letter_tex_compiles_via_xelatex() {
    if std::process::Command::new("xelatex")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: xelatex not available");
        return;
    }
    let cvtex = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
    if !cvtex.join("curriculo.cls").is_file() {
        eprintln!("skipping: resources/cvtex not present");
        return;
    }

    let mut cv = sample();
    cv.cover_letter = "I built reliable systems.\n\nI welcome a conversation.".to_string();
    let bytes = build_cover_letter_pdf_tex(&cv, &cvtex, None).expect("xelatex compile");
    assert!(bytes.starts_with(b"%PDF"), "must be a PDF");
    assert!(!Document::load_mem(&bytes).unwrap().get_pages().is_empty());
}

#[test]
fn export_mode_parse_defaults_to_new() {
    assert_eq!(ExportMode::parse("modify"), ExportMode::Modify);
    assert_eq!(ExportMode::parse("MODIFY"), ExportMode::Modify);
    assert_eq!(ExportMode::parse("new"), ExportMode::New);
    assert_eq!(ExportMode::parse("garbage"), ExportMode::New);
}

#[test]
fn wrap_never_drops_words() {
    let text = "one two three four five six seven eight nine ten";
    let wrapped = wrap(text, 12);
    let rejoined = wrapped
        .into_iter()
        .map(|runs| runs.into_iter().map(|run| run.text).collect::<String>())
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(rejoined, text);
}

#[test]
fn wrap_preserves_partial_word_bold_and_unicode() {
    let wrapped = wrap("ação pre**fix**o **muito longo** fim", 8);
    let text: Vec<String> = wrapped
        .iter()
        .map(|runs| runs.iter().map(|run| run.text.as_str()).collect())
        .collect();
    assert_eq!(text, ["ação", "prefixo", "muito", "longo", "fim"]);
    assert_eq!(
        wrapped[1],
        vec![
            Run {
                text: "pre".into(),
                bold: false
            },
            Run {
                text: "fix".into(),
                bold: true
            },
            Run {
                text: "o".into(),
                bold: false
            },
        ]
    );
    assert!(wrapped[2][0].bold);
    assert!(wrapped[3][0].bold);
    assert!(!wrapped[4][0].bold);
}
