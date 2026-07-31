//! Search query builder: produces query strings from job-preference inputs.
//! Key: `SearchQueryInput` / `BuiltQuery` — the input DTO and one built query.
//! Key: `build_linkedin_query()` — boolean title/skill/remote/seniority query.
//! Key: `build_google_dork()` — multi-board `site:` dork with a last-30-days `after:` filter.
//! Key: `build_queries()` — fans an input into LinkedIn + Google + hiring-posts queries.

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
            .map(|s| {
                if s.contains(' ') {
                    format!("\"{}\"", s)
                } else {
                    s.to_string()
                }
            })
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

    let senior_markers = ["senior", "lead", "principal", "staff", "director", "head"];
    let wants_senior = input.seniority.iter().any(|s| {
        let sl = s.to_lowercase();
        senior_markers.iter().any(|m| sl.contains(m))
    });
    if !wants_senior && !input.seniority.is_empty() {
        parts.push("NOT (Senior OR Lead OR Principal OR Manager OR Director)".into());
    }

    BuiltQuery {
        platform: "linkedin".into(),
        query_type: "linkedin_search".into(),
        query_string: parts.join(" AND "),
    }
}

pub fn build_google_dork(input: &SearchQueryInput) -> BuiltQuery {
    let sites = "(site:inhire.app inurl:vagas OR site:linkedin.com/jobs OR site:br.indeed.com OR site:indeed.com OR site:catho.com.br OR site:vagas.com.br OR site:gupy.io OR site:glassdoor.com.br OR site:infojobs.com.br OR site:greenhouse.io OR site:boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:programathor.com.br/jobs OR site:coodesh.com OR site:trampos.co OR site:remotar.com.br OR site:weworkremotely.com/remote-jobs OR site:remotive.com/remote-jobs)";
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

    let cutoff = (time::OffsetDateTime::now_utc() - time::Duration::days(30)).date();
    parts.push(format!(
        "after:{:04}-{:02}-{:02}",
        cutoff.year(),
        u8::from(cutoff.month()),
        cutoff.day()
    ));

    BuiltQuery {
        platform: "google".into(),
        query_type: "google_dork".into(),
        query_string: parts.join(" "),
    }
}

pub fn build_hiring_posts_query(input: &SearchQueryInput) -> BuiltQuery {
    let mut terms: Vec<&str> = Vec::new();
    for t in &input.titles {
        terms.push(t);
    }
    for s in input.required_skills.iter().take(6) {
        terms.push(s);
    }
    BuiltQuery {
        platform: "linkedin_post".into(),
        query_type: "linkedin_search".into(),
        query_string: terms.join(", "),
    }
}

pub fn build_queries(input: &SearchQueryInput) -> Vec<BuiltQuery> {
    vec![
        build_linkedin_query(input),
        build_google_dork(input),
        build_hiring_posts_query(input),
    ]
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
    fn google_dork_includes_inhire_and_recent_filter() {
        let q = build_google_dork(&sample()).query_string;
        assert!(q.contains("site:inhire.app inurl:vagas"), "{q}");
        assert!(q.contains("site:programathor.com.br/jobs"), "{q}");
        assert!(q.contains("site:weworkremotely.com/remote-jobs"), "{q}");
        assert!(q.contains("after:"), "{q}");
        let after = q.split("after:").nth(1).unwrap().split_whitespace().next().unwrap();
        assert_eq!(after.len(), 10, "after date should be YYYY-MM-DD: {after}");
        assert_eq!(after.matches('-').count(), 2, "{after}");
    }

    #[test]
    fn build_queries_returns_three() {
        assert_eq!(build_queries(&sample()).len(), 3);
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
}
