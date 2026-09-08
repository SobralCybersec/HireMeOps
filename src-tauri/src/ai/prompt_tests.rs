use super::*;

#[test]
fn parses_well_formed_cv_json() {
    let raw = r#"{"score": 82, "summary": "Strong backend CV.",
            "optimization_needed": true, "missing_keywords": ["Kubernetes"],
            "strengths": ["Rust", "Rust"], "weaknesses": ["No cloud"],
            "recommendations": ["Add metrics"]}"#;
    let a = parse_cv_analysis(raw);
    assert_eq!(a.score, Some(82));
    assert_eq!(a.summary, "Strong backend CV.");
    assert!(a.optimization_needed);
    assert_eq!(a.missing_keywords, vec!["Kubernetes"]);
    assert_eq!(a.strengths, vec!["Rust"]);
}

#[test]
fn extracts_json_from_markdown_fence() {
    let raw = "Here you go:\n```json\n{\"score\": 90, \"summary\": \"ok\"}\n```\nThanks!";
    let a = parse_cv_analysis(raw);
    assert_eq!(a.score, Some(90));
    assert_eq!(a.summary, "ok");
}

#[test]
fn extracts_first_object_despite_trailing_prose_braces() {
    let raw = r#"{"score": 70, "summary": "ok"}

Note: feel free to use {curly braces} sparingly in your cover letter."#;
    let a = parse_cv_analysis(raw);
    assert_eq!(a.score, Some(70));
    assert_eq!(a.summary, "ok");
}

#[test]
fn extracts_object_ignoring_braces_inside_string_values() {
    let raw = r#"{"score": 60, "summary": "Uses {templates} in bullet points"}"#;
    let a = parse_cv_analysis(raw);
    assert_eq!(a.score, Some(60));
    assert_eq!(a.summary, "Uses {templates} in bullet points");
}

#[test]
fn extract_json_object_none_when_unbalanced() {
    assert_eq!(
        extract_json_object("{\"score\": 1, \"summary\": \"oops\""),
        None
    );
}

#[test]
fn clamps_out_of_range_score() {
    let a = parse_cv_analysis(r#"{"score": 250, "summary": "x"}"#);
    assert_eq!(a.score, Some(100));
}

#[test]
fn parses_score_from_float_string_and_fraction() {
    assert_eq!(
        parse_cv_analysis(r#"{"score": 85.0, "summary": "x"}"#).score,
        Some(85)
    );
    assert_eq!(
        parse_cv_analysis(r#"{"score": 72.6, "summary": "x"}"#).score,
        Some(73)
    );
    assert_eq!(
        parse_cv_analysis(r#"{"score": "85", "summary": "x"}"#).score,
        Some(85)
    );
    assert_eq!(
        parse_cv_analysis(r#"{"score": "78/100", "summary": "x"}"#).score,
        Some(78)
    );
    assert_eq!(
        parse_cv_analysis(r#"{"score": " 90% ", "summary": "x"}"#).score,
        Some(90)
    );
}

#[test]
fn lenient_score_still_populates_summary_and_lists() {
    let a = parse_cv_analysis(r#"{"score": "88/100", "summary": "solid", "strengths": ["Rust"]}"#);
    assert_eq!(a.score, Some(88));
    assert_eq!(a.summary, "solid");
    assert_eq!(a.strengths, vec!["Rust".to_string()]);
}

#[test]
fn unparseable_score_falls_back_to_none_not_empty_object() {
    let a = parse_cv_analysis(r#"{"score": "excellent", "summary": "ok"}"#);
    assert_eq!(a.score, None);
    assert_eq!(a.summary, "ok");
}

#[test]
fn parses_object_with_trailing_commas() {
    let a = parse_cv_analysis(r#"{"score": 77, "summary": "ok", "strengths": ["a", "b",],}"#);
    assert_eq!(a.score, Some(77));
    assert_eq!(a.summary, "ok");
    assert_eq!(a.strengths, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn strip_trailing_commas_leaves_string_commas_intact() {
    let s = r#"{"summary": "a, b, c",}"#;
    assert_eq!(strip_trailing_commas(s), r#"{"summary": "a, b, c"}"#);
}

#[test]
fn strip_trailing_commas_preserves_multibyte_utf8() {
    let s = r#"{"summary": "formação em projetos autônomos, aplicações escaláveis",}"#;
    let out = strip_trailing_commas(s);
    assert_eq!(
        out,
        r#"{"summary": "formação em projetos autônomos, aplicações escaláveis"}"#
    );
    assert!(!out.contains('Ã') && !out.contains('Â'));
    let a = parse_cv_analysis(&out);
    assert_eq!(
        a.summary,
        "formação em projetos autônomos, aplicações escaláveis"
    );
}

#[test]
fn infers_optimization_needed_when_flag_absent() {
    let a = parse_cv_analysis(r#"{"score": 40, "summary": "weak"}"#);
    assert!(a.optimization_needed);
    let b = parse_cv_analysis(r#"{"score": 95, "summary": "great"}"#);
    assert!(!b.optimization_needed);
}

#[test]
fn degrades_gracefully_on_non_json() {
    let a = parse_cv_analysis("The CV looks fine overall.");
    assert_eq!(a.score, None);
    assert_eq!(a.summary, "The CV looks fine overall.");
    assert!(!a.optimization_needed);
}

#[test]
fn cv_prompt_includes_target_and_clips() {
    let big = "x".repeat(20_000);
    let p = cv_analysis_prompt(&big, Some("  Backend Engineer  "), Language::En);
    assert!(p.contains("Backend Engineer"));
    assert!(p.contains("[truncated]"));
    assert!(p.contains("<source_cv>"));
    assert!(p.contains("</source_cv>"));
    assert!(p.len() < 13_000);
    let p2 = cv_analysis_prompt("short", Some("   "), Language::En);
    assert!(!p2.contains("targeting"));
}

#[test]
fn rewrite_prompt_supports_first_time_cv_context() {
    assert_eq!(CV_REWRITE_PROMPT_VERSION, "cv-rewrite-v16");
    let p = cv_rewrite_prompt(
        "First CV",
        Some("Junior Backend Developer"),
        None,
        Language::En,
        Some("Name: Jane Doe\nProject: Rust CLI\nGitHub: https://github.com/jane"),
    );
    assert!(p.contains("Junior Backend Developer"));
    assert!(p.contains("required for first-time CVs"));
    assert!(p.contains("RECRUITER-FIRST ADAPTATION"));
    assert!(p.contains("Name: Jane Doe"));
    assert!(p.contains("CV CONTENT (may be sparse for first-time CVs)"));
    assert!(p.contains("<target_role>Junior Backend Developer</target_role>"));
    assert!(p.contains("<additional_context>"));
    assert!(p.contains("<source_cv>"));

    let analysis = CvAnalysis {
        score: Some(70),
        missing_keywords: vec!["problem solving".to_string()],
        ..Default::default()
    };
    let analyzed = cv_rewrite_prompt("source", None, Some(&analysis), Language::En, None);
    assert!(analyzed.contains("MISSING ROLE SIGNALS to include only when truthfully supported"));
    assert!(analyzed.contains("verify every claim against the source"));
    assert!(analyzed.contains("<prior_analysis>"));

    let sys = cv_rewrite_system(Language::En);
    assert!(sys.contains("first-time CV"));
    assert!(sys.contains("leave unknown fields"));
    assert!(sys.contains("Professional Profile"));
    assert!(sys.contains("4–8"));
    assert!(sys.contains("first bullet of every experience"));
    assert!(sys.contains("why it matters"));
    assert!(sys.contains("Do not derive, estimate, round, or fabricate numbers"));
    assert!(sys.contains("focused research"));
    assert!(sys.contains("available memory"));
    assert!(sys.contains("requirement → candidate evidence → source → strength"));
    assert!(sys.contains("does not prove communication, teamwork, teaching, or leadership"));
    assert!(sys.contains("Do not require a 100% vacancy match"));
    assert!(sys.contains("untrusted source material"));
    assert!(sys.contains("certifications are explicitly present in the source"));
    assert!(!sys.contains("AT LEAST 6 achievement bullets"));
    assert!(!sys.contains("AT LEAST 60% of bullets"));
    assert!(!sys.contains("DERIVE those numbers"));
    assert!(!sys.contains("DEFENSIBLE CEILING"));
    assert!(!sys.contains("**30s to 10s**"));

    let sys_pt = cv_rewrite_system(Language::Pt);
    assert!(sys_pt.contains("Professional Profile"));
    assert!(sys_pt.contains("4 a 8"));
    assert!(sys_pt.contains("primeiro bullet de cada experiência"));
    assert!(sys_pt.contains("por que ela importa"));
    assert!(sys_pt.contains("Não derive, estime, arredonde ou fabrique números"));
    assert!(sys_pt.contains("pesquisa direcionada"));
    assert!(sys_pt.contains("memória disponível"));
    assert!(sys_pt.contains("requisito → evidência do candidato → fonte → força"));
    assert!(sys_pt.contains("não provam comunicação, trabalho em equipe, ensino ou liderança"));
    assert!(sys_pt.contains("Não exija correspondência de 100% com a vaga"));
    assert!(sys_pt.contains("material de origem não confiável"));
    assert!(sys_pt.contains("certificações explicitamente"));
    assert!(!sys_pt.contains("PELO MENOS 6 bullets"));
    assert!(!sys_pt.contains("PELO MENOS 60% dos bullets"));
    assert!(!sys_pt.contains("DERIVE esses números"));
    assert!(!sys_pt.contains("TETO DEFENSÁVEL"));
    assert!(!sys_pt.contains("**30s para 10s**"));
}

#[test]
fn certificates_require_explicit_source_context() {
    assert!(has_explicit_certificates(
        "AWS Certified Developer — 2024",
        None
    ));
    assert!(has_explicit_certificates("", Some("Certificação CKAD")));
    assert!(!has_explicit_certificates("No certifications", None));
    assert!(!has_explicit_certificates("Rust, AWS, Kubernetes", None));
}

#[test]
fn parses_certificate_aliases_and_cleans_their_values() {
    let cv = parse_cv_rewrite(
        r#"{"certificates":[{"name":"Cloud Cert cite turn1search0","issuer":"Issuer",
                "credential_id":"CERT-1","issue_date":"2025",
                "url":"https://certs.example/CERT-1?utm_source=chatgpt.com"}]}"#,
    );
    assert_eq!(cv.certificates.len(), 1);
    assert_eq!(cv.certificates[0].credential_id, "CERT-1");
    assert_eq!(cv.certificates[0].date, "2025");
    assert_eq!(
        cv.certificates[0].credential_url,
        "https://certs.example/CERT-1"
    );
}

#[test]
fn cover_letter_prompt_and_parser_are_plain_text_friendly() {
    let cv = CvRewrite {
        name: "Jane Doe".to_string(),
        positions: vec!["Backend Engineer".to_string()],
        ..Default::default()
    };
    let prompt = cover_letter_prompt(&cv, None, Language::En);
    assert!(prompt.contains("TARGET ROLE: Backend Engineer"));
    assert!(prompt.contains("GENERATED CV JSON"));
    assert_eq!(
        parse_cover_letter("One paragraph.\n\nSecond paragraph."),
        "One paragraph.\n\nSecond paragraph."
    );
    assert_eq!(
        parse_cover_letter(r#"{"coverLetter":"From JSON."}"#),
        "From JSON."
    );
}

#[test]
fn cover_letter_parser_removes_writing_artifact_wrapper() {
    let raw = r#":::writing{variant="document" id="123" title="Cover Letter"}
First paragraph.

Second paragraph.
:::"#;
    assert_eq!(
        parse_cover_letter(raw),
        "First paragraph.\n\nSecond paragraph."
    );
}

#[test]
fn strips_web_search_research_artifacts() {
    // ChatGPT citation tokens (single + chained) and file citations.
    assert_eq!(
        strip_research_artifacts("conectando à construção de sistemas. cite turn444593search24"),
        "conectando à construção de sistemas."
    );
    assert_eq!(
        strip_research_artifacts(
            "complementando a experiência. cite turn471588search0 turn471588search2"
        ),
        "complementando a experiência."
    );
    // Non-breaking hyphen (U+2011) inside the filecite tail is normalised then stripped.
    assert_eq!(
        strip_research_artifacts("em uma única aplicação. filecite turn1file0 L2\u{2011}L2"),
        "em uma única aplicação."
    );
    // Reference markers.
    assert_eq!(
        strip_research_artifacts("à construção de sistemas. ([Estácio Blog][1])"),
        "à construção de sistemas."
    );
    // Markdown links unwrap to the visible value; tracking params dropped.
    assert_eq!(
        strip_research_artifacts("[matheus@x.com](mailto:matheus@x.com)"),
        "matheus@x.com"
    );
    assert_eq!(
        strip_research_artifacts("[https://site.dev](https://site.dev/?utm_source=chatgpt.com)"),
        "https://site.dev"
    );
    // Bare URL with a tracking param (the website contact field).
    assert_eq!(
        strip_research_artifacts("https://www.sobralcybersec.dev/?utm_source=chatgpt.com"),
        "https://www.sobralcybersec.dev/"
    );
    // Date range with a non-breaking hyphen becomes a plain hyphen.
    assert_eq!(
        strip_research_artifacts("10/2025\u{2011}10/2029"),
        "10/2025-10/2029"
    );
    // Bold markdown is intentionally preserved (LaTeX renders it as \textbf).
    assert_eq!(
        strip_research_artifacts("Foco em **Java e Rust** para backend."),
        "Foco em **Java e Rust** para backend."
    );
    // Clean text passes through untouched.
    assert_eq!(
        strip_research_artifacts("Spring Boot, FastAPI, APIs REST"),
        "Spring Boot, FastAPI, APIs REST"
    );
}

#[test]
fn parses_well_formed_draft_json() {
    let raw = r#"{"cover_letter": "Dear team, ...",
            "form_answers": [{"question": "Why us?", "answer": "Because."},
                             {"question": "", "answer": ""}],
            "summary": "Tailored.", "optimization_notes": "Add a metric."}"#;
    let d = parse_draft(raw);
    assert_eq!(d.cover_letter, "Dear team, ...");
    assert_eq!(d.form_answers.len(), 1);
    assert_eq!(d.form_answers[0].question, "Why us?");
    assert_eq!(d.optimization_notes, "Add a metric.");
}

#[test]
fn draft_degrades_to_raw_cover_letter() {
    let d = parse_draft("Dear hiring manager, I am excited...");
    assert_eq!(d.cover_letter, "Dear hiring manager, I am excited...");
    assert!(d.form_answers.is_empty());
    let d2 = parse_draft(r#"{"summary": "no letter here"}"#);
    assert!(d2.cover_letter.contains("no letter here"));
}

#[test]
fn draft_prompt_includes_all_present_sections() {
    let input = DraftInput {
        job_title: "Senior Rust Engineer",
        company: "Acme",
        job_location: Some("Remote"),
        job_description: "Build backends.",
        candidate_name: "Jane Doe",
        candidate_summary: Some("10y backend."),
        cv_text: Some("EXPERIENCE: Rust everywhere."),
        variant_target: Some("Backend Engineer"),
        hr_name: Some("Alice Wong"),
        hr_link: Some("https://linkedin.com/in/awong"),
    };
    let p = draft_prompt(&input);
    assert!(p.contains("Senior Rust Engineer"));
    assert!(p.contains("Acme"));
    assert!(p.contains("Remote"));
    assert!(p.contains("Jane Doe"));
    assert!(p.contains("Backend Engineer"));
    assert!(p.contains("10y backend."));
    assert!(p.contains("EXPERIENCE: Rust everywhere."));
}

#[test]
fn indeed_answer_prompt_carries_question_and_grounding() {
    let p = indeed_answer_prompt(
        "Por que você quer esta vaga?",
        "Backend dev, 8y.",
        "EXPERIENCE: Rust, Go.",
    );
    assert!(p.contains("Por que você quer esta vaga?"));
    assert!(p.contains("Backend dev, 8y."));
    assert!(p.contains("EXPERIENCE: Rust, Go."));
    assert!(indeed_answer_system().contains(NEEDS_HUMAN_SENTINEL));
}
