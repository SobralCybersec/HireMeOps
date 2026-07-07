//! Pure prompt construction + response parsing for AI-backed features.
//!
//! Everything here is deterministic and side-effect free: it turns structured
//! inputs into a prompt string, and a (possibly messy) model reply into a typed
//! struct. The network call and DB persistence live in [`super`] and the domain
//! services. Parsing is deliberately lenient — models wrap JSON in prose or
//! markdown fences, so we extract the first `{…}` block and fall back to using
//! the raw text as a summary rather than failing the whole analysis.

use serde::{Deserialize, Serialize};

/// Bump when the CV-analysis prompt wording changes so cached responses keyed on
/// the old prompt are not silently reused (folded into the cache `input_hash`).
pub const CV_ANALYSIS_PROMPT_VERSION: &str = "cv-analysis-v1";

/// Bump when the application-draft prompt wording changes.
pub const DRAFT_PROMPT_VERSION: &str = "app-draft-v1";

/// Cap CV / job text fed to the model so a huge document can't blow the context
/// window or the prompt-token budget. Generous enough for a multi-page CV.
const MAX_TEXT_CHARS: usize = 12_000;

fn clip(text: &str) -> String {
    if text.len() <= MAX_TEXT_CHARS {
        return text.to_string();
    }
    // Cut on a char boundary at or below the limit.
    let mut end = MAX_TEXT_CHARS;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[truncated]", &text[..end])
}

// ─────────────────────────────── CV analysis ────────────────────────────────

/// Structured result of a CV gap/quality analysis. Mirrors the persistable
/// columns of `cv_analysis_reports` (minus the ids/timestamps).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvAnalysis {
    /// Overall 0–100 fit/quality score, when the model returned one.
    pub score: Option<i64>,
    pub summary: String,
    pub optimization_needed: bool,
    pub missing_keywords: Vec<String>,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub recommendations: Vec<String>,
}

/// System instruction pinning the model to a strict JSON schema.
pub fn cv_analysis_system() -> String {
    "You are a professional CV/resume reviewer. Analyse the candidate's CV and \
     respond with ONLY a single JSON object (no prose, no markdown fences) of the \
     exact shape: {\"score\": <integer 0-100>, \"summary\": <string>, \
     \"optimization_needed\": <boolean>, \"missing_keywords\": [<string>], \
     \"strengths\": [<string>], \"weaknesses\": [<string>], \
     \"recommendations\": [<string>]}. Keep arrays concise (max 8 items each)."
        .to_string()
}

/// Build the user prompt for CV analysis.
pub fn cv_analysis_prompt(cv_text: &str, target_title: Option<&str>) -> String {
    let target = target_title
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| format!("The candidate is targeting the role: \"{t}\".\n\n"))
        .unwrap_or_default();
    format!("{target}CV CONTENT:\n{}", clip(cv_text))
}

/// Parse a model reply into a [`CvAnalysis`]. Never fails: on unparseable input
/// it degrades to a summary-only report carrying the raw text.
pub fn parse_cv_analysis(raw: &str) -> CvAnalysis {
    #[derive(Deserialize, Default)]
    struct Raw {
        score: Option<i64>,
        summary: Option<String>,
        optimization_needed: Option<bool>,
        #[serde(default)]
        missing_keywords: Vec<String>,
        #[serde(default)]
        strengths: Vec<String>,
        #[serde(default)]
        weaknesses: Vec<String>,
        #[serde(default)]
        recommendations: Vec<String>,
    }

    if let Some(obj) = extract_json_object(raw) {
        if let Ok(r) = serde_json::from_str::<Raw>(obj) {
            let score = r.score.map(|s| s.clamp(0, 100));
            // If the model didn't send the flag, infer it: a low score or any
            // listed weakness/missing keyword means optimization is warranted.
            let optimization_needed = r.optimization_needed.unwrap_or_else(|| {
                score.map(|s| s < 80).unwrap_or(false)
                    || !r.weaknesses.is_empty()
                    || !r.missing_keywords.is_empty()
            });
            return CvAnalysis {
                score,
                summary: r.summary.unwrap_or_default(),
                optimization_needed,
                missing_keywords: clean(r.missing_keywords),
                strengths: clean(r.strengths),
                weaknesses: clean(r.weaknesses),
                recommendations: clean(r.recommendations),
            };
        }
    }
    CvAnalysis {
        score: None,
        summary: raw.trim().to_string(),
        optimization_needed: false,
        ..Default::default()
    }
}

// ─────────────────────────── Application drafting ───────────────────────────

/// Inputs needed to draft an application. Borrowed so the caller keeps ownership.
#[derive(Debug, Clone)]
pub struct DraftInput<'a> {
    pub job_title: &'a str,
    pub company: &'a str,
    pub job_location: Option<&'a str>,
    pub job_description: &'a str,
    pub candidate_name: &'a str,
    pub candidate_summary: Option<&'a str>,
    /// Extracted CV text, when a CV document is attached to the match.
    pub cv_text: Option<&'a str>,
    /// The role-variant headline/target, when a variant is pinned.
    pub variant_target: Option<&'a str>,
}

/// A single application-form question/answer pair produced by the model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FormAnswer {
    pub question: String,
    pub answer: String,
}

/// Structured result of an application draft. Maps onto `application_drafts`
/// (`cover_letter`, `form_answers_json`, `generated_summary`, `optimization_notes`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DraftContent {
    pub cover_letter: String,
    pub form_answers: Vec<FormAnswer>,
    pub summary: String,
    pub optimization_notes: String,
}

pub fn draft_system() -> String {
    "You are an expert career assistant writing a tailored job application. \
     Respond with ONLY a single JSON object (no prose, no markdown fences) of the \
     exact shape: {\"cover_letter\": <string>, \"form_answers\": [{\"question\": \
     <string>, \"answer\": <string>}], \"summary\": <string>, \
     \"optimization_notes\": <string>}. The cover letter must be specific to the \
     role and grounded in the candidate's actual experience — never invent facts."
        .to_string()
}

/// Build the user prompt for an application draft.
pub fn draft_prompt(input: &DraftInput) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "JOB\nTitle: {}\nCompany: {}\n",
        input.job_title.trim(),
        input.company.trim()
    ));
    if let Some(loc) = input.job_location.map(str::trim).filter(|l| !l.is_empty()) {
        s.push_str(&format!("Location: {loc}\n"));
    }
    s.push_str(&format!(
        "Description:\n{}\n\n",
        clip(input.job_description)
    ));

    s.push_str(&format!(
        "CANDIDATE\nName: {}\n",
        input.candidate_name.trim()
    ));
    if let Some(t) = input
        .variant_target
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        s.push_str(&format!("Targeting: {t}\n"));
    }
    if let Some(sum) = input
        .candidate_summary
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        s.push_str(&format!("Summary: {sum}\n"));
    }
    if let Some(cv) = input.cv_text.map(str::trim).filter(|t| !t.is_empty()) {
        s.push_str(&format!("\nCV CONTENT:\n{}", clip(cv)));
    }
    s
}

/// Parse a model reply into a [`DraftContent`]. Never fails: on unparseable
/// input it degrades to using the raw text as the cover letter.
pub fn parse_draft(raw: &str) -> DraftContent {
    #[derive(Deserialize, Default)]
    struct Raw {
        cover_letter: Option<String>,
        #[serde(default)]
        form_answers: Vec<FormAnswer>,
        summary: Option<String>,
        optimization_notes: Option<String>,
    }

    if let Some(obj) = extract_json_object(raw) {
        if let Ok(r) = serde_json::from_str::<Raw>(obj) {
            // Only accept the structured shape if it carried a cover letter;
            // otherwise fall through to the raw-text degradation below.
            if let Some(cl) = r.cover_letter.filter(|c| !c.trim().is_empty()) {
                return DraftContent {
                    cover_letter: cl,
                    form_answers: r
                        .form_answers
                        .into_iter()
                        .filter(|fa| !fa.question.trim().is_empty() || !fa.answer.trim().is_empty())
                        .collect(),
                    summary: r.summary.unwrap_or_default(),
                    optimization_notes: r.optimization_notes.unwrap_or_default(),
                };
            }
        }
    }
    DraftContent {
        cover_letter: raw.trim().to_string(),
        ..Default::default()
    }
}

// ─────────────────────────────── helpers ────────────────────────────────────

/// Extract the outermost `{…}` JSON object from a string that may be wrapped in
/// prose or ```json fences.
fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    (end > start).then(|| &raw[start..=end])
}

/// Trim, drop empties, and de-duplicate a string list from the model.
fn clean(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && seen.insert(s.to_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_well_formed_cv_json() {
        let raw = r#"{"score": 82, "summary": "Strong backend CV.",
            "optimization_needed": true, "missing_keywords": ["Kubernetes"],
            "strengths": ["Rust", "Rust"], "weaknesses": ["No cloud"],
            "recommendations": ["Add metrics"]}"#;
        let a = parse_cv_analysis(raw);
        assert_eq!(a.score, Some(82));
        assert_eq!(a.summary, "Strong backend CV.");
        assert!(a.optimization_needed);
        assert_eq!(a.missing_keywords, vec!["Kubernetes"]);
        // Duplicate "Rust" is de-duplicated (case-insensitive).
        assert_eq!(a.strengths, vec!["Rust"]);
    }

    #[test]
    fn extracts_json_from_markdown_fence() {
        let raw = "Here you go:\n```json\n{\"score\": 90, \"summary\": \"ok\"}\n```\nThanks!";
        let a = parse_cv_analysis(raw);
        assert_eq!(a.score, Some(90));
        assert_eq!(a.summary, "ok");
    }

    #[test]
    fn clamps_out_of_range_score() {
        let a = parse_cv_analysis(r#"{"score": 250, "summary": "x"}"#);
        assert_eq!(a.score, Some(100));
    }

    #[test]
    fn infers_optimization_needed_when_flag_absent() {
        // No flag, low score → inferred true.
        let a = parse_cv_analysis(r#"{"score": 40, "summary": "weak"}"#);
        assert!(a.optimization_needed);
        // No flag, high score, no weaknesses → false.
        let b = parse_cv_analysis(r#"{"score": 95, "summary": "great"}"#);
        assert!(!b.optimization_needed);
    }

    #[test]
    fn degrades_gracefully_on_non_json() {
        let a = parse_cv_analysis("The CV looks fine overall.");
        assert_eq!(a.score, None);
        assert_eq!(a.summary, "The CV looks fine overall.");
        assert!(!a.optimization_needed);
    }

    #[test]
    fn cv_prompt_includes_target_and_clips() {
        let big = "x".repeat(20_000);
        let p = cv_analysis_prompt(&big, Some("  Backend Engineer  "));
        assert!(p.contains("Backend Engineer"));
        assert!(p.contains("[truncated]"));
        assert!(p.len() < 13_000);
        // No target when blank.
        let p2 = cv_analysis_prompt("short", Some("   "));
        assert!(!p2.contains("targeting"));
    }

    #[test]
    fn parses_well_formed_draft_json() {
        let raw = r#"{"cover_letter": "Dear team, ...",
            "form_answers": [{"question": "Why us?", "answer": "Because."},
                             {"question": "", "answer": ""}],
            "summary": "Tailored.", "optimization_notes": "Add a metric."}"#;
        let d = parse_draft(raw);
        assert_eq!(d.cover_letter, "Dear team, ...");
        // Empty Q/A pair is dropped.
        assert_eq!(d.form_answers.len(), 1);
        assert_eq!(d.form_answers[0].question, "Why us?");
        assert_eq!(d.optimization_notes, "Add a metric.");
    }

    #[test]
    fn draft_degrades_to_raw_cover_letter() {
        let d = parse_draft("Dear hiring manager, I am excited...");
        assert_eq!(d.cover_letter, "Dear hiring manager, I am excited...");
        assert!(d.form_answers.is_empty());
        // JSON object without a cover_letter also degrades to raw.
        let d2 = parse_draft(r#"{"summary": "no letter here"}"#);
        assert!(d2.cover_letter.contains("no letter here"));
    }

    #[test]
    fn draft_prompt_includes_all_present_sections() {
        let input = DraftInput {
            job_title: "Senior Rust Engineer",
            company: "Acme",
            job_location: Some("Remote"),
            job_description: "Build backends.",
            candidate_name: "Jane Doe",
            candidate_summary: Some("10y backend."),
            cv_text: Some("EXPERIENCE: Rust everywhere."),
            variant_target: Some("Backend Engineer"),
        };
        let p = draft_prompt(&input);
        assert!(p.contains("Senior Rust Engineer"));
        assert!(p.contains("Acme"));
        assert!(p.contains("Remote"));
        assert!(p.contains("Jane Doe"));
        assert!(p.contains("Backend Engineer"));
        assert!(p.contains("10y backend."));
        assert!(p.contains("EXPERIENCE: Rust everywhere."));
    }
}
