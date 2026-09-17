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
#[path = "../tests/matching_explanation_tests.rs"]
mod tests;
