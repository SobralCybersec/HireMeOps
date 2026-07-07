//! Best-CV selection for a job.
//!
//! `cv_documents` carries only file metadata (no structured skills), but
//! `profile_variants` carries a `target_title`, `keywords_json`, and a
//! `preferred_cv_document_id`. So "pick the best CV" = pick the variant whose
//! title/keywords best fit the job, then use that variant's preferred CV.
//! Pure and unit-testable; the command layer supplies the candidates.

use super::scorer::normalize_tokens;

/// One profile variant, as a scoring candidate.
#[derive(Debug, Clone)]
pub struct VariantCandidate {
    pub variant_id: String,
    pub target_title: String,
    pub keywords: Vec<String>,
    pub preferred_cv_document_id: Option<String>,
}

/// The chosen variant + its CV (if the variant pins one).
#[derive(Debug, Clone, PartialEq)]
pub struct CvSelection {
    pub variant_id: String,
    pub cv_document_id: Option<String>,
    /// 0.0–1.0 fit of the winning variant against the job.
    pub match_ratio: f32,
}

/// Pick the best-fitting variant for a job. Returns `None` when there are no
/// candidates. The score blends title-token overlap (0.6) with keyword
/// presence in the job text (0.4); ties break toward the earlier candidate.
pub fn select_best_cv(
    job_title: &str,
    job_text: &str,
    candidates: &[VariantCandidate],
) -> Option<CvSelection> {
    if candidates.is_empty() {
        return None;
    }

    let job_title_tokens = normalize_tokens(job_title);
    let haystack = format!("{} {}", job_title.to_lowercase(), job_text.to_lowercase());
    let hay_tokens = normalize_tokens(&haystack);

    let mut best: Option<(f32, usize)> = None;
    for (idx, c) in candidates.iter().enumerate() {
        let title_tokens = normalize_tokens(&c.target_title);
        let title_overlap = if title_tokens.is_empty() {
            0.0
        } else {
            let hit = title_tokens
                .iter()
                .filter(|t| job_title_tokens.contains(*t))
                .count();
            hit as f32 / title_tokens.len() as f32
        };

        let kw_cov = if c.keywords.is_empty() {
            0.0
        } else {
            let hit = c
                .keywords
                .iter()
                .filter(|k| {
                    let k = k.trim().to_lowercase();
                    !k.is_empty()
                        && (hay_tokens.contains(&k) || (k.contains(' ') && haystack.contains(&k)))
                })
                .count();
            hit as f32 / c.keywords.len() as f32
        };

        let ratio = 0.6 * title_overlap + 0.4 * kw_cov;
        // Strictly-greater keeps the earliest candidate on ties.
        if best.map_or(true, |(b, _)| ratio > b) {
            best = Some((ratio, idx));
        }
    }

    let (ratio, idx) = best?;
    let winner = &candidates[idx];
    Some(CvSelection {
        variant_id: winner.variant_id.clone(),
        cv_document_id: winner.preferred_cv_document_id.clone(),
        match_ratio: ratio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, title: &str, kws: &[&str], cv: Option<&str>) -> VariantCandidate {
        VariantCandidate {
            variant_id: id.into(),
            target_title: title.into(),
            keywords: kws.iter().map(|s| s.to_string()).collect(),
            preferred_cv_document_id: cv.map(|s| s.to_string()),
        }
    }

    #[test]
    fn empty_candidates_returns_none() {
        assert!(select_best_cv("Rust Engineer", "rust tokio", &[]).is_none());
    }

    #[test]
    fn picks_variant_matching_the_job_title() {
        let cands = vec![
            cand("v_be", "Backend Engineer", &["rust", "postgres"], Some("cv_be")),
            cand("v_fe", "Frontend Engineer", &["react", "css"], Some("cv_fe")),
        ];
        let sel = select_best_cv(
            "Senior Backend Engineer",
            "We build Rust services on Postgres",
            &cands,
        )
        .unwrap();
        assert_eq!(sel.variant_id, "v_be");
        assert_eq!(sel.cv_document_id, Some("cv_be".to_string()));
        assert!(sel.match_ratio > 0.0);
    }

    #[test]
    fn keywords_break_a_title_tie() {
        // Both titles equally unrelated to the job title, keywords decide.
        let cands = vec![
            cand("v_a", "Specialist", &["marketing", "seo"], Some("cv_a")),
            cand("v_b", "Specialist", &["rust", "kubernetes"], Some("cv_b")),
        ];
        let sel = select_best_cv(
            "Platform Role",
            "Rust and Kubernetes heavy environment",
            &cands,
        )
        .unwrap();
        assert_eq!(sel.variant_id, "v_b");
    }

    #[test]
    fn variant_without_cv_still_selectable() {
        let cands = vec![cand("v_x", "Data Engineer", &["spark"], None)];
        let sel = select_best_cv("Data Engineer", "spark pipelines", &cands).unwrap();
        assert_eq!(sel.variant_id, "v_x");
        assert_eq!(sel.cv_document_id, None);
    }
}
