use super::*;

fn sample() -> SearchQueryInput {
    SearchQueryInput {
        profile_id: "p1".into(),
        preference_id: None,
        titles: vec!["Senior Rust Engineer".into(), "Backend Engineer".into()],
        required_skills: vec!["Rust".into(), "Tokio".into(), "PostgreSQL".into()],
        location: Some("Berlin".into()),
        remote_mode: Some("remote".into()),
        seniority: vec!["senior".into()],
    }
}

#[test]
fn linkedin_contains_titles() {
    let q = build_linkedin_query(&sample());
    assert!(
        q.query_string.contains("Senior Rust Engineer"),
        "{}",
        q.query_string
    );
    assert!(
        q.query_string.contains("Backend Engineer"),
        "{}",
        q.query_string
    );
}

#[test]
fn linkedin_contains_skills() {
    let q = build_linkedin_query(&sample());
    assert!(q.query_string.contains("Rust"), "{}", q.query_string);
    assert!(q.query_string.contains("Tokio"), "{}", q.query_string);
}

#[test]
fn linkedin_contains_remote() {
    let q = build_linkedin_query(&sample());
    assert!(q.query_string.contains("remote"), "{}", q.query_string);
}

#[test]
fn linkedin_query_type() {
    assert_eq!(
        build_linkedin_query(&sample()).query_type,
        "linkedin_search"
    );
}

#[test]
fn google_dork_site_clause() {
    let qs = build_google_dork(&sample());
    assert!(
        qs.iter()
            .any(|q| q.query_string.contains("site:linkedin.com/jobs")),
        "{qs:?}"
    );
    assert!(
        qs.iter().any(|q| q.query_string.contains("intitle:")),
        "{qs:?}"
    );
}

#[test]
fn google_dork_query_type() {
    assert!(build_google_dork(&sample())
        .iter()
        .all(|q| q.query_type == "google_dork"));
}

#[test]
fn google_dork_short_queries_cover_boards_with_recent_filter() {
    let qs = build_google_dork(&sample());
    // Site-per-site: EXACTLY one `site:` operator per query (short → Google 2026 honours it),
    // each carrying the after: filter.
    for q in &qs {
        let sites = q.query_string.matches("site:").count();
        assert_eq!(
            sites, 1,
            "site-per-site expected exactly one site:: {}",
            q.query_string
        );
        assert!(q.query_string.contains("after:"), "{}", q.query_string);
        let after = q
            .query_string
            .split("after:")
            .nth(1)
            .unwrap()
            .split_whitespace()
            .next()
            .unwrap();
        assert_eq!(after.len(), 10, "after date should be YYYY-MM-DD: {after}");
        assert_eq!(after.matches('-').count(), 2, "{after}");
    }
    // Coverage: the key boards each still appear.
    let joined = qs
        .iter()
        .map(|q| q.query_string.as_str())
        .collect::<Vec<_>>()
        .join(" | ");
    assert!(joined.contains("site:inhire.app inurl:vagas"), "{joined}");
    assert!(joined.contains("site:programathor.com.br/jobs"), "{joined}");
    assert!(
        joined.contains("site:weworkremotely.com/remote-jobs"),
        "{joined}"
    );
}

#[test]
fn google_dork_emits_one_two_three_keyword_depths_per_site() {
    // sample() has 3 required skills → each board gets 3 queries: 1, 2, then 3 skills deep.
    let qs = build_google_dork(&sample());
    let for_linkedin: Vec<_> = qs
        .iter()
        .filter(|q| q.query_string.contains("site:linkedin.com/jobs"))
        .collect();
    assert_eq!(
        for_linkedin.len(),
        3,
        "expected 1/2/3-keyword variants per site"
    );
    // Depth = number of quoted skills; the three variants must be 1, 2 and 3.
    let mut depths: Vec<usize> = for_linkedin
        .iter()
        .map(|q| q.query_string.matches('"').count() / 2 - 1) // minus the intitle:"..." pair
        .collect();
    depths.sort_unstable();
    assert_eq!(depths, vec![1, 2, 3], "{for_linkedin:?}");
}

#[test]
fn build_queries_fans_out() {
    let qs = build_queries(&sample());
    // linkedin + several short google dorks + hiring posts.
    assert!(qs.len() > 3, "expected fan-out, got {}", qs.len());
    assert!(qs.iter().filter(|q| q.query_type == "google_dork").count() >= 5);
}

#[test]
fn hiring_posts_query_contains_title_and_marker() {
    let q = build_hiring_posts_query(&sample());
    assert!(
        q.query_string.contains("Senior Rust Engineer"),
        "{}",
        q.query_string
    );
}

#[test]
fn empty_input_no_panic() {
    let input = SearchQueryInput {
        profile_id: "p1".into(),
        preference_id: None,
        titles: vec![],
        required_skills: vec![],
        location: None,
        remote_mode: None,
        seniority: vec![],
    };
    let _ = build_queries(&input);
}

#[test]
fn linkedin_not_exclusion_for_junior() {
    let mut input = sample();
    input.seniority = vec!["junior".into()];
    let q = build_linkedin_query(&input);
    assert!(q.query_string.contains("NOT"), "{}", q.query_string);
    assert!(q.query_string.contains("Senior"), "{}", q.query_string);
}

#[test]
fn linkedin_no_not_exclusion_for_senior() {
    let q = build_linkedin_query(&sample());
    assert!(!q.query_string.contains("NOT"), "{}", q.query_string);
}

#[test]
fn linkedin_and_joins_groups() {
    let q = build_linkedin_query(&sample());
    assert!(q.query_string.contains(" AND "), "{}", q.query_string);
}

#[test]
fn linkedin_no_location_in_keywords() {
    let q = build_linkedin_query(&sample());
    assert!(!q.query_string.contains("Berlin"), "{}", q.query_string);
}

#[test]
fn linkedin_quotes_multiword_skills_only() {
    let mut input = sample();
    input.required_skills = vec!["Spring Boot".into(), "Java".into()];
    let q = build_linkedin_query(&input);
    assert!(
        q.query_string.contains("\"Spring Boot\""),
        "{}",
        q.query_string
    );
    assert!(!q.query_string.contains("\"Java\""), "{}", q.query_string);
    assert!(q.query_string.contains("Java"), "{}", q.query_string);
}
