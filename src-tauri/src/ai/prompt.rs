//! Pure prompt construction + response parsing for AI-backed CV/application features.
//!
//! Key: Language — output language enum driving prompt wording + LaTeX section titles
//! Key: cv_analysis_system / cv_rewrite_system / draft_system — the system prompt builders
//! Key: INDEED_ANSWER_PROMPT_VERSION — cache-busting version for the Indeed answer prompt
//! Key: indeed_answer_system — system prompt for one-question Indeed free-text answers
//! Key: clean_latex / clean_bullets — post-parse cleanup of rewritten CV content

use serde::{Deserialize, Serialize};

#[path = "prompt_templates.rs"]
mod prompt_templates;
pub use prompt_templates::cv_rewrite_system;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Pt,
    En,
}

impl Language {
    pub fn parse(s: &str) -> Language {
        match s.trim().to_ascii_lowercase().as_str() {
            "en" | "eng" | "english" | "en-us" | "en-gb" | "en_us" => Language::En,
            _ => Language::Pt,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Language::Pt => "pt",
            Language::En => "en",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Language::Pt => "Portuguese (pt-BR)",
            Language::En => "English",
        }
    }
}

pub const CV_ANALYSIS_PROMPT_VERSION: &str = "cv-analysis-v2";

pub const DRAFT_PROMPT_VERSION: &str = "app-draft-v2";

const MAX_TEXT_CHARS: usize = 12_000;

fn clip(text: &str) -> String {
    if text.len() <= MAX_TEXT_CHARS {
        return text.to_string();
    }
    let mut end = MAX_TEXT_CHARS;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n…[truncated]", &text[..end])
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvAnalysis {
    pub score: Option<i64>,
    pub summary: String,
    pub optimization_needed: bool,
    pub missing_keywords: Vec<String>,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub recommendations: Vec<String>,
}

pub fn cv_analysis_system(lang: Language) -> String {
    format!(
        "You are a professional CV/resume reviewer. Analyse the candidate's CV and \
         respond with ONLY a single JSON object (no prose, no markdown fences) of the \
         exact shape: {{\"score\": <integer 0-100>, \"summary\": <string>, \
         \"optimization_needed\": <boolean>, \"missing_keywords\": [<string>], \
         \"strengths\": [<string>], \"weaknesses\": [<string>], \
         \"recommendations\": [<string>]}}. Keep arrays concise (max 8 items each). \
         Write ALL human-readable text (summary, strengths, weaknesses, \
         recommendations, missing_keywords) in {lang}, regardless of the source \
         CV's language. The JSON keys themselves stay in English.",
        lang = lang.name()
    )
}

pub fn cv_analysis_prompt(cv_text: &str, target_title: Option<&str>, lang: Language) -> String {
    let target = target_title
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| format!("The candidate is targeting the role: \"{t}\".\n\n"))
        .unwrap_or_default();
    format!(
        "{target}Respond in {lang}.\n\nCV CONTENT:\n{}",
        clip(cv_text),
        lang = lang.name()
    )
}

pub fn parse_cv_analysis(raw: &str) -> CvAnalysis {
    #[derive(Deserialize, Default)]
    struct Raw {
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
        let obj = strip_trailing_commas(obj);
        if let Ok(r) = serde_json::from_str::<Raw>(&obj) {
            let score = r.score.map(|s| s.clamp(0, 100));
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

#[derive(Debug, Clone)]
pub struct DraftInput<'a> {
    pub job_title: &'a str,
    pub company: &'a str,
    pub job_location: Option<&'a str>,
    pub job_description: &'a str,
    pub candidate_name: &'a str,
    pub candidate_summary: Option<&'a str>,
    pub cv_text: Option<&'a str>,
    pub variant_target: Option<&'a str>,
    pub hr_name: Option<&'a str>,
    pub hr_link: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FormAnswer {
    pub question: String,
    pub answer: String,
}

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

pub const INDEED_ANSWER_PROMPT_VERSION: &str = "indeed-answer-v3";

pub const NEEDS_HUMAN_SENTINEL: &str = "[NEEDS_HUMAN]";

pub fn indeed_answer_system() -> String {
    "You draft one job-application answer for the candidate. Output ONLY the \
     answer text — no preamble, no quotes, no sign-off. Reply in the language of \
     the JOB and the candidate's CV/profile below — for these roles that is \
     almost always Portuguese (pt-BR). Do NOT mirror the question's language: \
     LinkedIn shows many question labels in English even for Portuguese jobs, so \
     answer in the candidate's/job's language (Portuguese) unless the CV itself \
     is clearly written in another language, in which case match the CV. Write \
     first person, factual, grounded strictly in the candidate summary and CV \
     below; never invent employers, dates, degrees, or skills. \"Why this \
     role/company\": 2-4 sentences. Factual questions (education, availability, \
     notice period): 1-2 sentences. If asked for a project or portfolio, include \
     the candidate's GitHub/portfolio URL when present. No buzzwords or filler. \
     If the question cannot be answered honestly from the profile/CV, output \
     exactly [NEEDS_HUMAN] and nothing else."
        .to_string()
}

pub fn indeed_answer_prompt(question: &str, summary: &str, cv_text: &str) -> String {
    format!(
        "questionText: {}\ncandidateProfileSummary: {}\ncvText:\n{}\nAnswer:",
        question.trim(),
        summary.trim(),
        clip(cv_text)
    )
}

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

fn strip_trailing_commas(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(s.len());
    let mut in_string = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_string {
            out.push(b);
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
                out.push(b'"');
            }
            b',' => {
                let next = bytes[i + 1..].iter().find(|c| !c.is_ascii_whitespace());
                match next {
                    Some(b'}') | Some(b']') => {}
                    _ => out.push(b','),
                }
            }
            _ => out.push(b),
        }
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

fn deserialize_lenient_score<'de, D>(de: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize as _;
    let v = serde_json::Value::deserialize(de)?;
    Ok(match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f.round() as i64)),
        serde_json::Value::String(s) => {
            let s = s.trim();
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

pub const CV_REWRITE_PROMPT_VERSION: &str = "cv-rewrite-v15";
pub const COVER_LETTER_PROMPT_VERSION: &str = "cover-letter-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvSkillGroup {
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub skills: String,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CvCertificate {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub issuer: String,
    #[serde(default, alias = "credential_id")]
    pub credential_id: String,
    #[serde(default, alias = "issueDate", alias = "issue_date")]
    pub date: String,
    #[serde(default, alias = "url", alias = "credential_url")]
    pub credential_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvContact {
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub linkedin: String,
    #[serde(default)]
    pub github: String,
    #[serde(default)]
    pub gitlab: String,
    #[serde(default)]
    pub website: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CvRewrite {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub contact: CvContact,
    #[serde(default)]
    pub positions: Vec<String>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub skills: Vec<CvSkillGroup>,
    #[serde(default)]
    pub experience: Vec<CvExperienceEntry>,
    #[serde(default)]
    pub education: Vec<CvEducationEntry>,
    #[serde(default)]
    pub certificates: Vec<CvCertificate>,
    /// AI-generated body for the standalone cover-letter PDF.
    #[serde(default, rename = "coverLetter", alias = "cover_letter")]
    pub cover_letter: String,
    #[serde(default)]
    pub language: Language,
    /// Hex accent for the CV header/rules (e.g. "2B0A3D"); empty = template default.
    /// Presentation-only — the AI never fills this; the UI color picker does.
    #[serde(default, rename = "accentColor")]
    pub accent_color: String,
    /// Headshot: an http(s) URL on input. `build_pdf_tex` downloads it and rewrites
    /// this field to the local workdir filename before the tex is generated.
    /// Empty = no photo.
    #[serde(default, rename = "photoUrl")]
    pub photo_url: String,
}

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
    fn cleaned(mut self) -> CvRewrite {
        self.name = strip_research_artifacts(&self.name);
        self.summary = strip_research_artifacts(&self.summary);
        self.accent_color = self.accent_color.trim().trim_start_matches('#').to_string();
        self.photo_url = self.photo_url.trim().to_string();
        self.contact = CvContact {
            email: strip_research_artifacts(&self.contact.email),
            phone: strip_research_artifacts(&self.contact.phone),
            location: strip_research_artifacts(&self.contact.location),
            linkedin: strip_research_artifacts(&self.contact.linkedin),
            github: strip_research_artifacts(&self.contact.github),
            gitlab: strip_research_artifacts(&self.contact.gitlab),
            website: strip_research_artifacts(&self.contact.website),
        };
        self.positions = clean(std::mem::take(&mut self.positions));
        self.skills = std::mem::take(&mut self.skills)
            .into_iter()
            .map(|g| CvSkillGroup {
                category: strip_research_artifacts(&g.category),
                skills: strip_research_artifacts(&g.skills),
            })
            .filter(|g| !g.category.is_empty() || !g.skills.is_empty())
            .collect();
        self.experience = std::mem::take(&mut self.experience)
            .into_iter()
            .map(|e| CvExperienceEntry {
                title: strip_research_artifacts(&e.title),
                organization: strip_research_artifacts(&e.organization),
                location: strip_research_artifacts(&e.location),
                dates: strip_research_artifacts(&e.dates),
                bullets: clean_bullets(e.bullets),
            })
            .filter(|e| !e.title.is_empty() || !e.organization.is_empty() || !e.bullets.is_empty())
            .collect();
        self.education = std::mem::take(&mut self.education)
            .into_iter()
            .map(|e| CvEducationEntry {
                degree: strip_research_artifacts(&e.degree),
                institution: strip_research_artifacts(&e.institution),
                location: strip_research_artifacts(&e.location),
                dates: strip_research_artifacts(&e.dates),
                bullets: clean_bullets(e.bullets),
            })
            .filter(|e| !e.degree.is_empty() || !e.institution.is_empty() || !e.bullets.is_empty())
            .collect();
        self.certificates = std::mem::take(&mut self.certificates)
            .into_iter()
            .map(|c| CvCertificate {
                name: strip_research_artifacts(&c.name),
                issuer: strip_research_artifacts(&c.issuer),
                credential_id: strip_research_artifacts(&c.credential_id),
                date: strip_research_artifacts(&c.date),
                credential_url: strip_research_artifacts(&c.credential_url),
            })
            .filter(|c| {
                !c.name.is_empty()
                    || !c.issuer.is_empty()
                    || !c.credential_id.is_empty()
                    || !c.date.is_empty()
                    || !c.credential_url.is_empty()
            })
            .collect();
        self.cover_letter = strip_research_artifacts(&self.cover_letter);
        self
    }

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

pub fn cv_rewrite_prompt(
    cv_text: &str,
    target_title: Option<&str>,
    analysis: Option<&CvAnalysis>,
    lang: Language,
    extra_context: Option<&str>,
) -> String {
    let target = target_title
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| match lang {
            Language::En => format!("Rewrite and tailor the CV for the role: \"{t}\".\n\n"),
            Language::Pt => format!("Reescreva e adapte o currículo para a vaga: \"{t}\".\n\n"),
        })
        .unwrap_or_default();
    let directive = match lang {
        Language::En => "Write the entire rewritten CV in English.\n\n",
        Language::Pt => "Escreva todo o currículo reescrito em Português (pt-BR).\n\n",
    };
    let recruiter_focus = match lang {
        Language::En => "RECRUITER-FIRST ADAPTATION:\nTreat `summary` as a 3–5 sentence Professional Profile that states the candidate's direction, evidence, working style, and value. In `experience`, lead every entry with one verified relevance/context bullet, then prove capabilities through distinct actions and outcomes. Prefer evidence over adjectives and keywords; preserve source metrics exactly and omit unsupported claims.\n\n",
        Language::Pt => "ADAPTAÇÃO RECRUITER-FIRST:\nTrate `summary` como um Professional Profile de 3–5 frases que apresente a direção, as evidências, a forma de trabalho e o valor do candidato. Em `experience`, comece cada entrada com um bullet de relevância/contexto verificado e depois prove as capacidades por ações e resultados distintos. Prefira evidências a adjetivos e palavras-chave; preserve exatamente as métricas da fonte e omita afirmações sem suporte.\n\n",
    };
    let guidance = analysis.map(cv_rewrite_analysis_block).unwrap_or_default();
    let extra = extra_context
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| match lang {
            Language::En => format!(
                "ADDITIONAL CONTEXT FROM THE CANDIDATE (required for first-time CVs): \
                 name/contact, target role, education, projects, work/volunteer/freelance \
                 experience, skills/tools, languages, certifications/courses, links, \
                 achievements/metrics, availability, and notes. Use it as source material \
                 where truthful; do not invent facts:\n{}\n\n",
                clip(s)
            ),
            Language::Pt => format!(
                "CONTEXTO ADICIONAL DO CANDIDATO (obrigatório para primeiro currículo): \
                 nome/contato, vaga-alvo, formação, projetos, experiência profissional/voluntária/ \
                 freelance, habilidades/ferramentas, idiomas, certificações/cursos, links, \
                 conquistas/métricas, disponibilidade e observações. Use como material de origem \
                 quando verdadeiro; não invente fatos:\n{}\n\n",
                clip(s)
            ),
        })
        .unwrap_or_default();
    format!(
        "{target}{directive}{recruiter_focus}{guidance}{extra}CV CONTENT (may be sparse for first-time CVs):\n{}",
        clip(cv_text)
    )
}

/// True when source material contains an explicit certificate/licence claim.
/// This gate prevents a model from adding the section from skills or research alone.
pub fn has_explicit_certificates(source: &str, extra_context: Option<&str>) -> bool {
    let combined = format!("{}\n{}", source, extra_context.unwrap_or_default()).to_lowercase();
    if [
        "no certificate",
        "no certification",
        "no certifications",
        "without certification",
        "sem certificado",
        "sem certificação",
        "não tenho certificado",
        "nao tenho certificado",
    ]
    .iter()
    .any(|needle| combined.contains(needle))
    {
        return false;
    }
    [
        "certificate",
        "certification",
        "certified",
        "certs",
        "credential",
        "certificado",
        "certificação",
        "certificacao",
        "certificações",
        "certificacoes",
        "credencial",
        "licence",
        "license",
        "licença",
        "licenca",
    ]
    .iter()
    .any(|needle| combined.contains(needle))
}

pub fn cover_letter_system(lang: Language) -> String {
    match lang {
        Language::En => "You are an expert career writer. Write only the body of a concise, "
            .to_string()
            + "tailored cover letter grounded in the generated CV. Use 3 to 5 short paragraphs "
            + "separated by blank lines. Do not add a greeting, sign-off, markdown, headings, "
            + "placeholders, citations, or facts not present in the CV. Do not mention a company "
            + "or job detail that was not provided. Return plain text only.",
        Language::Pt => "Você é um especialista em redação profissional. Escreva somente o corpo "
            .to_string()
            + "de uma carta de apresentação concisa e adaptada, fundamentada no currículo gerado. "
            + "Use de 3 a 5 parágrafos curtos separados por linhas em branco. Não inclua saudação, "
            + "despedida, markdown, títulos, placeholders, citações ou fatos ausentes no currículo. "
            + "Não mencione empresa ou detalhe de vaga que não foi fornecido. Retorne apenas texto simples.",
    }
}

pub fn cover_letter_prompt(cv: &CvRewrite, target_title: Option<&str>, lang: Language) -> String {
    let role = target_title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| cv.positions.first().map(String::as_str))
        .unwrap_or("the target role");
    let cv_json = serde_json::to_string(cv).unwrap_or_else(|_| "{}".to_string());
    let instruction = match lang {
        Language::En => "Write the letter body in English.",
        Language::Pt => "Escreva o corpo da carta em Português (pt-BR).",
    };
    format!("TARGET ROLE: {role}\n{instruction}\nGENERATED CV JSON (source of truth):\n{cv_json}")
}

pub fn parse_cover_letter(raw: &str) -> String {
    let raw = raw.trim();
    if let Some(obj) = extract_json_object(raw) {
        #[derive(Deserialize)]
        struct RawLetter {
            #[serde(alias = "coverLetter")]
            cover_letter: Option<String>,
        }
        if let Ok(parsed) = serde_json::from_str::<RawLetter>(obj) {
            if let Some(letter) = parsed.cover_letter.filter(|s| !s.trim().is_empty()) {
                return clean_cover_letter(&letter);
            }
        }
    }
    clean_cover_letter(
        raw.trim_start_matches("```text")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim(),
    )
}

fn clean_cover_letter(raw: &str) -> String {
    let mut text = strip_research_artifacts(raw).trim().to_string();
    if let Some(rest) = text.strip_prefix(":::writing") {
        let rest = rest.trim_start();
        text = if rest.starts_with('{') {
            rest.find('}')
                .map(|end| rest[end + 1..].trim_start().to_string())
                .unwrap_or_else(|| rest.to_string())
        } else {
            rest.to_string()
        };
    }
    text.strip_suffix(":::")
        .map(str::trim_end)
        .unwrap_or(&text)
        .to_string()
}

fn cv_rewrite_analysis_block(a: &CvAnalysis) -> String {
    let mut lines: Vec<String> = Vec::new();
    if let Some(score) = a.score {
        lines.push(format!(
            "This CV scored {score}/100 in a prior review{}; use this only as guidance and verify every claim against the source.",
            if a.optimization_needed {
                " and REQUIRES optimization"
            } else {
                ""
            }
        ));
    }
    let list = |label: &str, items: &[String]| -> Option<String> {
        let items: Vec<&str> = items
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        (!items.is_empty()).then(|| format!("{label}: {}", items.join("; ")))
    };
    if let Some(l) = list("WEAKNESSES to fix", &a.weaknesses) {
        lines.push(l);
    }
    if let Some(l) = list("RECOMMENDATIONS to apply", &a.recommendations) {
        lines.push(l);
    }
    if let Some(l) = list(
        "MISSING ROLE SIGNALS to include only when truthfully supported",
        &a.missing_keywords,
    ) {
        lines.push(l);
    }
    if let Some(l) = list("STRENGTHS to preserve", &a.strengths) {
        lines.push(l);
    }
    if lines.is_empty() {
        return String::new();
    }
    format!(
        "PRIOR ANALYSIS — address this in the rewrite:\n{}\n\n",
        lines.join("\n")
    )
}

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

fn clean_bullets(items: Vec<String>) -> Vec<String> {
    items
        .into_iter()
        .map(|s| strip_research_artifacts(&s))
        .filter(|s| !s.is_empty())
        .collect()
}

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

fn clean_latex(text: &str) -> String {
    strip_braces_backslashes(&strip_cmd_braces(text))
        .replace("**", "")
        .trim()
        .to_string()
}

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
        let Some(ch) = s[i..].chars().next() else {
            break;
        };
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

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
            let Some(ch) = s[i..].chars().next() else {
                break;
            };
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn strip_braces_backslashes(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '{' && c != '}' && c != '\\')
        .collect()
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean(items: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    items
        .into_iter()
        .map(|s| strip_research_artifacts(&s))
        .filter(|s| !s.is_empty() && seen.insert(s.to_lowercase()))
        .collect()
}

/// Strip the "research" artifacts a browsing ChatGPT injects into otherwise clean
/// CV text when web_search is on. Removes citation tokens (`cite turn…search…`,
/// `filecite turn1file0 L2‑L2`), reference markers (`([Estácio Blog][1])`,
/// `[text][2]`), tracking query params (`?utm_source=chatgpt.com`), and unwraps
/// markdown links (`[matheus@x.com](mailto:matheus@x.com)` → `matheus@x.com`;
/// `[https://site](https://site?utm=…)` → `https://site`). Also folds the
/// non-breaking hyphen (U+2011) the browser emits in date ranges back to a plain
/// `-`, and NBSP to a space. Leaves `**bold**` intact on purpose — the LaTeX
/// builder renders those spans as \textbf (see cv/latex.rs latex_escape_bold).
fn strip_research_artifacts(s: &str) -> String {
    use regex::Regex;
    // Compiled per call: a rewrite is one AI round-trip (seconds+), so this is
    // never a hot path and needs no lazy-static machinery.
    let utm = Regex::new(r"[?&]utm_[a-z_]+=[^\s)&\]]*").unwrap();
    let md_link = Regex::new(r"\[([^\]]+)\]\([^)]*\)").unwrap();
    let citation = Regex::new(
        r"(?i)\s*(?:\(?\[[^\]]*\]\[\d+\]\)?|(?:file)?cite(?:\s+turn\w+|\s+L\d+[-\x{2010}-\x{2015}]?L?\d*)+)",
    )
    .unwrap();
    let dbl_space = Regex::new(r"[ \t]{2,}").unwrap();

    let mut out = s.replace('\u{2011}', "-").replace('\u{00A0}', " ");
    out = utm.replace_all(&out, "").into_owned();
    out = md_link.replace_all(&out, "$1").into_owned();
    out = citation.replace_all(&out, "").into_owned();
    out = dbl_space.replace_all(&out, " ").into_owned();
    out.trim().to_string()
}

#[cfg(test)]
#[path = "prompt_tests.rs"]
mod tests;
