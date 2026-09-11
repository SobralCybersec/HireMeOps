use super::*;
use crate::ai::prompt::{parse_cv_rewrite, CvSkillGroup};

#[test]
fn fallback_pdf_uses_bold_font_across_wrapped_lines() {
    use lopdf::{content::Content, Document};
    let cv = CvRewrite {
        summary: format!("plain **{}** tail", "boldword ".repeat(40)),
        ..Default::default()
    };
    let bytes = crate::cv::export::build_pdf(&cv, &cv.cv_metadata()).unwrap();
    let doc = Document::load_mem(&bytes).unwrap();
    assert!(doc.objects.values().any(|object| {
        object
            .as_dict()
            .ok()
            .and_then(|dict| dict.get(b"BaseFont").ok())
            .and_then(|font| font.as_name().ok())
            == Some(b"Helvetica-Bold")
    }));
    let mut bold_words = 0;
    let mut plain_words = 0;
    for page in doc.get_pages().values() {
        let content = Content::decode(&doc.get_page_content(*page)).unwrap();
        let mut font = Vec::new();
        for op in content.operations {
            if op.operator == "Tf" {
                font = op.operands[0].as_name().unwrap().to_vec();
            }
            if op.operator != "Tj" {
                continue;
            }
            let text = String::from_utf8_lossy(op.operands[0].as_str().unwrap());
            assert!(!text.contains("**"));
            if text.contains("boldword") {
                assert_eq!(font, b"F2");
                bold_words += text.matches("boldword").count();
            }
            if text.contains("plain") || text.contains("tail") {
                assert_eq!(font, b"F1");
                plain_words += 1;
            }
        }
    }
    assert_eq!(bold_words, 40);
    assert!(plain_words >= 2);
}

#[test]
fn rewrite_contract_requires_markdown_emphasis_in_both_languages() {
    use crate::ai::prompt::{cv_rewrite_system, CV_REWRITE_PROMPT_VERSION};
    assert_eq!(CV_REWRITE_PROMPT_VERSION, "cv-rewrite-v19");
    for (language, marker) in [(Language::En, "**bold**"), (Language::Pt, "**negrito**")] {
        let system = cv_rewrite_system(language);
        let contract = system.split("APP OUTPUT CONTRACT:").last().unwrap();
        assert!(contract.contains(marker));
        assert!(contract.contains("1–2"));
        assert!(contract.contains("LaTeX"));
        assert!(!contract.contains("{REWRITE_JSON_SHAPE}"));
    }
    assert_eq!(
        super::super::bold::normalize("Plain text without emphasis"),
        "Plain text without emphasis"
    );
}

#[test]
fn legacy_bold_forms_render_without_literal_commands() {
    for text in [
        r"\textbf {real bold}",
        r"\bf{real bold}",
        r"{\bf real bold}",
        r"{\bfseries real bold}",
        "\u{0009}extbf{real bold}",
        "\u{0008}f{real bold}",
        "**real\nbold**",
    ] {
        assert_eq!(
            latex_escape_bold(text).replace('\n', " "),
            r"\textbf{real bold}",
            "{text:?}"
        );
    }
}

#[test]
fn json_decoded_tex_and_skills_keep_bold() {
    let cv = parse_cv_rewrite(
        r#"{"summary":"Plain \textbf{SUMMARYBOLD} plain \bf{BOLDBF}","skills":[{"category":"Tools","skills":"Plain {\\bf SKILLBOLD}"}]}"#,
    );
    assert_eq!(cv.summary, "Plain **SUMMARYBOLD** plain **BOLDBF**");
    assert!(generate_resume_tex(&cv).contains(r"Plain \textbf{SKILLBOLD}"));
}

#[test]
fn skills_markdown_uses_bold_renderer() {
    let cv = CvRewrite {
        skills: vec![CvSkillGroup {
            category: "Tools".into(),
            skills: "Plain **SKILLBOLD**".into(),
        }],
        ..Default::default()
    };
    assert!(generate_resume_tex(&cv).contains(r"Plain \textbf{SKILLBOLD}"));
}
