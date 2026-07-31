//! Matching module — deterministic, rule-based job/profile scoring.
//!
//! Key: scorer — sub-scores, weighting, recommendation gating
//! Key: explanation — human-readable rationale from a score breakdown
//! Key: cv_selector — best profile-variant / CV pick for a job

pub mod cv_selector;
pub mod explanation;
pub mod scorer;

pub use cv_selector::{select_best_cv, VariantCandidate};
pub use explanation::build_explanation;
pub use scorer::{
    score_job, MatchInput, Recommendation, AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
};
