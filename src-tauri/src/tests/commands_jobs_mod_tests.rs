use super::*;

#[test]
fn row_mappers_preserve_nullable_values_and_boolean_flags() {
    let preference = JobPreferenceDto::from(PrefRow {
        id: "pref".into(),
        profile_id: "profile".into(),
        name: "Backend".into(),
        target_roles_json: "[]".into(),
        seniority_json: None,
        locations_json: None,
        remote_modes_json: None,
        min_salary: None,
        salary_currency: None,
        required_skills_json: None,
        preferred_skills_json: None,
        excluded_keywords_json: None,
        blocked_companies_json: None,
        auto_apply_enabled: 1,
        auto_submit_enabled: 0,
        auto_submit_min_score: 70,
        needs_review_confidence_threshold: 60,
        retry_failed_enabled: 1,
        retry_limit: 3,
        daily_application_limit: Some(5),
        daily_connection_limit: None,
        created_at: "created".into(),
        updated_at: "updated".into(),
    });
    assert!(preference.auto_apply_enabled);
    assert!(!preference.auto_submit_enabled);
    assert_eq!(preference.daily_application_limit, Some(5));

    let query = SearchQueryDto::from(SqRow {
        id: "query".into(),
        profile_id: "profile".into(),
        preference_id: Some("pref".into()),
        platform: "linkedin".into(),
        query: "rust".into(),
        query_type: "keyword".into(),
        enabled: 0,
        last_run_at: None,
        created_at: "created".into(),
    });
    assert!(!query.enabled);
    assert_eq!(query.preference_id.as_deref(), Some("pref"));

    let job = JobPostDto::from(JobRow {
        id: "job".into(),
        profile_id: Some("profile".into()),
        platform: "indeed".into(),
        external_id: None,
        url: "https://jobs.test/1".into(),
        canonical_url: Some("https://jobs.test/1".into()),
        title: "Backend".into(),
        company: "Example".into(),
        location: None,
        remote_mode: Some("remote".into()),
        description: String::new(),
        summary: None,
        seniority: None,
        salary_min: None,
        salary_max: None,
        currency: None,
        employment_type: None,
        discovered_at: "now".into(),
        status: "discovered".into(),
        search_query_id: None,
        discovery_source: None,
        contact_email: None,
    });
    assert!(job.description.is_none());
    assert_eq!(job.remote_mode.as_deref(), Some("remote"));

    let matched = JobMatchDto::from(MatchRow {
        id: "match".into(),
        job_id: "job".into(),
        profile_id: "profile".into(),
        preference_id: None,
        score: 90,
        role_score: Some(30),
        skill_score: Some(30),
        seniority_score: Some(15),
        location_score: Some(10),
        salary_score: Some(5),
        matched_skills_json: Some("[]".into()),
        missing_skills_json: None,
        risk_flags_json: None,
        recommendation: "auto_apply".into(),
        explanation: None,
        model_provider: None,
        model_name: None,
        created_at: "now".into(),
    });
    assert_eq!(matched.score, 90);
    assert_eq!(matched.recommendation, "auto_apply");
    assert_eq!(matched.matched_skills_json.as_deref(), Some("[]"));
}
