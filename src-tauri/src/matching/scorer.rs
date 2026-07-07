//! Deterministic job-match scorer.
//!
//! Produces five sub-scores (0–100), a weighted overall score, matched/missing
//! skill sets, risk flags, and a routing recommendation. All inputs come from
//! the job post and the saved preference — no profile facts and no AI required.

use std::collections::BTreeSet;

/// Default auto-submit threshold (mirrors `job_preferences.auto_submit_min_score`).
pub const AUTO_SUBMIT_DEFAULT: u8 = 60;
/// Default needs-review threshold (mirrors `needs_review_confidence_threshold`).
pub const NEEDS_REVIEW_DEFAULT: u8 = 50;

// Sub-score weights (sum = 1.0).
const W_ROLE: f32 = 0.30;
const W_SKILL: f32 = 0.35;
const W_SENIORITY: f32 = 0.10;
const W_LOCATION: f32 = 0.15;
const W_SALARY: f32 = 0.10;

// Neutral fallbacks when the preference is silent on a dimension: we neither
// reward nor punish, so a thin preference doesn't tank an otherwise-good job.
const NEUTRAL_SENIORITY: u8 = 70;
const NEUTRAL_LOCATION: u8 = 70;
const NEUTRAL_SALARY: u8 = 60;

/// Everything the scorer needs, already parsed out of the DB rows.
#[derive(Debug, Clone, Default)]
pub struct MatchInput {
    // ── Job post ──
    pub job_title: String,
    /// Description + summary concatenated; the skill/keyword haystack.
    pub job_text: String,
    pub job_company: String,
    pub job_seniority: Option<String>,
    pub job_location: Option<String>,
    pub job_remote_mode: Option<String>,
    pub job_salary_min: Option<i64>,
    pub job_salary_max: Option<i64>,
    // ── Preference ──
    pub target_roles: Vec<String>,
    pub pref_seniority: Vec<String>,
    pub pref_locations: Vec<String>,
    pub pref_remote_modes: Vec<String>,
    pub required_skills: Vec<String>,
    pub preferred_skills: Vec<String>,
    pub excluded_keywords: Vec<String>,
    pub blocked_companies: Vec<String>,
    pub min_salary: Option<i64>,
    // ── Thresholds ──
    pub auto_submit_min_score: u8,
    pub needs_review_threshold: u8,
}

/// Routing recommendation. `as_str` values match the `job_matches.recommendation`
/// CHECK constraint exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recommendation {
    AutoApply,
    ReviewFirst,
    Skip,
    SaveForLater,
}

impl Recommendation {
    pub fn as_str(self) -> &'static str {
        match self {
            Recommendation::AutoApply => "auto_apply",
            Recommendation::ReviewFirst => "review_first",
            Recommendation::Skip => "skip",
            Recommendation::SaveForLater => "save_for_later",
        }
    }
}

/// Full scoring result.
#[derive(Debug, Clone)]
pub struct MatchScore {
    pub score: u8,
    pub role_score: u8,
    pub skill_score: u8,
    pub seniority_score: u8,
    pub location_score: u8,
    pub salary_score: u8,
    pub matched_skills: Vec<String>,
    pub missing_skills: Vec<String>,
    pub risk_flags: Vec<String>,
    pub recommendation: Recommendation,
}

/// Lowercase, split on non-alphanumerics, drop very short/stopword tokens.
/// Public so `cv_selector` and callers can tokenise consistently.
pub fn normalize_tokens(text: &str) -> BTreeSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter_map(|raw| {
            let t = raw.trim().to_lowercase();
            if t.len() < 2 || is_stopword(&t) {
                None
            } else {
                Some(t)
            }
        })
        .collect()
}

fn is_stopword(t: &str) -> bool {
    matches!(
        t,
        "the" | "and" | "for" | "with" | "you" | "our" | "are" | "will" | "our's" | "a" | "an"
            | "to" | "of" | "in" | "on" | "at" | "as" | "is" | "be" | "or"
    )
}

/// Does a multi-word phrase (e.g. a skill like "react native") appear in the
/// haystack? Single-token phrases match on the token set; multi-token phrases
/// match as a contiguous lowercase substring (whitespace-normalised).
fn phrase_present(phrase: &str, hay_tokens: &BTreeSet<String>, hay_lower: &str) -> bool {
    let p = phrase.trim().to_lowercase();
    if p.is_empty() {
        return false;
    }
    if p.split_whitespace().count() > 1 {
        hay_lower.contains(&p)
    } else {
        hay_tokens.contains(&p)
    }
}

/// Fraction (0.0–1.0) of `needles` present in the haystack.
fn coverage(needles: &[String], hay_tokens: &BTreeSet<String>, hay_lower: &str) -> f32 {
    if needles.is_empty() {
        return 0.0;
    }
    let hits = needles
        .iter()
        .filter(|n| phrase_present(n, hay_tokens, hay_lower))
        .count();
    hits as f32 / needles.len() as f32
}

fn pct(x: f32) -> u8 {
    (x.clamp(0.0, 1.0) * 100.0).round() as u8
}

/// Score a single job against a single preference.
pub fn score_job(input: &MatchInput) -> MatchScore {
    let title_lower = input.job_title.to_lowercase();
    let title_tokens = normalize_tokens(&input.job_title);
    let text_lower = format!("{} {}", title_lower, input.job_text.to_lowercase());
    let text_tokens = normalize_tokens(&text_lower);

    // ── Role: best target-role token overlap against the title ──
    let role_score = if input.target_roles.is_empty() {
        NEUTRAL_SENIORITY // no target roles declared → neutral, don't punish
    } else {
        let best = input
            .target_roles
            .iter()
            .map(|role| {
                let rt = normalize_tokens(role);
                if rt.is_empty() {
                    return 0.0;
                }
                // Prefer a full-phrase hit; otherwise token-overlap ratio.
                if title_lower.contains(&role.trim().to_lowercase()) {
                    1.0
                } else {
                    let hit = rt.iter().filter(|t| title_tokens.contains(*t)).count();
                    hit as f32 / rt.len() as f32
                }
            })
            .fold(0.0_f32, f32::max);
        pct(best)
    };

    // ── Skill: required (weight 0.7) + preferred (weight 0.3) coverage ──
    let req_cov = coverage(&input.required_skills, &text_tokens, &text_lower);
    let pref_cov = coverage(&input.preferred_skills, &text_tokens, &text_lower);
    let skill_score = match (
        input.required_skills.is_empty(),
        input.preferred_skills.is_empty(),
    ) {
        (true, true) => NEUTRAL_SALARY, // no skills declared → neutral
        (false, true) => pct(req_cov),
        (true, false) => pct(pref_cov),
        (false, false) => pct(0.7 * req_cov + 0.3 * pref_cov),
    };

    // Matched / missing skill lists (required + preferred, deduped by order).
    let mut matched = Vec::new();
    let mut missing = Vec::new();
    for skill in input.required_skills.iter().chain(input.preferred_skills.iter()) {
        if matched.contains(skill) || missing.contains(skill) {
            continue;
        }
        if phrase_present(skill, &text_tokens, &text_lower) {
            matched.push(skill.clone());
        } else {
            missing.push(skill.clone());
        }
    }

    // ── Seniority: is the job's level in the preferred set? ──
    let seniority_score = if input.pref_seniority.is_empty() {
        NEUTRAL_SENIORITY
    } else {
        match &input.job_seniority {
            Some(js) if !js.trim().is_empty() => {
                let jl = js.to_lowercase();
                if input
                    .pref_seniority
                    .iter()
                    .any(|p| jl.contains(&p.to_lowercase()) || p.to_lowercase().contains(&jl))
                {
                    100
                } else {
                    30
                }
            }
            _ => NEUTRAL_SENIORITY, // job didn't declare a level → don't punish
        }
    };

    // ── Location: remote-mode match OR location match ──
    let location_score = compute_location(input);

    // ── Salary: does the job's ceiling clear the preferred floor? ──
    let salary_score = compute_salary(input);

    // ── Weighted overall ──
    let overall = W_ROLE * role_score as f32
        + W_SKILL * skill_score as f32
        + W_SENIORITY * seniority_score as f32
        + W_LOCATION * location_score as f32
        + W_SALARY * salary_score as f32;
    let score = overall.round().clamp(0.0, 100.0) as u8;

    // ── Risk flags + hard gates ──
    let mut risk_flags = Vec::new();
    let company_lower = input.job_company.to_lowercase();
    let blocked = input.blocked_companies.iter().any(|c| {
        let c = c.trim().to_lowercase();
        !c.is_empty() && (company_lower.contains(&c) || c.contains(&company_lower))
    });
    if blocked {
        risk_flags.push(format!("blocked_company:{}", input.job_company));
    }
    for kw in &input.excluded_keywords {
        let k = kw.trim().to_lowercase();
        if !k.is_empty() && text_lower.contains(&k) {
            risk_flags.push(format!("excluded_keyword:{kw}"));
        }
    }
    if !missing.is_empty() && !input.required_skills.is_empty() {
        let missing_required = input
            .required_skills
            .iter()
            .filter(|s| missing.contains(*s))
            .count();
        if missing_required > 0 {
            risk_flags.push(format!("missing_required_skills:{missing_required}"));
        }
    }

    let auto_min = if input.auto_submit_min_score == 0 {
        AUTO_SUBMIT_DEFAULT
    } else {
        input.auto_submit_min_score
    };
    let review_min = if input.needs_review_threshold == 0 {
        NEEDS_REVIEW_DEFAULT
    } else {
        input.needs_review_threshold
    };

    // Hard gate: a blocked company or excluded keyword always routes to skip.
    let hard_skip = blocked
        || risk_flags.iter().any(|f| f.starts_with("excluded_keyword:"));
    let recommendation = if hard_skip {
        Recommendation::Skip
    } else if score >= auto_min {
        Recommendation::AutoApply
    } else if score >= review_min {
        Recommendation::ReviewFirst
    } else {
        Recommendation::SaveForLater
    };

    MatchScore {
        score,
        role_score,
        skill_score,
        seniority_score,
        location_score,
        salary_score,
        matched_skills: matched,
        missing_skills: missing,
        risk_flags,
        recommendation,
    }
}

fn compute_location(input: &MatchInput) -> u8 {
    let has_pref = !input.pref_locations.is_empty() || !input.pref_remote_modes.is_empty();
    if !has_pref {
        return NEUTRAL_LOCATION;
    }
    // Remote-mode match is the strongest signal.
    if let Some(rm) = &input.job_remote_mode {
        let rml = rm.to_lowercase();
        if input
            .pref_remote_modes
            .iter()
            .any(|p| p.to_lowercase() == rml || rml.contains(&p.to_lowercase()))
        {
            return 100;
        }
    }
    // Otherwise fall back to a location string match.
    if let Some(loc) = &input.job_location {
        let ll = loc.to_lowercase();
        if input
            .pref_locations
            .iter()
            .any(|p| !p.trim().is_empty() && ll.contains(&p.to_lowercase()))
        {
            return 100;
        }
    }
    // Preference exists but nothing matched.
    20
}

fn compute_salary(input: &MatchInput) -> u8 {
    let floor = match input.min_salary {
        Some(f) if f > 0 => f,
        _ => return NEUTRAL_SALARY, // no floor set → neutral
    };
    // Use the job's ceiling if present, else its floor.
    let ceiling = input.job_salary_max.or(input.job_salary_min);
    match ceiling {
        None => NEUTRAL_SALARY, // job didn't disclose → don't punish
        Some(c) if c >= floor => 100,
        Some(c) => {
            // Partial credit proportional to how close the ceiling is.
            let ratio = c as f32 / floor as f32;
            pct(ratio * 0.8) // cap partial credit below a true clear
        }
    }
}

#[cfg(test)]
mod tests {
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
        assert!(s.risk_flags.iter().any(|f| f.starts_with("blocked_company:")));
    }

    #[test]
    fn excluded_keyword_forces_skip() {
        let mut i = base();
        i.job_text = "This is an unpaid internship".into();
        let s = score_job(&i);
        assert_eq!(s.recommendation, Recommendation::Skip);
        assert!(s.risk_flags.iter().any(|f| f.starts_with("excluded_keyword:")));
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
        // Partial role + partial skills, neutral elsewhere → review band [50,60).
        let mut i = base();
        i.job_title = "Backend Developer".into(); // matches "backend", not "engineer"/"rust"
        i.job_text = "We use Rust for some services".into(); // Rust yes, PostgreSQL no
        i.pref_locations.clear(); // neutral location
        i.pref_remote_modes.clear();
        i.min_salary = None; // neutral salary
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
        // All-neutral fallbacks land in a middling band, never 0.
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
}
