//! Search query builder — produce query strings from job-preference inputs.
//! The browser adapter that actually runs the search is out of scope here.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryInput {
    pub profile_id: String,
    pub preference_id: Option<String>,
    pub titles: Vec<String>,
    pub required_skills: Vec<String>,
    pub location: Option<String>,
    pub remote_mode: Option<String>,
    pub seniority: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltQuery {
    pub platform: String,
    pub query_type: String,
    pub query_string: String,
}

/// LinkedIn keyword search: `("Title A" OR "Title B") ("Skill1" OR "Skill2") remote`
pub fn build_linkedin_query(input: &SearchQueryInput) -> BuiltQuery {
    let mut parts: Vec<String> = Vec::new();

    if !input.titles.is_empty() {
        let inner = input
            .titles
            .iter()
            .map(|t| format!("\"{}\"", t))
            .collect::<Vec<_>>()
            .join(" OR ");
        parts.push(if input.titles.len() > 1 {
            format!("({})", inner)
        } else {
            inner
        });
    }

    let skills: Vec<_> = input.required_skills.iter().take(5).collect();
    if !skills.is_empty() {
        let inner = skills
            .iter()
            .map(|s| format!("\"{}\"", s))
            .collect::<Vec<_>>()
            .join(" OR ");
        parts.push(if skills.len() > 1 {
            format!("({})", inner)
        } else {
            inner
        });
    }

    if input
        .remote_mode
        .as_deref()
        .map(|r| r.contains("remote"))
        .unwrap_or(false)
    {
        parts.push("remote".into());
    }

    if let Some(loc) = &input.location {
        if !loc.is_empty() {
            parts.push(loc.clone());
        }
    }

    BuiltQuery {
        platform: "linkedin".into(),
        query_type: "linkedin_search".into(),
        query_string: parts.join(" "),
    }
}

/// Google dork: `(site:linkedin.com/jobs OR site:greenhouse.io) intitle:"Title" Skill1 remote`
pub fn build_google_dork(input: &SearchQueryInput) -> BuiltQuery {
    let sites = "(site:linkedin.com/jobs OR site:greenhouse.io OR site:lever.co OR site:boards.greenhouse.io)";
    let mut parts = vec![sites.to_owned()];

    if let Some(title) = input.titles.first() {
        parts.push(format!("intitle:\"{}\"", title));
    }

    for skill in input.required_skills.iter().take(3) {
        parts.push(skill.clone());
    }

    if input
        .remote_mode
        .as_deref()
        .map(|r| r == "remote")
        .unwrap_or(false)
    {
        parts.push("remote".into());
    }

    if let Some(loc) = &input.location {
        if !loc.is_empty() {
            parts.push(format!("\"{}\"", loc));
        }
    }

    BuiltQuery {
        platform: "google".into(),
        query_type: "google_dork".into(),
        query_string: parts.join(" "),
    }
}

/// Build all relevant queries for the given input.
pub fn build_queries(input: &SearchQueryInput) -> Vec<BuiltQuery> {
    vec![build_linkedin_query(input), build_google_dork(input)]
}

#[cfg(test)]
mod tests {
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
        let q = build_google_dork(&sample());
        assert!(
            q.query_string.contains("site:linkedin.com/jobs"),
            "{}",
            q.query_string
        );
        assert!(q.query_string.contains("intitle:"), "{}", q.query_string);
    }

    #[test]
    fn google_dork_query_type() {
        assert_eq!(build_google_dork(&sample()).query_type, "google_dork");
    }

    #[test]
    fn build_queries_returns_two() {
        assert_eq!(build_queries(&sample()).len(), 2);
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
        // must not panic
        let _ = build_queries(&input);
    }
}
