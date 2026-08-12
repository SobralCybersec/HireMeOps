//! Pure prompt construction + response parsing for AI-backed CV/application features.
//!
//! Key: Language — output language enum driving prompt wording + LaTeX section titles
//! Key: cv_analysis_system / cv_rewrite_system / draft_system — the system prompt builders
//! Key: INDEED_ANSWER_PROMPT_VERSION — cache-busting version for the Indeed answer prompt
//! Key: indeed_answer_system — system prompt for one-question Indeed free-text answers
//! Key: clean_latex / clean_bullets — post-parse cleanup of rewritten CV content

use serde::{Deserialize, Serialize};

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

pub const CV_REWRITE_PROMPT_VERSION: &str = "cv-rewrite-v7";

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
        self.name = self.name.trim().to_string();
        self.summary = self.summary.trim().to_string();
        self.accent_color = self.accent_color.trim().trim_start_matches('#').to_string();
        self.photo_url = self.photo_url.trim().to_string();
        self.contact = CvContact {
            email: self.contact.email.trim().to_string(),
            phone: self.contact.phone.trim().to_string(),
            location: self.contact.location.trim().to_string(),
            linkedin: self.contact.linkedin.trim().to_string(),
            github: self.contact.github.trim().to_string(),
            gitlab: self.contact.gitlab.trim().to_string(),
            website: self.contact.website.trim().to_string(),
        };
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

const REWRITE_JSON_SHAPE: &str = "{\"name\": <string>, \
     \"contact\": {\"email\": <string>, \"phone\": <string>, \"location\": <string>, \
     \"linkedin\": <string>, \"github\": <string>, \"gitlab\": <string>, \"website\": <string>}, \
     \"positions\": [<string>], \
     \"summary\": <string>, \"skills\": [{\"category\": <string>, \"skills\": <string>}], \
     \"experience\": [{\"title\": <string>, \"organization\": <string>, \"location\": <string>, \
     \"dates\": <string>, \"bullets\": [<string>]}], \"education\": [{\"degree\": <string>, \
     \"institution\": <string>, \"location\": <string>, \"dates\": <string>, \
     \"bullets\": [<string>]}]}";

pub fn cv_rewrite_system(lang: Language) -> String {
    match lang {
        Language::En => format!(
            "You are an expert CV writer. Rewrite the candidate's CV, tailored to the \
             target role, using ONLY real facts from the source CV and candidate-supplied \
             additional context — never invent employers, degrees, dates, or credentials. \
             If the source CV is empty, minimal, or says this is a first CV, create a \
             first-time CV from the candidate-supplied context, but leave unknown fields \
             empty instead of guessing. Respond with ONLY a single JSON \
             object (no prose, no markdown fences) of the exact shape: {REWRITE_JSON_SHAPE}. \
             \"positions\" are the target job titles. Write each \"position\" as the JOB TITLE \
             HELD BY THE PERSON — a profession noun (e.g. \"Software Engineer\", \"Backend \
             Developer\", \"Data Analyst\") — and NEVER as the name of the field, degree, or \
             discipline (e.g. \"Software Engineering\", \"Development\", \"Data Science\" are \
             WRONG). Each skill group's \"skills\" is one \
             comma-separated list string. Be COMPACT with skills: use AT MOST 4 skill \
             groups, each with 4 to 8 items (short noun phrases: tools, technologies, \
             concepts — no sentences or verbs). Group by affinity (e.g. Languages; Backend \
             and Systems; Frontend and Desktop; Tooling, Quality and DevOps). Remove exact \
             and near duplicates (e.g. \"REST APIs\" and \"REST API\"; \"TypeScript\" repeated \
             in two groups). Prioritize the strongest skills most relevant to the target \
             role, and merge stray items into existing groups instead of creating new ones. Copy the \"contact\" block VERBATIM from the source \
             CV or candidate-supplied context — email, phone, city/location, LinkedIn, GitHub, \
             GitLab, and portfolio/website (a handle or full URL exactly as written); leave a field empty \
             ONLY when neither source provides it, and NEVER invent contact details. Fill EVERY \
             contact field the source CV or context contains: a missing phone number, \
             GitLab/GitHub profile, or portfolio link leaves recruiters unable to reach you. \
             For each education entry, add 1 to 2 short bullets with REAL, widely known \
             facts about the institution and the course (e.g. a highly ranked public \
             university known for X research; a course with emphasis on Y) — never invent \
             dates, honorary titles, or unverifiable specifics; if unsure, omit the bullet. Write ALL human-readable content — the summary, \
             every bullet, skills, positions, titles, and organizations — in English, \
             translating it from the source CV when the source is in another language \
             (e.g. Portuguese). Keep bullets concise, achievement-focused, and grounded in \
             the source CV. EVERY experience entry MUST have 3 to 5 achievement bullets \
             (never fewer than 3 — a role with 1 or 2 lines looks thin). When a PRIOR ANALYSIS block is provided, you MUST act on it: fix \
             every listed weakness, apply each recommendation, and weave in the missing \
             keywords wherever the source CV truthfully supports them (never fabricate \
             experience to match a keyword). Preserve the listed strengths. \
             To make the CV scannable and engaging, mark the 1–3 highest-impact phrases in \
             the summary and in EACH bullet with markdown bold using double asterisks — e.g. \
             \"cut p99 latency by **40%**\" or \"led a team of **8 engineers**\". Favor metrics, \
             technologies, scope, and outcomes. Never bold whole sentences, and only use bold \
             inside the summary and the bullets — never in names, titles, dates, or skills. \
             Write bullets in implied first person led by strong past-tense action verbs \
             (Developed, Led, Built, Implemented, Optimized) — never third-person narration like \
             \"He developed\" or \"She led\". Vary the opening verb across bullets so they don't \
             all start the same way."
        ),
        Language::Pt => format!(
            "Você é um especialista em redação de currículos. Reescreva o currículo do \
             candidato, adaptado à vaga-alvo, usando APENAS fatos reais do currículo de \
             origem e do contexto adicional fornecido pelo candidato — nunca invente \
             empregadores, formações, datas ou credenciais. Se o currículo de origem estiver \
             vazio, mínimo ou indicar que este é o primeiro currículo, crie um primeiro \
             currículo a partir do contexto adicional do candidato, mas deixe campos \
             desconhecidos vazios em vez de chutar. Responda \
             com APENAS um único objeto JSON (sem prosa, sem cercas de markdown) exatamente \
             no formato: {REWRITE_JSON_SHAPE}. As chaves do JSON permanecem em inglês. \
             \"positions\" são os cargos-alvo. Escreva cada \"position\" como o NOME DO \
             CARGO EXERCIDO PELA PESSOA — substantivo de profissão (ex.: \"Engenheiro de \
             Software\", \"Desenvolvedor Backend\", \"Analista de Dados\") — e NUNCA como o \
             nome da área, curso ou disciplina (ex.: \"Engenharia de Software\", \
             \"Desenvolvimento\", \"Ciência de Dados\" são formas ERRADAS). O \"skills\" de \
             cada grupo é uma única string \
             com uma lista separada por vírgulas. Seja ENXUTO nas habilidades: use no MÁXIMO \
             4 grupos de habilidades, cada um com 4 a 8 itens (termos curtos: ferramentas, \
             tecnologias, conceitos — sem frases nem verbos). Agrupe por afinidade (ex.: \
             Linguagens; Backend e Sistemas; Frontend e Desktop; Ferramentas, Qualidade e \
             DevOps). Elimine duplicatas exatas e quase-duplicatas (ex.: \"APIs REST\" e \
             \"REST API\"; \"TypeScript\" repetido em dois grupos). Priorize as habilidades \
             mais fortes e mais relevantes para a vaga-alvo, e mescle itens isolados em \
             grupos já existentes em vez de criar grupos novos. Copie o bloco \"contact\" LITERALMENTE do \
             currículo de origem ou do contexto adicional do candidato — email, telefone, \
             cidade/localização, LinkedIn, GitHub, GitLab e portfólio/website (usuário ou URL completa, \
             exatamente como escrito); deixe um campo vazio SOMENTE se nenhuma fonte o tiver, \
             e NUNCA invente dados de contato. Preencha TODO campo de contato que o currículo ou \
             o contexto contenha: um número de telefone, perfil GitLab/GitHub ou link de \
             portfólio ausente impede recrutadores de entrar em contato com o candidato. \
             Para cada entrada de educação, adicione 1 a 2 bullets curtos com informações \
             REAIS e amplamente conhecidas sobre a instituição e o curso (ex.: universidade \
             pública federal reconhecida em pesquisa de X; curso com ênfase em Y; nota alta \
             em avaliações oficiais conhecidas) — nunca invente datas, títulos honoríficos ou \
             detalhes específicos não verificáveis; se não tiver certeza, omita o bullet.
             Escreva TODO o conteúdo legível — o resumo, \
             cada bullet, habilidades, cargos, títulos e organizações — em Português (pt-BR), \
             traduzindo do currículo de origem quando ele estiver em outro idioma. Mantenha os \
             bullets concisos, focados em conquistas e fundamentados no currículo de origem. \
             CADA entrada de experiência DEVE ter entre 3 e 5 bullets de conquistas (nunca \
             menos de 3 — o currículo fica pobre com 1 ou 2 linhas). \
             Quando um bloco PRIOR ANALYSIS for fornecido, você DEVE agir sobre ele: corrija \
             cada fraqueza listada, aplique cada recomendação e incorpore as palavras-chave \
             ausentes onde o currículo de origem realmente as sustente (nunca fabrique \
             experiência para corresponder a uma palavra-chave). Preserve os pontos fortes \
             listados. Para tornar o currículo escaneável e envolvente, destaque as 1–3 frases \
             de maior impacto no resumo e em CADA bullet com negrito markdown usando asteriscos \
             duplos — ex.: \"reduziu a latência p99 em **40%**\" ou \"liderou uma equipe de \
             **8 engenheiros**\". Priorize métricas, tecnologias, escopo e resultados. Nunca \
             coloque frases inteiras em negrito, e use negrito apenas dentro do resumo e dos \
             bullets — nunca em nomes, títulos, datas ou habilidades. Escreva os bullets de \
             forma IMPESSOAL, começando por SUBSTANTIVOS de ação — ex.: \"Desenvolvimento de …\", \
             \"Implementação de …\", \"Liderança de …\", \"Otimização de …\", \"Automação de …\", \
             \"Integração de …\", \"Criação de …\", \"Gestão de …\" — e NUNCA com verbos conjugados \
             na 3ª pessoa (\"Desenvolveu\", \"Implementou\", \"Liderou\"), que soam como se outra \
             pessoa estivesse descrevendo o candidato. Varie o substantivo inicial entre os \
             bullets para não repetir. O resumo também deve ser impessoal, sem narração em 3ª \
             pessoa."
        ),
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
        "{target}{directive}{guidance}{extra}CV CONTENT (may be sparse for first-time CVs):\n{}",
        clip(cv_text)
    )
}

fn cv_rewrite_analysis_block(a: &CvAnalysis) -> String {
    let mut lines: Vec<String> = Vec::new();
    if let Some(score) = a.score {
        lines.push(format!(
            "This CV scored {score}/100 in a prior review{}.",
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
        "MISSING KEYWORDS to weave in where truthful",
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
        .map(|s| s.trim().to_string())
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
        assert_eq!(
            extract_json_object(r#"{"score": 1, "summary": "oops"#),
            None
        );
    }

    #[test]
    fn clamps_out_of_range_score() {
        let a = parse_cv_analysis(r#"{"score": 250, "summary": "x"}"#);
        assert_eq!(a.score, Some(100));
    }

    #[test]
    fn parses_score_from_float_string_and_fraction() {
        assert_eq!(
            parse_cv_analysis(r#"{"score": 85.0, "summary": "x"}"#).score,
            Some(85)
        );
        assert_eq!(
            parse_cv_analysis(r#"{"score": 72.6, "summary": "x"}"#).score,
            Some(73)
        );
        assert_eq!(
            parse_cv_analysis(r#"{"score": "85", "summary": "x"}"#).score,
            Some(85)
        );
        assert_eq!(
            parse_cv_analysis(r#"{"score": "78/100", "summary": "x"}"#).score,
            Some(78)
        );
        assert_eq!(
            parse_cv_analysis(r#"{"score": " 90% ", "summary": "x"}"#).score,
            Some(90)
        );
    }

    #[test]
    fn lenient_score_still_populates_summary_and_lists() {
        let a =
            parse_cv_analysis(r#"{"score": "88/100", "summary": "solid", "strengths": ["Rust"]}"#);
        assert_eq!(a.score, Some(88));
        assert_eq!(a.summary, "solid");
        assert_eq!(a.strengths, vec!["Rust".to_string()]);
    }

    #[test]
    fn unparseable_score_falls_back_to_none_not_empty_object() {
        let a = parse_cv_analysis(r#"{"score": "excellent", "summary": "ok"}"#);
        assert_eq!(a.score, None);
        assert_eq!(a.summary, "ok");
    }

    #[test]
    fn parses_object_with_trailing_commas() {
        let a = parse_cv_analysis(r#"{"score": 77, "summary": "ok", "strengths": ["a", "b",],}"#);
        assert_eq!(a.score, Some(77));
        assert_eq!(a.summary, "ok");
        assert_eq!(a.strengths, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn strip_trailing_commas_leaves_string_commas_intact() {
        let s = r#"{"summary": "a, b, c",}"#;
        assert_eq!(strip_trailing_commas(s), r#"{"summary": "a, b, c"}"#);
    }

    #[test]
    fn strip_trailing_commas_preserves_multibyte_utf8() {
        let s = r#"{"summary": "formação em projetos autônomos, aplicações escaláveis",}"#;
        let out = strip_trailing_commas(s);
        assert_eq!(
            out,
            r#"{"summary": "formação em projetos autônomos, aplicações escaláveis"}"#
        );
        assert!(!out.contains('Ã') && !out.contains('Â'));
        let a = parse_cv_analysis(&out);
        assert_eq!(
            a.summary,
            "formação em projetos autônomos, aplicações escaláveis"
        );
    }

    #[test]
    fn infers_optimization_needed_when_flag_absent() {
        let a = parse_cv_analysis(r#"{"score": 40, "summary": "weak"}"#);
        assert!(a.optimization_needed);
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
        let p = cv_analysis_prompt(&big, Some("  Backend Engineer  "), Language::En);
        assert!(p.contains("Backend Engineer"));
        assert!(p.contains("[truncated]"));
        assert!(p.len() < 13_000);
        let p2 = cv_analysis_prompt("short", Some("   "), Language::En);
        assert!(!p2.contains("targeting"));
    }

    #[test]
    fn rewrite_prompt_supports_first_time_cv_context() {
        let p = cv_rewrite_prompt(
            "First CV",
            Some("Junior Backend Developer"),
            None,
            Language::En,
            Some("Name: Jane Doe\nProject: Rust CLI\nGitHub: https://github.com/jane"),
        );
        assert!(p.contains("Junior Backend Developer"));
        assert!(p.contains("required for first-time CVs"));
        assert!(p.contains("Name: Jane Doe"));
        assert!(p.contains("CV CONTENT (may be sparse for first-time CVs)"));

        let sys = cv_rewrite_system(Language::En);
        assert!(sys.contains("first-time CV"));
        assert!(sys.contains("leave unknown fields"));
    }

    #[test]
    fn parses_well_formed_draft_json() {
        let raw = r#"{"cover_letter": "Dear team, ...",
            "form_answers": [{"question": "Why us?", "answer": "Because."},
                             {"question": "", "answer": ""}],
            "summary": "Tailored.", "optimization_notes": "Add a metric."}"#;
        let d = parse_draft(raw);
        assert_eq!(d.cover_letter, "Dear team, ...");
        assert_eq!(d.form_answers.len(), 1);
        assert_eq!(d.form_answers[0].question, "Why us?");
        assert_eq!(d.optimization_notes, "Add a metric.");
    }

    #[test]
    fn draft_degrades_to_raw_cover_letter() {
        let d = parse_draft("Dear hiring manager, I am excited...");
        assert_eq!(d.cover_letter, "Dear hiring manager, I am excited...");
        assert!(d.form_answers.is_empty());
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

    #[test]
    fn indeed_answer_prompt_carries_question_and_grounding() {
        let p = indeed_answer_prompt(
            "Por que você quer esta vaga?",
            "Backend dev, 8y.",
            "EXPERIENCE: Rust, Go.",
        );
        assert!(p.contains("Por que você quer esta vaga?"));
        assert!(p.contains("Backend dev, 8y."));
        assert!(p.contains("EXPERIENCE: Rust, Go."));
        assert!(indeed_answer_system().contains(NEEDS_HUMAN_SENTINEL));
    }
}
