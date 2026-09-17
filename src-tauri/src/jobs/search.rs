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

/// Google job-discovery dorks — ONE site per query (site-per-site), each emitted at increasing
/// keyword depth: 1, then 2, then 3 skills ANDed with the title. The shallow 1-keyword query casts
/// WIDE (more results); the 2- and 3-keyword queries TIGHTEN for the best-matched postings. Every
/// query stays short (1 `site:` + `intitle` + ≤3 quoted skills), which Google 2026 honours (a single
/// giant OR of ~18 sites gets rejected/emptied); `num=` is dead, so the worker paginates with
/// `&start=`.
pub fn build_google_dork(input: &SearchQueryInput) -> Vec<BuiltQuery> {
    const BOARDS: &[&str] = &[
        "site:linkedin.com/jobs",
        "site:br.indeed.com",
        "site:gupy.io",
        "site:catho.com.br",
        "site:vagas.com.br",
        "site:glassdoor.com.br",
        "site:infojobs.com.br",
        "site:inhire.app inurl:vagas",
        "site:programathor.com.br/jobs",
        "site:coodesh.com",
        "site:trampos.co",
        "site:remotar.com.br",
        "site:boards.greenhouse.io",
        "site:jobs.lever.co",
        "site:jobs.ashbyhq.com",
        "site:weworkremotely.com/remote-jobs",
        "site:remotive.com/remote-jobs",
    ];

    let cutoff = (time::OffsetDateTime::now_utc() - time::Duration::days(30)).date();
    let after = format!(
        "after:{:04}-{:02}-{:02}",
        cutoff.year(),
        u8::from(cutoff.month()),
        cutoff.day()
    );

    let title_clause = input.titles.first().map(|t| format!("intitle:\"{}\"", t));
    let skills: Vec<String> = input
        .required_skills
        .iter()
        .take(3)
        .map(|s| format!("\"{}\"", s))
        .collect();
    let remote = input
        .remote_mode
        .as_deref()
        .map(|r| r == "remote")
        .unwrap_or(false);

    // Keyword depths per board: 1..=N cumulative skills (space-separated = implicit AND). With no
    // skills, a single title-only query per board.
    let depths: Vec<usize> = if skills.is_empty() {
        vec![0]
    } else {
        (1..=skills.len()).collect()
    };

    let mut out = Vec::with_capacity(BOARDS.len() * depths.len());
    for board in BOARDS {
        for &depth in &depths {
            let mut parts = vec![(*board).to_string()];
            if let Some(t) = &title_clause {
                parts.push(t.clone());
            }
            for s in skills.iter().take(depth) {
                parts.push(s.clone());
            }
            if remote {
                parts.push("remote".into());
            }
            parts.push(after.clone());
            out.push(BuiltQuery {
                platform: "google".into(),
                query_type: "google_dork".into(),
                query_string: parts.join(" "),
            });
        }
    }
    out
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
    let mut out = vec![build_linkedin_query(input)];
    out.extend(build_google_dork(input)); // several short per-board-group google dorks
    out.push(build_hiring_posts_query(input));
    out
}

#[cfg(test)]
#[path = "../tests/jobs_search_tests.rs"]
mod tests;
