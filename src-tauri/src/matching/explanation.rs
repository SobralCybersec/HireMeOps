//! Human-readable rationale for a match score.
//!
//! Key: build_explanation — turns a MatchScore into a deterministic sentence, no AI round-trip needed

use super::scorer::{MatchScore, Recommendation};

pub fn build_explanation(s: &MatchScore) -> String {
    let verdict = match s.recommendation {
        Recommendation::AutoApply => "Strong match — eligible for auto-apply",
        Recommendation::ReviewFirst => "Partial match — review before applying",
        Recommendation::Skip => "Skipped — hard filter triggered",
        Recommendation::SaveForLater => "Weak match — saved for later",
    };

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

    #[test]
    fn empty_skills_sections_omitted() {
        let mut sc = score();
        sc.matched_skills = vec![];
        sc.missing_skills = vec![];
        let e = build_explanation(&sc);
        assert!(!e.contains("Matched skills"), "no matched → section absent");
        assert!(!e.contains("Missing skills"), "no missing → section absent");
    }

    #[test]
    fn review_first_verdict_appears_in_explanation() {
        let mut sc = score();
        sc.recommendation = Recommendation::ReviewFirst;
        sc.score = 55;
        let e = build_explanation(&sc);
        assert!(
            e.to_lowercase().contains("review"),
            "expected 'review' in: {e}"
        );
    }

    #[test]
    fn save_for_later_verdict_appears_in_explanation() {
        let mut sc = score();
        sc.recommendation = Recommendation::SaveForLater;
        sc.score = 30;
        let e = build_explanation(&sc);
        assert!(
            e.to_lowercase().contains("later"),
            "expected 'later' in: {e}"
        );
    }

    #[test]
    fn breakdown_contains_all_five_dimensions() {
        let e = build_explanation(&score());
        for dim in &["role", "skills", "seniority", "location", "salary"] {
            assert!(e.contains(dim), "missing dimension '{dim}' in: {e}");
        }
    }
}
