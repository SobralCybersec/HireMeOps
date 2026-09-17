use super::*;
use crate::ai::prompt::CvContact;
use crate::ai::prompt::{CvCertificate, CvEducationEntry, CvExperienceEntry, CvSkillGroup};

fn sample() -> CvRewrite {
    CvRewrite {
        name: "Ana Sobral".to_string(),
        contact: CvContact {
            email: "ana@example.com".to_string(),
            phone: "(21) 99999-9999".to_string(),
            location: "Rio de Janeiro".to_string(),
            linkedin: "https://linkedin.com/in/anasobral".to_string(),
            github: "AnaGH".to_string(),
            gitlab: "https://gitlab.com/anasobral".to_string(),
            website: "https://ana.dev".to_string(),
        },
        positions: vec!["Backend Engineer".to_string(), "Rust Developer".to_string()],
        summary: "Pragmatic engineer & builder.".to_string(),
        skills: vec![CvSkillGroup {
            category: "Database & Cache".to_string(),
            skills: "PostgreSQL, Redis".to_string(),
        }],
        experience: vec![CvExperienceEntry {
            title: "Senior Engineer".to_string(),
            organization: "SobralCybersec".to_string(),
            location: "Remote".to_string(),
            dates: "2020—2025".to_string(),
            url: String::new(),
            bullets: vec!["Cut p99 latency by 40%.".to_string(), "  ".to_string()],
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
fn escapes_all_specials() {
    assert_eq!(latex_escape("a & b % c"), "a \\& b \\% c");
    assert_eq!(latex_escape("100%_#$"), "100\\%\\_\\#\\$");
    assert_eq!(latex_escape("{x}"), "\\{x\\}");
    assert_eq!(latex_escape("a\\b"), "a\\textbackslash{}b");
}

#[test]
fn bold_markers_become_textbf_and_stay_escaped() {
    assert_eq!(
        latex_escape_bold("cut cost by **40% & rising**"),
        "cut cost by \\textbf{40\\% \\& rising}"
    );
    assert_eq!(
        latex_escape_bold(r"cut cost by \textbf{40% & rising}"),
        "cut cost by \\textbf{40\\% \\& rising}"
    );
    assert_eq!(
        latex_escape_bold(r"cut cost by \bf{40% & rising}"),
        "cut cost by \\textbf{40\\% \\& rising}"
    );
    assert_eq!(latex_escape_bold("plain 50%"), "plain 50\\%");
    let out = latex_escape_bold("a **b_c");
    assert_eq!(out, "a **b\\_c");
    assert!(!out.contains("\\textbf{"));
}

#[test]
fn splits_name_into_two_groups() {
    assert_eq!(
        split_name("Ana Sobral da Silva"),
        ("Ana".into(), "Sobral da Silva".into())
    );
    assert_eq!(split_name("Cher"), ("Cher".into(), String::new()));
}

#[test]
fn document_is_well_formed_and_escaped() {
    let tex = generate_resume_tex(&sample());
    assert!(tex.starts_with("\\documentclass[11pt, a4paper]{curriculo}"));
    assert!(tex.contains("bottom=1.0cm, footskip=0pt"));
    assert!(tex.contains("\\pagestyle{empty}"));
    assert!(tex.trim_end().ends_with("\\end{document}"));
    for env in [
        "document",
        "cvparagraph",
        "cventries",
        "cvskills",
        "cvitems",
    ] {
        assert_eq!(
            tex.matches(&format!("\\begin{{{env}}}")).count(),
            tex.matches(&format!("\\end{{{env}}}")).count(),
            "unbalanced {env}"
        );
    }
    assert!(!tex.contains("\\extrainfo{~}"));
    assert!(tex.contains("\\email{ana@example.com}"));
    assert!(tex.contains("\\mobile{(21) 99999-9999}"));
    assert!(tex.contains("\\address{Rio de Janeiro}"));
    assert!(tex.contains("\\homepage{https://ana.dev}"));
    assert!(tex.contains("\\github{AnaGH}"));
    assert!(tex.contains("\\gitlab{anasobral}"), "tex: {tex}");
    assert!(tex.contains("\\linkedin{anasobral}"), "tex: {tex}");
    assert!(tex.contains("\\name{Ana}{Sobral}"));
    assert!(tex.contains("\\cvskill\n    {Database \\& Cache}"));
    assert!(tex.contains("\\item {Cut p99 latency by 40\\%.}"));
    assert_eq!(tex.matches("\\item").count(), 1);
    assert!(tex.contains("Backend Engineer{\\enskip\\cdotp\\enskip}Rust Developer"));
}

#[test]
fn empty_sections_are_omitted() {
    let tex = generate_resume_tex(&CvRewrite::default());
    assert!(!tex.contains("cventries"));
    assert!(!tex.contains("cvskills"));
    assert!(!tex.contains("cvparagraph"));
    assert!(tex.contains("\\begin{document}"));
    assert!(tex.contains("\\extrainfo{~}"));
}

#[test]
fn certificates_are_optional_and_urls_are_clickable() {
    let mut cv = sample();
    assert!(!generate_resume_tex(&cv).contains("Certificates"));
    cv.certificates.push(CvCertificate {
        name: "Cloud Certificate".to_string(),
        issuer: "Issuer".to_string(),
        credential_id: "CERT-1".to_string(),
        date: "2025".to_string(),
        credential_url: "https://certs.example/CERT-1?a=1&b=2".to_string(),
    });
    let tex = generate_resume_tex(&cv);
    assert!(tex.contains("\\cvsection{Certificates}"));
    assert!(tex.contains("\\href{https://certs.example/CERT-1?a=1\\&b=2}{Cloud Certificate}"));
    assert!(tex.contains("{Issuer}"));
    assert!(tex.contains("\\cvhonor\n    {\\href{https://certs.example/CERT-1?a=1\\&b=2}{Cloud Certificate}}\n    {Issuer}\n    {}\n    {}"));
    assert!(!tex.contains("\n    {CERT-1}\n"));
    assert!(!tex.contains("\n    {2025}\n"));
}

#[test]
fn experience_url_renders_github_icon() {
    let mut cv = sample();
    cv.experience[0].url = "https://github.com/user/project".to_string();
    let tex = generate_resume_tex(&cv);
    assert!(tex.contains("\\faGithub"), "should contain GitHub icon");
    assert!(tex.contains("GitHub"), "should contain GitHub label");
    assert!(
        tex.contains("\\faArrowUpRightFromSquare"),
        "should contain external-link arrow"
    );
    assert!(
        tex.contains("\\href{https://github.com/user/project}"),
        "should contain href link"
    );
}

#[test]
fn experience_url_detects_platform() {
    assert_eq!(
        url_platform("https://github.com/user/project"),
        ("GitHub", "\\faGithub")
    );
    assert_eq!(
        url_platform("https://gitlab.com/user/project"),
        ("GitLab", "\\faGitlab")
    );
    assert_eq!(
        url_platform("https://behance.net/user"),
        ("Behance", "\\faBehance")
    );
    assert_eq!(
        url_platform("https://linkedin.com/in/user"),
        ("LinkedIn", "\\faLinkedin")
    );
    assert_eq!(
        url_platform("https://example.com/portfolio"),
        ("Portfolio", "\\faGlobe")
    );
    assert_eq!(
        url_platform("https://user.github.io/project"),
        ("GitHub", "\\faGithub")
    );
}

#[test]
fn cover_letter_tex_uses_generated_body_and_cv_identity() {
    let mut cv = sample();
    cv.cover_letter =
        "I built **reliable systems**.\n\nI would welcome a conversation.".to_string();
    let tex = generate_cover_letter_tex(&cv);
    assert!(tex.starts_with("\\documentclass[11pt, a4paper]{curriculo}"));
    assert!(tex.contains("\\lettertitle{Application for Backend Engineer}"));
    assert!(tex.contains("\\begin{cvletter}"));
    assert!(tex.contains("\\lettersection{About Me}"));
    assert!(tex.contains("\\textbf{reliable systems}"));
    assert!(tex.contains("\\makeletterclosing"));
}

#[test]
fn messy_header_values_compile_via_xelatex() {
    if std::process::Command::new("xelatex")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: xelatex not available");
        return;
    }
    let cvtex = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
    let mut cv = sample();
    cv.name = "Candidate Villas Boas".to_string();
    cv.contact = CvContact {
            email: r"candidate\@hotmail.com".to_string(),
            phone: "+55 19\n99956-9888".to_string(),
            location: "Rio Claro, São Paulo,\nBrasil".to_string(),
            linkedin: "[https://br.linkedin.com/in/candidate](https://br.linkedin.com/in/candidate)".to_string(),
            github: String::new(),
            gitlab: String::new(),
            website: "[https://www.behance.net/candidate](https://www.behance.net/candidate)\n\nGraphic Director".to_string(),
        };
    cv.positions = vec!["Art Director".to_string(), "Visual Designer".to_string()];
    cv.language = Language::Pt;
    cv.summary = "Graphic designer with experience in visual communication, campaigns, social media, branding, and print materials. I also study UX/UI Design, expanding practice in interfaces, prototyping, responsive design, usability, and user feedback analysis.".to_string();
    cv.experience[0].url = "[https://www.behance.net/gallery/123/PROJECT](https://www.behance.net/gallery/123/PROJECT)".to_string();
    cv.experience.push(CvExperienceEntry {
            title: "Visual Designer".to_string(),
            organization: "Personal portfolio project".to_string(),
            location: "Brazil".to_string(),
            dates: "Published in February 2026".to_string(),
            url: "[https://www.behance.net/gallery/456/CONCEPT](https://www.behance.net/gallery/456/CONCEPT)".to_string(),
            bullets: vec!["Built a conceptual key visual study in Adobe Photoshop.".to_string()],
        });
    cv.experience[0].bullets = vec![
            "Develop visual identities, social media pieces, and branding solutions.".to_string(),
            "Adapt concepts for print and digital materials according to context, format, and communication needs.".to_string(),
        ];
    cv.education[0].bullets = vec![
            "Training in project methodology, visual expression and communication, image and visual identity, graphic design, typography, branding, and information design.".to_string(),
        ];
    cv.certificates.push(CvCertificate {
        name: "Design Thinking".to_string(),
        issuer: "Online School".to_string(),
        credential_id: String::new(),
        date: String::new(),
        credential_url: String::new(),
    });
    let tex = generate_resume_tex(&cv);
    assert!(tex.contains("\\email{candidate@hotmail.com}"));
    assert!(tex.contains("\\homepage{https://www.behance.net/candidate}"));
    assert!(tex.contains("\\linkedin{candidate}"));
    assert!(tex.contains("\\href{https://www.behance.net/gallery/123/PROJECT}"));
    assert!(!tex.contains("](https://"));
    crate::cv::export::build_pdf_tex(&cv, &cv.cv_metadata(), &cvtex, None)
        .expect("contact values must compile via xelatex");
}
