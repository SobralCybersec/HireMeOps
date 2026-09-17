//! Deterministic job-match scorer.
//!
//! Key: score_job — weighted overall score, matched/missing skills, risk flags, recommendation gating
//! Key: compute_location — remote/onsite/hybrid text vs preference, with hard penalties on mismatch
//! Key: compute_salary — job ceiling vs preferred floor, partial credit when below
//! Key: excluded_keywords / blocked_companies — hard-skip calibration filters in score_job

use std::collections::BTreeSet;

pub const AUTO_SUBMIT_DEFAULT: u8 = 60;
pub const NEEDS_REVIEW_DEFAULT: u8 = 50;

const W_ROLE: f32 = 0.30;
const W_SKILL: f32 = 0.35;
const W_SENIORITY: f32 = 0.10;
const W_LOCATION: f32 = 0.15;
const W_SALARY: f32 = 0.10;

const NEUTRAL_SENIORITY: u8 = 70;
const NEUTRAL_LOCATION: u8 = 70;
const NEUTRAL_SALARY: u8 = 60;

#[derive(Debug, Clone, Default)]
pub struct MatchInput {
    pub job_title: String,
    pub job_text: String,
    pub job_company: String,
    pub job_seniority: Option<String>,
    pub job_location: Option<String>,
    pub job_remote_mode: Option<String>,
    pub job_salary_min: Option<i64>,
    pub job_salary_max: Option<i64>,
    pub target_roles: Vec<String>,
    pub pref_seniority: Vec<String>,
    pub pref_locations: Vec<String>,
    pub pref_remote_modes: Vec<String>,
    pub required_skills: Vec<String>,
    pub preferred_skills: Vec<String>,
    pub excluded_keywords: Vec<String>,
    pub blocked_companies: Vec<String>,
    pub min_salary: Option<i64>,
    pub auto_submit_min_score: u8,
    pub needs_review_threshold: u8,
}

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
        "the"
            | "and"
            | "for"
            | "with"
            | "you"
            | "our"
            | "are"
            | "will"
            | "our's"
            | "a"
            | "an"
            | "to"
            | "of"
            | "in"
            | "on"
            | "at"
            | "as"
            | "is"
            | "be"
            | "or"
    )
}

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

struct SkillScores {
    score: u8,
    matched: Vec<String>,
    missing: Vec<String>,
}

struct RiskAssessment {
    flags: Vec<String>,
    hard_skip: bool,
}

fn score_role(input: &MatchInput, title_lower: &str, title_tokens: &BTreeSet<String>) -> u8 {
    if input.target_roles.is_empty() {
        return NEUTRAL_SENIORITY;
    }
    let best = input
        .target_roles
        .iter()
        .map(|role| {
            let role_tokens = normalize_tokens(role);
            if role_tokens.is_empty() {
                return 0.0;
            }
            if title_lower.contains(&role.trim().to_lowercase()) {
                1.0
            } else {
                let hit = role_tokens
                    .iter()
                    .filter(|token| title_tokens.contains(*token))
                    .count();
                hit as f32 / role_tokens.len() as f32
            }
        })
        .fold(0.0_f32, f32::max);
    pct(best)
}

fn score_skills(
    input: &MatchInput,
    text_tokens: &BTreeSet<String>,
    text_lower: &str,
) -> SkillScores {
    let required = coverage(&input.required_skills, text_tokens, text_lower);
    let preferred = coverage(&input.preferred_skills, text_tokens, text_lower);
    let score = match (
        input.required_skills.is_empty(),
        input.preferred_skills.is_empty(),
    ) {
        (true, true) => NEUTRAL_SALARY,
        (false, true) => pct(required),
        (true, false) => pct(preferred),
        (false, false) => pct(0.7 * required + 0.3 * preferred),
    };
    let mut matched = Vec::new();
    let mut missing = Vec::new();
    for skill in input
        .required_skills
        .iter()
        .chain(input.preferred_skills.iter())
    {
        if matched.contains(skill) || missing.contains(skill) {
            continue;
        }
        if phrase_present(skill, text_tokens, text_lower) {
            matched.push(skill.clone());
        } else {
            missing.push(skill.clone());
        }
    }
    SkillScores {
        score,
        matched,
        missing,
    }
}

fn score_seniority(input: &MatchInput) -> u8 {
    if input.pref_seniority.is_empty() {
        return NEUTRAL_SENIORITY;
    }
    let job_level = input
        .job_seniority
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .and_then(canon_level)
        .or_else(|| classify_seniority(&format!("{} {}", input.job_title, input.job_text)));
    match job_level {
        Some(level)
            if input
                .pref_seniority
                .iter()
                .filter_map(|preference| canon_level(preference))
                .any(|preference| preference == level) =>
        {
            100
        }
        Some(_) => 30,
        None => NEUTRAL_SENIORITY,
    }
}

fn assess_risk(input: &MatchInput, text_lower: &str, missing: &[String]) -> RiskAssessment {
    let blocked = is_blocked_company(input);
    let mut flags = Vec::new();
    if blocked {
        flags.push(format!("blocked_company:{}", input.job_company));
    }
    flags.extend(excluded_keyword_flags(input, text_lower));
    if let Some(flag) = missing_required_flag(input, missing) {
        flags.push(flag);
    }
    let hard_skip = blocked
        || flags
            .iter()
            .any(|flag| flag.starts_with("excluded_keyword:"));
    RiskAssessment { flags, hard_skip }
}

fn is_blocked_company(input: &MatchInput) -> bool {
    let company_lower = input.job_company.to_lowercase();
    input.blocked_companies.iter().any(|company| {
        let company = company.trim().to_lowercase();
        !company.is_empty()
            && (company_lower.contains(&company) || company.contains(&company_lower))
    })
}

fn excluded_keyword_flags(input: &MatchInput, text_lower: &str) -> Vec<String> {
    input
        .excluded_keywords
        .iter()
        .filter_map(|keyword| {
            let keyword_lower = keyword.trim().to_lowercase();
            (!keyword_lower.is_empty() && text_lower.contains(&keyword_lower))
                .then(|| format!("excluded_keyword:{keyword}"))
        })
        .collect()
}

fn missing_required_flag(input: &MatchInput, missing: &[String]) -> Option<String> {
    if missing.is_empty() || input.required_skills.is_empty() {
        return None;
    }
    let count = input
        .required_skills
        .iter()
        .filter(|skill| missing.contains(*skill))
        .count();
    (count > 0).then(|| format!("missing_required_skills:{count}"))
}

fn recommendation(score: u8, hard_skip: bool, input: &MatchInput) -> Recommendation {
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
    if hard_skip {
        Recommendation::Skip
    } else if score >= auto_min {
        Recommendation::AutoApply
    } else if score >= review_min {
        Recommendation::ReviewFirst
    } else {
        Recommendation::SaveForLater
    }
}

pub fn score_job(input: &MatchInput) -> MatchScore {
    let title_lower = input.job_title.to_lowercase();
    let title_tokens = normalize_tokens(&input.job_title);
    let text_lower = format!("{} {}", title_lower, input.job_text.to_lowercase());
    let text_tokens = normalize_tokens(&text_lower);
    let role_score = score_role(input, &title_lower, &title_tokens);
    let skills = score_skills(input, &text_tokens, &text_lower);
    let seniority_score = score_seniority(input);
    let location_score = compute_location(input);
    let salary_score = compute_salary(input);
    let overall = W_ROLE * role_score as f32
        + W_SKILL * skills.score as f32
        + W_SENIORITY * seniority_score as f32
        + W_LOCATION * location_score as f32
        + W_SALARY * salary_score as f32;
    let score = overall.round().clamp(0.0, 100.0) as u8;
    let risk = assess_risk(input, &text_lower, &skills.missing);
    let recommendation = recommendation(score, risk.hard_skip, input);
    MatchScore {
        score,
        role_score,
        skill_score: skills.score,
        seniority_score,
        location_score,
        salary_score,
        matched_skills: skills.matched,
        missing_skills: skills.missing,
        risk_flags: risk.flags,
        recommendation,
    }
}

pub fn classify_work_model(text: &str) -> Option<&'static str> {
    let l = text.to_lowercase();
    let any = |ks: &[&str]| ks.iter().any(|k| l.contains(k));
    if any(&[
        "híbrido",
        "hibrido",
        "hybrid",
        "semipresencial",
        "semi-presencial",
    ]) {
        return Some("hybrid");
    }
    if any(&[
        "presencial",
        "presential",
        "on-site",
        "on site",
        "onsite",
        "in office",
        "in-office",
        "no escritório",
        "no escritorio",
        "totalmente presencial",
    ]) {
        return Some("onsite");
    }
    if any(&[
        "remote",
        "remoto",
        "home office",
        "home-office",
        "teletrabalho",
        "trabalho remoto",
        "anywhere",
        "totalmente remoto",
    ]) {
        return Some("remote");
    }
    None
}

pub fn classify_seniority(text: &str) -> Option<&'static str> {
    let l = format!(" {} ", text.to_lowercase());
    let any = |ks: &[&str]| ks.iter().any(|k| l.contains(k));
    if any(&[
        " principal",
        " staff",
        " lead ",
        " tech lead",
        "líder",
        " head ",
        " gerente",
        " manager",
        " diretor",
        " director",
    ]) {
        return Some("lead");
    }
    if any(&[
        " senior",
        " sênior",
        " sr ",
        " sr.",
        "(sr)",
        " especialista",
        " specialist",
    ]) {
        return Some("senior");
    }
    if any(&[
        " pleno",
        " mid ",
        " mid-",
        "mid-level",
        "mid level",
        " intermediár",
        " intermediate",
        "(pl)",
    ]) {
        return Some("mid");
    }
    if any(&[
        " junior", " júnior", " jr ", " jr.", "(jr)", " entry", " trainee",
    ]) {
        return Some("junior");
    }
    if any(&[" intern", " estág", " estagi", " aprendiz"]) {
        return Some("intern");
    }
    None
}

fn canon_level(s: &str) -> Option<&'static str> {
    let l = s.trim().to_lowercase();
    if level_matches(&l, &["intern", "estág", "estagi", "aprendiz"], &[]) {
        Some("intern")
    } else if level_matches(
        &l,
        &[
            "lead",
            "staff",
            "principal",
            "gerente",
            "manager",
            "líder",
            "lider",
            "diretor",
            "director",
            "head",
        ],
        &[],
    ) {
        Some("lead")
    } else if level_matches(
        &l,
        &["senior", "sênior", "especialista", "specialist"],
        &["sr"],
    ) {
        Some("senior")
    } else if level_matches(&l, &["pleno", "mid", "intermediá", "intermediar"], &["pl"]) {
        Some("mid")
    } else if level_matches(&l, &["junior", "júnior", "entry", "trainee"], &["jr"]) {
        Some("junior")
    } else {
        None
    }
}

fn level_matches(value: &str, contains: &[&str], exact: &[&str]) -> bool {
    contains.iter().any(|keyword| value.contains(keyword)) || exact.contains(&value)
}

fn compute_location(input: &MatchInput) -> u8 {
    if input.pref_locations.is_empty() && input.pref_remote_modes.is_empty() {
        return NEUTRAL_LOCATION;
    }
    let text_model = classify_work_model(&format!(
        "{} {} {}",
        input.job_location.as_deref().unwrap_or(""),
        input.job_title,
        input.job_text
    ));
    let struct_model = input
        .job_remote_mode
        .as_deref()
        .and_then(classify_work_model);
    let job_model = preferred_job_model(text_model, struct_model);
    let (prefers_remote, prefers_onsite, prefers_hybrid) = location_preferences(input);
    let only_remote = prefers_remote && !prefers_onsite && !prefers_hybrid;
    model_location_score(
        job_model,
        prefers_remote,
        prefers_onsite,
        prefers_hybrid,
        only_remote,
    )
    .or_else(|| explicit_location_score(input))
    .unwrap_or(20)
}

fn preferred_job_model(
    text_model: Option<&'static str>,
    struct_model: Option<&'static str>,
) -> Option<&'static str> {
    match text_model {
        Some("onsite") | Some("hybrid") => text_model,
        Some(_) => text_model.or(struct_model),
        None => struct_model,
    }
}

fn location_preferences(input: &MatchInput) -> (bool, bool, bool) {
    let prefers = |keywords: &[&str]| {
        input.pref_remote_modes.iter().any(|preference| {
            let value = preference.to_lowercase();
            keywords.iter().any(|keyword| value.contains(keyword))
        })
    };
    (
        prefers(&["remote", "remoto", "home", "teletrab", "anywhere", "flex"]),
        prefers(&[
            "onsite",
            "on-site",
            "on site",
            "presencial",
            "presential",
            "escritório",
            "escritorio",
        ]),
        prefers(&["hybrid", "híbrido", "hibrido", "semipres"]),
    )
}

fn model_location_score(
    model: Option<&str>,
    remote: bool,
    onsite: bool,
    hybrid: bool,
    only_remote: bool,
) -> Option<u8> {
    match model {
        Some("remote") if remote => Some(100),
        Some("onsite") if onsite => Some(100),
        Some("hybrid") if hybrid || remote => Some(80),
        Some("onsite") if only_remote => Some(10),
        Some("remote") if onsite && !remote => Some(15),
        _ => None,
    }
}

fn explicit_location_score(input: &MatchInput) -> Option<u8> {
    if let Some(remote_mode) = &input.job_remote_mode {
        let value = remote_mode.to_lowercase();
        if input.pref_remote_modes.iter().any(|preference| {
            value == preference.to_lowercase() || value.contains(&preference.to_lowercase())
        }) {
            return Some(100);
        }
    }
    if let Some(location) = &input.job_location {
        let value = location.to_lowercase();
        if input.pref_locations.iter().any(|preference| {
            !preference.trim().is_empty() && value.contains(&preference.to_lowercase())
        }) {
            return Some(100);
        }
    }
    None
}

fn compute_salary(input: &MatchInput) -> u8 {
    let floor = match input.min_salary {
        Some(f) if f > 0 => f,
        _ => return NEUTRAL_SALARY,
    };
    let ceiling = input.job_salary_max.or(input.job_salary_min);
    match ceiling {
        None => NEUTRAL_SALARY,
        Some(c) if c >= floor => 100,
        Some(c) => {
            let ratio = c as f32 / floor as f32;
            pct(ratio * 0.8)
        }
    }
}

#[cfg(test)]
#[path = "../tests/matching_scorer_tests.rs"]
mod tests;
