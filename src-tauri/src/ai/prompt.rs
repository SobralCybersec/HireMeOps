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
pub const DRAFT_PROMPT_VERSION: &str = "app-draft-v2";

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
        // Browser models routinely return the score as a float (`85.0`) or a
        // string (`"85"`, `"85/100"`, `"85%"`) instead of a bare integer. A plain
        // `Option<i64>` fails to deserialize on those, which used to fail the
        // WHOLE object parse and silently drop score+summary+lists to the empty
        // fallback. `deserialize_lenient_score` coerces all of those forms.
        #[serde(default, deserialize_with = "deserialize_lenient_score")]
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
        // Strip trailing commas (`,}` / `,]`) some models emit; serde_json rejects
        // them and would otherwise drop us into the empty fallback below.
        let obj = strip_trailing_commas(obj);
        if let Ok(r) = serde_json::from_str::<Raw>(&obj) {
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
    /// Hiring-manager name scraped from the job page (if already known at
    /// draft time).  When present the AI addresses the letter directly rather
    /// than falling back to a generic salutation; the `{{hr_name}}` template
    /// placeholder is still substituted in the automation layer for cases where
    /// the name is discovered only at form-fill time.
    pub hr_name: Option<&'a str>,
    /// Hiring-manager LinkedIn profile URL (companion to `hr_name`).
    pub hr_link: Option<&'a str>,
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
    if let Some(n) = input.hr_name.map(str::trim).filter(|t| !t.is_empty()) {
        s.push_str(&format!("\nHIRING MANAGER\nName: {n}\n"));
        if let Some(l) = input.hr_link.map(str::trim).filter(|t| !t.is_empty()) {
            s.push_str(&format!("Profile: {l}\n"));
        }
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

/// Extract the first balanced `{…}` JSON object from a string that may be
/// wrapped in prose or ```json fences.
///
/// Walks byte-by-byte from the first `{`, tracking brace depth while ignoring
/// braces inside JSON string literals (respecting `\"` escapes), and returns
/// the span ending at the brace that closes the *first* object. This avoids
/// the previous `find('{')..rfind('}')` bug, which silently swallowed (or
/// mismatched into) any trailing prose that itself contained a `{` or `}`,
/// e.g. a reply ending in "...}\n\nNote: use {curly braces} sparingly."
///
/// Byte-wise scanning is safe here: `"`, `\\`, `{`, `}` are all single-byte
/// ASCII, and no UTF-8 continuation byte can equal them, so slice boundaries
/// always land on the char boundaries `raw.find`/indexing require.
fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (i, b) in raw.as_bytes()[start..].iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if *b == b'\\' {
                escaped = true;
            } else if *b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&raw[start..=start + i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Remove trailing commas before `}` or `]` (e.g. `{"a":1,}` -> `{"a":1}`),
/// which several browser models emit and `serde_json` rejects. String-aware so
/// commas inside string values are never touched.
fn strip_trailing_commas(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            out.push(b as char);
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => {
                in_string = true;
                out.push('"');
            }
            b',' => {
                // Look ahead past whitespace: drop the comma if the next
                // meaningful byte closes an object or array.
                let next = bytes[i + 1..]
                    .iter()
                    .find(|c| !c.is_ascii_whitespace());
                match next {
                    Some(b'}') | Some(b']') => { /* skip the trailing comma */ }
                    _ => out.push(','),
                }
            }
            _ => out.push(b as char),
        }
    }
    out
}

/// Coerce a model-supplied score into `Option<i64>`. Accepts integers, floats
/// (`85.0`), and strings (`"85"`, `"85/100"`, `"85%"`, `" 85 "`). Anything
/// unrecognized (including JSON `null`) yields `None` rather than failing the
/// entire object parse.
fn deserialize_lenient_score<'de, D>(de: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;
    let v = serde_json::Value::deserialize(de)?;
    Ok(match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.round() as i64)),
        serde_json::Value::String(s) => {
            let s = s.trim();
            // Take the portion before a `/` (e.g. "85/100") and drop a `%`.
            let head = s.split('/').next().unwrap_or(s);
            let cleaned = head.trim().trim_end_matches('%').trim();
            cleaned
                .parse::<i64>()
                .ok()
                .or_else(|| cleaned.parse::<f64>().ok().map(|f| f.round() as i64))
        }
        _ => None,
    })
}

// ─────────────────────────────── CV rewrite ─────────────────────────────────

/// Bump when the CV-rewrite prompt wording / schema changes so cached responses
/// keyed on the old prompt are not silently reused (folded into `input_hash`).
pub const CV_REWRITE_PROMPT_VERSION: &str = "cv-rewrite-v1";

/// One skill group. Maps to the CV Generator's skills table — col 0 = category,
/// col 1 = the (comma/semicolon-separated) skills string — which
/// `LatexGenerator.generateSkills` emits as `\cvskill{category}{skills}`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvSkillGroup {
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub skills: String,
}

/// One experience entry. Maps to the CV Generator's experience table
/// (`LatexGenerator.generateExperience`): col0 Job title, col1 Organization,
/// col2 Location, col3 Date(s), col4 = bullets joined by newlines.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvExperienceEntry {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub organization: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub dates: String,
    #[serde(default)]
    pub bullets: Vec<String>,
}

/// One education entry. Maps to the CV Generator's education table
/// (`LatexGenerator.generateEducation`): col0 Degree, col1 Institution,
/// col2 Location, col3 Date(s), col4 = bullets joined by newlines.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvEducationEntry {
    #[serde(default)]
    pub degree: String,
    #[serde(default)]
    pub institution: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub dates: String,
    #[serde(default)]
    pub bullets: Vec<String>,
}

/// A fully rewritten CV tailored to a target role — real, rewritten content,
/// NOT a critique. Structured to round-trip through the Java CV Generator's
/// `.tex` model (`ResumeEditorView.CompilationRequest`). Every field has a serde
/// default so a model omitting one still deserializes cleanly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvRewrite {
    /// Candidate full name → PDF Author.
    #[serde(default)]
    pub name: String,
    /// Target job titles → PDF Title (`a | b`) and Subject (`a, b`).
    #[serde(default)]
    pub positions: Vec<String>,
    /// Professional summary ("Perfil") → PDF Description (via `clean_latex`).
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub skills: Vec<CvSkillGroup>,
    #[serde(default)]
    pub experience: Vec<CvExperienceEntry>,
    #[serde(default)]
    pub education: Vec<CvEducationEntry>,
}

/// Derived PDF metadata computed from a [`CvRewrite`], matching
/// `ResumeService.addPDFMetadata` field-for-field so the CV Generator consumes
/// it directly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CvMetadata {
    pub title: String,
    pub subject: String,
    pub keywords: String,
    pub author: String,
    pub description: String,
    pub category: String,
}

impl CvRewrite {
    /// Trim strings, drop empty bullets, and drop fully-empty entries/groups.
    fn cleaned(mut self) -> CvRewrite {
        self.name = self.name.trim().to_string();
        self.summary = self.summary.trim().to_string();
        self.positions = clean(std::mem::take(&mut self.positions));
        self.skills = std::mem::take(&mut self.skills)
            .into_iter()
            .map(|g| CvSkillGroup {
                category: g.category.trim().to_string(),
                skills: g.skills.trim().to_string(),
            })
            .filter(|g| !g.category.is_empty() || !g.skills.is_empty())
            .collect();
        self.experience = std::mem::take(&mut self.experience)
            .into_iter()
            .map(|e| CvExperienceEntry {
                title: e.title.trim().to_string(),
                organization: e.organization.trim().to_string(),
                location: e.location.trim().to_string(),
                dates: e.dates.trim().to_string(),
                bullets: clean_bullets(e.bullets),
            })
            .filter(|e| !e.title.is_empty() || !e.organization.is_empty() || !e.bullets.is_empty())
            .collect();
        self.education = std::mem::take(&mut self.education)
            .into_iter()
            .map(|e| CvEducationEntry {
                degree: e.degree.trim().to_string(),
                institution: e.institution.trim().to_string(),
                location: e.location.trim().to_string(),
                dates: e.dates.trim().to_string(),
                bullets: clean_bullets(e.bullets),
            })
            .filter(|e| !e.degree.is_empty() || !e.institution.is_empty() || !e.bullets.is_empty())
            .collect();
        self
    }

    /// Compute the derived PDF metadata exactly like `ResumeService`:
    /// Title = positions joined by ` | `, Subject = positions joined by `, `,
    /// Keywords = order-preserving unique skill keywords followed by positions,
    /// Author = name, Description = `clean_latex(summary)`, Category = `"CV"`.
    pub fn cv_metadata(&self) -> CvMetadata {
        CvMetadata {
            title: self.positions.join(" | "),
            subject: self.positions.join(", "),
            keywords: extract_keywords(&self.skills, &self.positions),
            author: self.name.clone(),
            description: clean_latex(&self.summary),
            category: "CV".to_string(),
        }
    }
}

/// System instruction pinning the model to the CV-rewrite JSON schema.
pub fn cv_rewrite_system() -> String {
    "You are an expert CV writer. Rewrite the candidate's CV, tailored to the \
     target role, using ONLY real facts from the source CV — never invent \
     employers, degrees, dates, or credentials. Respond with ONLY a single JSON \
     object (no prose, no markdown fences) of the exact shape: {\"name\": \
     <string>, \"positions\": [<string>], \"summary\": <string>, \"skills\": \
     [{\"category\": <string>, \"skills\": <string>}], \"experience\": \
     [{\"title\": <string>, \"organization\": <string>, \"location\": <string>, \
     \"dates\": <string>, \"bullets\": [<string>]}], \"education\": [{\"degree\": \
     <string>, \"institution\": <string>, \"location\": <string>, \"dates\": \
     <string>, \"bullets\": [<string>]}]}. \"positions\" are the target job \
     titles. Each skill group's \"skills\" is one comma-separated list string. \
     Keep bullets concise, achievement-focused, and grounded in the source CV."
        .to_string()
}

/// Build the user prompt for a CV rewrite.
pub fn cv_rewrite_prompt(cv_text: &str, target_title: Option<&str>) -> String {
    let target = target_title
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| format!("Rewrite and tailor the CV for the role: \"{t}\".\n\n"))
        .unwrap_or_default();
    format!("{target}CV CONTENT:\n{}", clip(cv_text))
}

/// Parse a model reply into a [`CvRewrite`]. Never fails: on unparseable input
/// it degrades to an empty rewrite carrying the raw text as the summary.
pub fn parse_cv_rewrite(raw: &str) -> CvRewrite {
    if let Some(obj) = extract_json_object(raw) {
        let obj = strip_trailing_commas(obj);
        if let Ok(r) = serde_json::from_str::<CvRewrite>(&obj) {
            return r.cleaned();
        }
    }
    CvRewrite {
        summary: raw.trim().to_string(),
        ..Default::default()
    }
}

/// Trim, drop empties (keep duplicates: bullets legitimately repeat phrasing).
fn clean_bullets(items: Vec<String>) -> Vec<String> {
    items
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Replicates `ResumeService.extractKeywords`: for each skill group strip
/// `\href{url}{text}` → `text`, remove `{`/`}`/`\`, collapse whitespace, split on
/// `,`/`;`, trim each, and collect order-preserving unique keywords; then append
/// the target positions. Joined with `, `. (Positions are trimmed before
/// insertion — a minor tightening over the Java `addAll(positions)`.)
fn extract_keywords(skills: &[CvSkillGroup], positions: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for g in skills {
        let cleaned = collapse_ws(&strip_braces_backslashes(&strip_href(&g.skills)));
        for word in cleaned.split([',', ';']) {
            let w = word.trim();
            if !w.is_empty() && seen.insert(w.to_string()) {
                out.push(w.to_string());
            }
        }
    }
    for p in positions {
        let w = p.trim();
        if !w.is_empty() && seen.insert(w.to_string()) {
            out.push(w.to_string());
        }
    }
    out.join(", ")
}

/// Replicates `ResumeService.cleanLatex`: unwrap `\cmd{content}` → `content`
/// (single non-nested pass, subsuming the `\textbf{…}` pass), strip residual
/// `{`/`}`/`\`, then trim.
fn clean_latex(text: &str) -> String {
    strip_braces_backslashes(&strip_cmd_braces(text))
        .trim()
        .to_string()
}

/// Replace the first-level `\href{a}{b}` with `b` (groups are `[^}]*`, i.e. no
/// nested braces), left-to-right, non-overlapping.
fn strip_href(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        if s[i..].starts_with("\\href{") {
            let after = i + "\\href{".len();
            if let Some(rel1) = s[after..].find('}') {
                let g1_end = after + rel1;
                if s[g1_end + 1..].starts_with('{') {
                    let inner = g1_end + 2;
                    if let Some(rel2) = s[inner..].find('}') {
                        let g2_end = inner + rel2;
                        out.push_str(&s[inner..g2_end]);
                        i = g2_end + 1;
                        continue;
                    }
                }
            }
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

/// Unwrap the first-level `\<letters>{content}` → `content` (content is `[^}]*`),
/// left-to-right, non-overlapping. Bare backslashes are preserved for the
/// subsequent [`strip_braces_backslashes`] pass to remove.
fn strip_cmd_braces(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_alphabetic() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b'{' {
                let content_start = j + 1;
                if let Some(rel) = s[content_start..].find('}') {
                    let content_end = content_start + rel;
                    out.push_str(&s[content_start..content_end]);
                    i = content_end + 1;
                    continue;
                }
            }
            out.push('\\');
            i += 1;
        } else {
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// Remove every `{`, `}`, and `\` (the Java `[{}\\]` strip).
fn strip_braces_backslashes(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '{' && c != '}' && c != '\\')
        .collect()
}

/// Collapse runs of whitespace to a single space (the Java `\s+` → " ").
fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
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
    fn extracts_first_object_despite_trailing_prose_braces() {
        // Regression: a naive find('{')..rfind('}') would extend the span all
        // the way to the brace in the trailing sentence below.
        let raw = r#"{"score": 70, "summary": "ok"}

Note: feel free to use {curly braces} sparingly in your cover letter."#;
        let a = parse_cv_analysis(raw);
        assert_eq!(a.score, Some(70));
        assert_eq!(a.summary, "ok");
    }

    #[test]
    fn extracts_object_ignoring_braces_inside_string_values() {
        let raw = r#"{"score": 60, "summary": "Uses {templates} in bullet points"}"#;
        let a = parse_cv_analysis(raw);
        assert_eq!(a.score, Some(60));
        assert_eq!(a.summary, "Uses {templates} in bullet points");
    }

    #[test]
    fn extract_json_object_none_when_unbalanced() {
        assert_eq!(extract_json_object(r#"{"score": 1, "summary": "oops"#), None);
    }

    #[test]
    fn clamps_out_of_range_score() {
        let a = parse_cv_analysis(r#"{"score": 250, "summary": "x"}"#);
        assert_eq!(a.score, Some(100));
    }

    #[test]
    fn parses_score_from_float_string_and_fraction() {
        // Float score (common from browser models).
        assert_eq!(
            parse_cv_analysis(r#"{"score": 85.0, "summary": "x"}"#).score,
            Some(85)
        );
        // Float that rounds.
        assert_eq!(
            parse_cv_analysis(r#"{"score": 72.6, "summary": "x"}"#).score,
            Some(73)
        );
        // Bare numeric string.
        assert_eq!(
            parse_cv_analysis(r#"{"score": "85", "summary": "x"}"#).score,
            Some(85)
        );
        // "n/100" fraction form.
        assert_eq!(
            parse_cv_analysis(r#"{"score": "78/100", "summary": "x"}"#).score,
            Some(78)
        );
        // Percentage form with surrounding whitespace.
        assert_eq!(
            parse_cv_analysis(r#"{"score": " 90% ", "summary": "x"}"#).score,
            Some(90)
        );
    }

    #[test]
    fn lenient_score_still_populates_summary_and_lists() {
        // Regression: a non-integer score must NOT nuke the rest of the object.
        let a = parse_cv_analysis(
            r#"{"score": "88/100", "summary": "solid", "strengths": ["Rust"]}"#,
        );
        assert_eq!(a.score, Some(88));
        assert_eq!(a.summary, "solid");
        assert_eq!(a.strengths, vec!["Rust".to_string()]);
    }

    #[test]
    fn unparseable_score_falls_back_to_none_not_empty_object() {
        // Garbage score → None, but summary/lists survive.
        let a = parse_cv_analysis(r#"{"score": "excellent", "summary": "ok"}"#);
        assert_eq!(a.score, None);
        assert_eq!(a.summary, "ok");
    }

    #[test]
    fn parses_object_with_trailing_commas() {
        let a = parse_cv_analysis(
            r#"{"score": 77, "summary": "ok", "strengths": ["a", "b",],}"#,
        );
        assert_eq!(a.score, Some(77));
        assert_eq!(a.summary, "ok");
        assert_eq!(a.strengths, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn strip_trailing_commas_leaves_string_commas_intact() {
        // Commas inside string values (incl. before a brace) must be preserved.
        let s = r#"{"summary": "a, b, c",}"#;
        assert_eq!(strip_trailing_commas(s), r#"{"summary": "a, b, c"}"#);
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
            hr_name: Some("Alice Wong"),
            hr_link: Some("https://linkedin.com/in/awong"),
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
