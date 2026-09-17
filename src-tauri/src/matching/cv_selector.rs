//! Best-CV selection for a job.
//!
//! Key: select_best_cv — picks the profile variant whose title/keywords best fit the job, then uses that variant's preferred CV
//! Key: VariantCandidate — one profile variant as a scoring candidate (title, keywords, preferred CV id)
//! Key: CvSelection — the chosen variant + its CV, with a 0.0-1.0 match_ratio

use super::scorer::normalize_tokens;

#[derive(Debug, Clone)]
pub struct VariantCandidate {
    pub variant_id: String,
    pub target_title: String,
    pub keywords: Vec<String>,
    pub preferred_cv_document_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CvSelection {
    pub variant_id: String,
    pub cv_document_id: Option<String>,
    pub match_ratio: f32,
}

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
        if best.is_none_or(|(b, _)| ratio > b) {
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
#[path = "../tests/matching_cv_selector_tests.rs"]
mod tests;
