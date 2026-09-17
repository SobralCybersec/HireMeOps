use super::*;

fn base() -> MatchInput {
    MatchInput {
        job_title: "Senior Rust Backend Engineer".into(),
        job_text: "We use Rust, Tokio, PostgreSQL and Kubernetes to build services".into(),
        job_company: "Acme".into(),
        job_seniority: Some("senior".into()),
        job_location: Some("Berlin, Germany".into()),
        job_remote_mode: Some("remote".into()),
        job_salary_min: Some(90_000),
        job_salary_max: Some(120_000),
        target_roles: vec!["Backend Engineer".into(), "Rust Engineer".into()],
        pref_seniority: vec!["senior".into()],
        pref_locations: vec!["Berlin".into()],
        pref_remote_modes: vec!["remote".into()],
        required_skills: vec!["Rust".into(), "PostgreSQL".into()],
        preferred_skills: vec!["Kubernetes".into(), "Tokio".into()],
        excluded_keywords: vec!["unpaid".into()],
        blocked_companies: vec!["EvilCorp".into()],
        min_salary: Some(80_000),
        auto_submit_min_score: 60,
        needs_review_threshold: 50,
    }
}

#[test]
fn strong_match_auto_applies() {
    let s = score_job(&base());
    assert!(s.score >= 85, "expected high score, got {}", s.score);
    assert_eq!(s.recommendation, Recommendation::AutoApply);
    assert_eq!(s.role_score, 100);
    assert_eq!(s.skill_score, 100);
    assert_eq!(s.seniority_score, 100);
    assert_eq!(s.location_score, 100);
    assert_eq!(s.salary_score, 100);
    assert!(s.missing_skills.is_empty());
    assert_eq!(s.matched_skills.len(), 4);
    assert!(s.risk_flags.is_empty());
}

#[test]
fn blocked_company_forces_skip() {
    let mut i = base();
    i.job_company = "EvilCorp".into();
    let s = score_job(&i);
    assert_eq!(s.recommendation, Recommendation::Skip);
    assert!(s
        .risk_flags
        .iter()
        .any(|f| f.starts_with("blocked_company:")));
}

#[test]
fn excluded_keyword_forces_skip() {
    let mut i = base();
    i.job_text = "This is an unpaid internship".into();
    let s = score_job(&i);
    assert_eq!(s.recommendation, Recommendation::Skip);
    assert!(s
        .risk_flags
        .iter()
        .any(|f| f.starts_with("excluded_keyword:")));
}

#[test]
fn remote_job_with_null_remote_mode_scores_on_location_text() {
    let mut i = base();
    i.job_remote_mode = None;
    i.job_location = Some("Remote".into());
    i.pref_locations.clear();
    i.pref_remote_modes = vec!["Remote".into()];
    assert_eq!(compute_location(&i), 100);

    i.job_location = Some("Remoto".into());
    assert_eq!(compute_location(&i), 100);
}

#[test]
fn weak_match_saves_for_later() {
    let mut i = base();
    i.job_title = "Junior Marketing Coordinator".into();
    i.job_text = "Social media, copywriting, campaigns".into();
    i.job_seniority = Some("junior".into());
    i.job_location = Some("Tokyo".into());
    i.job_remote_mode = Some("onsite".into());
    i.job_salary_min = Some(20_000);
    i.job_salary_max = Some(30_000);
    let s = score_job(&i);
    assert!(s.score < 50, "expected low score, got {}", s.score);
    assert_eq!(s.recommendation, Recommendation::SaveForLater);
    assert!(!s.missing_skills.is_empty());
}

#[test]
fn mid_match_routes_to_review() {
    let mut i = base();
    i.job_title = "Backend Developer".into();
    i.job_text = "We use Rust for some services".into();
    i.pref_locations.clear();
    i.pref_remote_modes.clear();
    i.min_salary = None;
    let s = score_job(&i);
    assert!(
        (i.needs_review_threshold..i.auto_submit_min_score).contains(&s.score),
        "expected review band, got {}",
        s.score
    );
    assert_eq!(s.recommendation, Recommendation::ReviewFirst);
}

#[test]
fn empty_preference_is_neutral_not_punishing() {
    let mut i = base();
    i.target_roles.clear();
    i.pref_seniority.clear();
    i.pref_locations.clear();
    i.pref_remote_modes.clear();
    i.required_skills.clear();
    i.preferred_skills.clear();
    i.min_salary = None;
    let s = score_job(&i);
    assert!(s.score >= 55 && s.score <= 75, "got {}", s.score);
}

#[test]
fn multiword_skill_phrase_matches() {
    let mut i = base();
    i.required_skills = vec!["react native".into()];
    i.preferred_skills.clear();
    i.job_text = "Build mobile apps with React Native and TypeScript".into();
    let s = score_job(&i);
    assert!(s.matched_skills.contains(&"react native".to_string()));
    assert_eq!(s.skill_score, 100);
}

#[test]
fn recommendation_strings_match_check_constraint() {
    assert_eq!(Recommendation::AutoApply.as_str(), "auto_apply");
    assert_eq!(Recommendation::ReviewFirst.as_str(), "review_first");
    assert_eq!(Recommendation::Skip.as_str(), "skip");
    assert_eq!(Recommendation::SaveForLater.as_str(), "save_for_later");
}

#[test]
fn salary_below_minimum_gives_partial_credit() {
    let mut i = base();
    i.job_salary_max = Some(50_000);
    i.job_salary_min = Some(40_000);
    let s = score_job(&i);
    assert!(
        s.salary_score < 60,
        "salary_score should be below neutral (60), got {}",
        s.salary_score
    );
    assert!(s.salary_score > 0, "should still get partial credit");
}

#[test]
fn salary_no_disclosure_gives_neutral() {
    let mut i = base();
    i.job_salary_min = None;
    i.job_salary_max = None;
    let s = score_job(&i);
    assert_eq!(s.salary_score, NEUTRAL_SALARY);
}

#[test]
fn seniority_mismatch_scores_thirty() {
    let mut i = base();
    i.job_seniority = Some("junior".into());
    let s = score_job(&i);
    assert_eq!(s.seniority_score, 30);
}

#[test]
fn seniority_read_from_title_with_pleno_mid_synonym() {
    let mut i = base();
    i.job_seniority = None;
    i.job_title = "Desenvolvedor Backend Pleno".into();
    i.pref_seniority = vec!["mid".into()];
    assert_eq!(score_job(&i).seniority_score, 100);

    let mut j = base();
    j.job_seniority = None;
    j.job_title = "Backend Developer".into();
    j.job_text = "Looking for a Sr. engineer with Rust.".into();
    j.pref_seniority = vec!["senior".into()];
    assert_eq!(score_job(&j).seniority_score, 100);
}

#[test]
fn onsite_job_with_remote_pref_scores_low() {
    let mut i = base();
    i.job_location = Some("Tokyo, Japan".into());
    i.job_remote_mode = Some("onsite".into());
    let s = score_job(&i);
    assert_eq!(s.location_score, 10);
}

#[test]
fn presencial_text_overrides_filter_stamped_remote_mode() {
    let mut i = base();
    i.job_title = "Desenvolvedor Backend (Presencial)".into();
    i.job_text = "Vaga presencial no escritório em São Paulo.".into();
    i.job_remote_mode = Some("remote".into());
    i.pref_locations.clear();
    i.pref_remote_modes = vec!["remote".into()];
    assert_eq!(compute_location(&i), 10);
}

#[test]
fn hybrid_job_scores_partial_for_remote_seeker() {
    let mut i = base();
    i.job_title = "Engenheiro (Híbrido)".into();
    i.job_remote_mode = None;
    i.pref_locations.clear();
    i.pref_remote_modes = vec!["remote".into()];
    assert_eq!(compute_location(&i), 80);
}

#[test]
fn remote_mode_match_gives_full_location_score() {
    let mut i = base();
    i.pref_locations.clear();
    i.pref_remote_modes = vec!["remote".into()];
    i.job_remote_mode = Some("remote".into());
    let s = score_job(&i);
    assert_eq!(s.location_score, 100);
}

#[test]
fn missing_required_skill_adds_risk_flag() {
    let mut i = base();
    i.job_title = "Software Engineer".into();
    i.job_text = "We build with Go and Kubernetes".into();
    let s = score_job(&i);
    assert!(
        s.risk_flags
            .iter()
            .any(|f| f.starts_with("missing_required_skills:")),
        "expected missing_required_skills flag, got: {:?}",
        s.risk_flags
    );
    assert!(s.missing_skills.contains(&"Rust".to_string()));
    assert!(s.missing_skills.contains(&"PostgreSQL".to_string()));
}

#[test]
fn normalize_tokens_drops_stopwords_and_short_tokens() {
    let tokens = normalize_tokens("the quick brown fox and a cat");
    assert!(!tokens.contains("the"), "stopword 'the' should be dropped");
    assert!(!tokens.contains("and"), "stopword 'and' should be dropped");
    assert!(!tokens.contains("a"), "single-char should be dropped");
    assert!(tokens.contains("quick"));
    assert!(tokens.contains("brown"));
    assert!(tokens.contains("fox"));
    assert!(tokens.contains("cat"));
}

#[test]
fn preferred_only_skill_still_scores_coverage() {
    let mut i = base();
    i.required_skills.clear();
    i.preferred_skills = vec!["Kubernetes".into(), "Tokio".into()];
    let s = score_job(&i);
    assert_eq!(
        s.skill_score, 100,
        "100% preferred coverage → skill_score 100"
    );
    assert!(s.matched_skills.contains(&"Kubernetes".to_string()));
}
