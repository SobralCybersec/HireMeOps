use super::*;

fn cand(id: &str, title: &str, kws: &[&str], cv: Option<&str>) -> VariantCandidate {
    VariantCandidate {
        variant_id: id.into(),
        target_title: title.into(),
        keywords: kws.iter().map(|s| s.to_string()).collect(),
        preferred_cv_document_id: cv.map(|s| s.to_string()),
    }
}

#[test]
fn empty_candidates_returns_none() {
    assert!(select_best_cv("Rust Engineer", "rust tokio", &[]).is_none());
}

#[test]
fn picks_variant_matching_the_job_title() {
    let cands = vec![
        cand(
            "v_be",
            "Backend Engineer",
            &["rust", "postgres"],
            Some("cv_be"),
        ),
        cand(
            "v_fe",
            "Frontend Engineer",
            &["react", "css"],
            Some("cv_fe"),
        ),
    ];
    let sel = select_best_cv(
        "Senior Backend Engineer",
        "We build Rust services on Postgres",
        &cands,
    )
    .unwrap();
    assert_eq!(sel.variant_id, "v_be");
    assert_eq!(sel.cv_document_id, Some("cv_be".to_string()));
    assert!(sel.match_ratio > 0.0);
}

#[test]
fn keywords_break_a_title_tie() {
    let cands = vec![
        cand("v_a", "Specialist", &["marketing", "seo"], Some("cv_a")),
        cand("v_b", "Specialist", &["rust", "kubernetes"], Some("cv_b")),
    ];
    let sel = select_best_cv(
        "Platform Role",
        "Rust and Kubernetes heavy environment",
        &cands,
    )
    .unwrap();
    assert_eq!(sel.variant_id, "v_b");
}

#[test]
fn variant_without_cv_still_selectable() {
    let cands = vec![cand("v_x", "Data Engineer", &["spark"], None)];
    let sel = select_best_cv("Data Engineer", "spark pipelines", &cands).unwrap();
    assert_eq!(sel.variant_id, "v_x");
    assert_eq!(sel.cv_document_id, None);
}

#[test]
fn multiword_keyword_phrase_matches_in_job_text() {
    let cands = vec![
        cand(
            "v_rn",
            "Mobile Dev",
            &["react native", "expo"],
            Some("cv_rn"),
        ),
        cand("v_web", "Web Dev", &["angular", "vue"], Some("cv_web")),
    ];
    let sel = select_best_cv(
        "React Native Developer",
        "Build mobile apps using React Native and Expo",
        &cands,
    )
    .unwrap();
    assert_eq!(sel.variant_id, "v_rn");
}

#[test]
fn ties_broken_toward_first_candidate() {
    let cands = vec![
        cand("first", "Unrelated Role", &[], Some("cv_1")),
        cand("second", "Unrelated Role", &[], Some("cv_2")),
    ];
    let sel = select_best_cv("Completely Different Job", "no matching text here", &cands).unwrap();
    assert_eq!(sel.variant_id, "first");
}

#[test]
fn single_candidate_always_wins() {
    let cands = vec![cand("only", "Any Title", &["anything"], None)];
    let sel = select_best_cv("Unrelated Role", "unrelated text", &cands).unwrap();
    assert_eq!(sel.variant_id, "only");
    assert_eq!(sel.cv_document_id, None);
}

#[test]
fn match_ratio_is_between_zero_and_one() {
    let cands = vec![cand("v", "Backend Engineer", &["Rust", "PostgreSQL"], None)];
    let sel = select_best_cv("Backend Engineer", "We use Rust and PostgreSQL", &cands).unwrap();
    assert!(
        (0.0..=1.0).contains(&sel.match_ratio),
        "match_ratio out of range: {}",
        sel.match_ratio
    );
    assert!(sel.match_ratio > 0.0, "strong match should be > 0");
}
