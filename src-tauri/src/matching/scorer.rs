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

pub fn score_job(input: &MatchInput) -> MatchScore {
    let title_lower = input.job_title.to_lowercase();
    let title_tokens = normalize_tokens(&input.job_title);
    let text_lower = format!("{} {}", title_lower, input.job_text.to_lowercase());
    let text_tokens = normalize_tokens(&text_lower);

    let role_score = if input.target_roles.is_empty() {
        NEUTRAL_SENIORITY
    } else {
        let best = input
            .target_roles
            .iter()
            .map(|role| {
                let rt = normalize_tokens(role);
                if rt.is_empty() {
                    return 0.0;
                }
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

    let req_cov = coverage(&input.required_skills, &text_tokens, &text_lower);
    let pref_cov = coverage(&input.preferred_skills, &text_tokens, &text_lower);
    let skill_score = match (
        input.required_skills.is_empty(),
        input.preferred_skills.is_empty(),
    ) {
        (true, true) => NEUTRAL_SALARY,
        (false, true) => pct(req_cov),
        (true, false) => pct(pref_cov),
        (false, false) => pct(0.7 * req_cov + 0.3 * pref_cov),
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
        if phrase_present(skill, &text_tokens, &text_lower) {
            matched.push(skill.clone());
        } else {
            missing.push(skill.clone());
        }
    }

    let seniority_score = if input.pref_seniority.is_empty() {
        NEUTRAL_SENIORITY
    } else {
        let job_level = input
            .job_seniority
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .and_then(canon_level)
            .or_else(|| classify_seniority(&format!("{} {}", input.job_title, input.job_text)));
        match job_level {
            Some(jl) => {
                if input
                    .pref_seniority
                    .iter()
                    .filter_map(|p| canon_level(p))
                    .any(|p| p == jl)
                {
                    100
                } else {
                    30
                }
            }
            None => NEUTRAL_SENIORITY,
        }
    };

    let location_score = compute_location(input);

    let salary_score = compute_salary(input);

    let overall = W_ROLE * role_score as f32
        + W_SKILL * skill_score as f32
        + W_SENIORITY * seniority_score as f32
        + W_LOCATION * location_score as f32
        + W_SALARY * salary_score as f32;
    let score = overall.round().clamp(0.0, 100.0) as u8;

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

    let hard_skip = blocked
        || risk_flags
            .iter()
            .any(|f| f.starts_with("excluded_keyword:"));
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

pub fn classify_work_model(text: &str) -> Option<&'static str> {
    let l = text.to_lowercase();
    let any = |ks: &[&str]| ks.iter().any(|k| l.contains(k));
    if any(&["híbrido", "hibrido", "hybrid", "semipresencial", "semi-presencial"]) {
        return Some("hybrid");
    }
    if any(&[
        "presencial", "presential", "on-site", "on site", "onsite", "in office",
        "in-office", "no escritório", "no escritorio", "totalmente presencial",
    ]) {
        return Some("onsite");
    }
    if any(&[
        "remote", "remoto", "home office", "home-office", "teletrabalho",
        "trabalho remoto", "anywhere", "totalmente remoto",
    ]) {
        return Some("remote");
    }
    None
}

pub fn classify_seniority(text: &str) -> Option<&'static str> {
    let l = format!(" {} ", text.to_lowercase());
    let any = |ks: &[&str]| ks.iter().any(|k| l.contains(k));
    if any(&[
        " principal", " staff", " lead ", " tech lead", "líder", " head ", " gerente",
        " manager", " diretor", " director",
    ]) {
        return Some("lead");
    }
    if any(&[" senior", " sênior", " sr ", " sr.", "(sr)", " especialista", " specialist"]) {
        return Some("senior");
    }
    if any(&[
        " pleno", " mid ", " mid-", "mid-level", "mid level", " intermediár", " intermediate",
        "(pl)",
    ]) {
        return Some("mid");
    }
    if any(&[" junior", " júnior", " jr ", " jr.", "(jr)", " entry", " trainee"]) {
        return Some("junior");
    }
    if any(&[" intern", " estág", " estagi", " aprendiz"]) {
        return Some("intern");
    }
    None
}

fn canon_level(s: &str) -> Option<&'static str> {
    let l = s.trim().to_lowercase();
    if l.contains("intern") || l.contains("estág") || l.contains("estagi") || l.contains("aprendiz")
    {
        Some("intern")
    } else if l.contains("lead")
        || l.contains("staff")
        || l.contains("principal")
        || l.contains("gerente")
        || l.contains("manager")
        || l.contains("líder")
        || l.contains("lider")
        || l.contains("diretor")
        || l.contains("director")
        || l.contains("head")
    {
        Some("lead")
    } else if l.contains("senior") || l.contains("sênior") || l == "sr" || l.contains("especialista")
        || l.contains("specialist")
    {
        Some("senior")
    } else if l.contains("pleno") || l.contains("mid") || l.contains("intermediá")
        || l.contains("intermediar") || l == "pl"
    {
        Some("mid")
    } else if l.contains("junior") || l.contains("júnior") || l == "jr" || l.contains("entry")
        || l.contains("trainee")
    {
        Some("junior")
    } else {
        None
    }
}

fn compute_location(input: &MatchInput) -> u8 {
    let has_pref = !input.pref_locations.is_empty() || !input.pref_remote_modes.is_empty();
    if !has_pref {
        return NEUTRAL_LOCATION;
    }

    let text_model = classify_work_model(&format!(
        "{} {} {}",
        input.job_location.as_deref().unwrap_or(""),
        input.job_title,
        input.job_text
    ));
    let struct_model = input.job_remote_mode.as_deref().and_then(classify_work_model);
    let job_model = match text_model {
        Some("onsite") | Some("hybrid") => text_model,
        Some(_) => text_model.or(struct_model),
        None => struct_model,
    };

    let prefers = |kws: &[&str]| {
        input.pref_remote_modes.iter().any(|p| {
            let l = p.to_lowercase();
            kws.iter().any(|k| l.contains(k))
        })
    };
    let prefers_remote = prefers(&["remote", "remoto", "home", "teletrab", "anywhere", "flex"]);
    let prefers_onsite = prefers(&[
        "onsite", "on-site", "on site", "presencial", "presential", "escritório", "escritorio",
    ]);
    let prefers_hybrid = prefers(&["hybrid", "híbrido", "hibrido", "semipres"]);
    let only_remote = prefers_remote && !prefers_onsite && !prefers_hybrid;

    match job_model {
        Some("remote") if prefers_remote => return 100,
        Some("onsite") if prefers_onsite => return 100,
        Some("hybrid") if prefers_hybrid || prefers_remote => return 80,
        Some("onsite") if only_remote => return 10,
        Some("remote") if prefers_onsite && !prefers_remote => return 15,
        _ => {}
    }

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
    20
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
}
