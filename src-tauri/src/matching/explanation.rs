//! Human-readable rationale for a match score.
//!
//! Turns a [`MatchScore`](super::scorer::MatchScore) into a compact,
//! deterministic sentence the UI can show without any AI round-trip. Phase 4
//! may overwrite `explanation` with a richer model-authored version.

use super::scorer::{MatchScore, Recommendation};

/// Build a one-paragraph explanation of why a job scored the way it did.
pub fn build_explanation(s: &MatchScore) -> String {
    let verdict = match s.recommendation {
        Recommendation::AutoApply => "Strong match — eligible for auto-apply",
        Recommendation::ReviewFirst => "Partial match — review before applying",
        Recommendation::Skip => "Skipped — hard filter triggered",
        Recommendation::SaveForLater => "Weak match — saved for later",
    };

    // Order sub-scores best→worst so the strongest reasons lead.
    let mut factors: Vec<(&str, u8)> = vec![
        ("role", s.role_score),
        ("skills", s.skill_score),
        ("seniority", s.seniority_score),
        ("location", s.location_score),
        ("salary", s.salary_score),
    ];
    factors.sort_by_key(|&(_, v)| std::cmp::Reverse(v));
    let breakdown = factors
        .iter()
        .map(|(label, v)| format!("{label} {v}"))
        .collect::<Vec<_>>()
        .join(", ");

    let mut out = format!(
        "{verdict} (overall {}/100). Breakdown: {breakdown}.",
        s.score
    );

    if !s.matched_skills.is_empty() {
        out.push_str(&format!(
            " Matched skills: {}.",
            s.matched_skills.join(", ")
        ));
    }
    if !s.missing_skills.is_empty() {
        out.push_str(&format!(
            " Missing skills: {}.",
            s.missing_skills.join(", ")
        ));
    }
    if !s.risk_flags.is_empty() {
        out.push_str(&format!(" Risk flags: {}.", s.risk_flags.join(", ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score() -> MatchScore {
        MatchScore {
            score: 88,
            role_score: 100,
            skill_score: 90,
            seniority_score: 100,
            location_score: 100,
            salary_score: 40,
            matched_skills: vec!["Rust".into(), "PostgreSQL".into()],
            missing_skills: vec!["GraphQL".into()],
            risk_flags: vec![],
            recommendation: Recommendation::AutoApply,
        }
    }

    #[test]
    fn mentions_score_and_verdict() {
        let e = build_explanation(&score());
        assert!(e.contains("88/100"));
        assert!(e.contains("auto-apply"));
    }

    #[test]
    fn lists_matched_and_missing_skills() {
        let e = build_explanation(&score());
        assert!(e.contains("Matched skills: Rust, PostgreSQL"));
        assert!(e.contains("Missing skills: GraphQL"));
    }

    #[test]
    fn orders_factors_best_first() {
        let e = build_explanation(&score());
        // salary (40) is weakest, so it must come last in the breakdown list.
        let breakdown = e.split("Breakdown: ").nth(1).unwrap();
        let salary_pos = breakdown.find("salary").unwrap();
        let role_pos = breakdown.find("role").unwrap();
        assert!(role_pos < salary_pos);
    }

    #[test]
    fn surfaces_risk_flags_when_present() {
        let mut sc = score();
        sc.risk_flags = vec!["blocked_company:EvilCorp".into()];
        sc.recommendation = Recommendation::Skip;
        let e = build_explanation(&sc);
        assert!(e.contains("Risk flags: blocked_company:EvilCorp"));
        assert!(e.contains("Skipped"));
    }
}
