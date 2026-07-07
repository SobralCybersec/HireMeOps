//! Matching module — deterministic, rule-based job/profile scoring.
//!
//! Phase 3 deliverable per SPEC §7.5 (`JobMatcher`). This is the *match
//! scoring* stage — pure token/overlap heuristics over a job post and a
//! saved preference. It carries no AI dependency and no Tauri dependency, so
//! every function here is unit-testable in isolation. Phase 4's AI providers
//! *augment* these scores (via `model_provider`/`model_name` on a match); they
//! do not replace the deterministic baseline, which must always work offline.
//!
//! Split:
//!   - [`scorer`]      — sub-scores, weighting, recommendation gating.
//!   - [`explanation`] — human-readable rationale from a score breakdown.
//!   - [`cv_selector`] — best profile-variant / CV pick for a job.

pub mod cv_selector;
pub mod explanation;
pub mod scorer;

pub use cv_selector::{select_best_cv, VariantCandidate};
pub use explanation::build_explanation;
pub use scorer::{
    score_job, MatchInput, Recommendation, AUTO_SUBMIT_DEFAULT, NEEDS_REVIEW_DEFAULT,
};
