//! Structured `CvRewrite` → `curriculo.cls` LaTeX source.
//! Key: `generate_resume_tex` — full compilable resume.tex from a rewrite.
//! Key: `latex_escape` / `latex_escape_bold` — TeX-special escaping (bold handles `**markdown**` spans).
//! Key: `cventry` — one `\cventry{...}` block for experience/education.
//! Key: `strip_handle` — reduce a github/linkedin URL to its bare handle.

use crate::ai::prompt::{CvRewrite, Language};

#[cfg(test)]
#[path = "../tests/cv_latex_link_tests.rs"]
mod link_tests;

#[cfg(test)]
#[path = "../tests/cv_bold_tests.rs"]
mod bold_tests;

struct SectionTitles {
    summary: &'static str,
    education: &'static str,
    experience: &'static str,
    certificates: &'static str,
    skills: &'static str,
}

fn section_titles(lang: Language) -> SectionTitles {
    match lang {
        Language::Pt => SectionTitles {
            summary: "Perfil Profissional",
            education: "Educação",
            experience: "Experiência",
            certificates: "Certificados",
            skills: "Habilidades",
        },
        Language::En => SectionTitles {
            summary: "Professional Profile",
            education: "Education",
            experience: "Experience",
            certificates: "Certificates",
            skills: "Skills",
        },
    }
}

const POSITION_SEP: &str = "{\\enskip\\cdotp\\enskip}";

pub fn generate_resume_tex(cv: &CvRewrite) -> String {
    let mut out = String::with_capacity(2048);

    out.push_str("\\documentclass[11pt, a4paper]{curriculo}\n");
    // The bundled class enables an empty fancyhdr footer. CV exports do not use it;
    // disable that page style so the blank footer never creates a reserved gap.
    out.push_str("\\geometry{left=1.4cm, top=.8cm, right=1.4cm, bottom=1.0cm, footskip=0pt}\n");
    out.push_str("\\pagestyle{empty}\n");
    out.push_str("\\definecolor{verdeescuro}{HTML}{219150}\n");
    out.push_str(&format!(
        "\\definecolor{{cordeescolha}}{{HTML}}{{{}}}\n",
        sanitize_hex(&cv.accent_color).unwrap_or_else(|| "2B0A3D".to_string())
    ));
    out.push_str("\\colorlet{awesome}{cordeescolha}\n");
    out.push_str("\\definecolor{graytext}{HTML}{5D5D5D}\n");
    out.push_str("\\definecolor{lighttext}{HTML}{999999}\n");
    out.push_str("\\setbool{acvSectionColorHighlight}{true}\n");
    out.push_str("\\renewcommand{\\acvHeaderSocialSep}{\\quad\\textbar\\quad}\n\n");

    append_personal_info(&mut out, cv);

    // ponytail: at build time build_pdf_tex sets photo_url to the LOCAL filename it wrote
    // into the xelatex workdir (e.g. "cvphoto.png"); empty = no photo. curriculo.cls already
    // ships \photo (circle,edge,left default), so no cls change is needed.
    if !cv.photo_url.trim().is_empty() {
        out.push_str(&format!("\\photo{{{}}}\n", cv.photo_url.trim()));
    }

    out.push_str("\n\\begin{document}\n\\makecvheader[C]\n\n");
    out.push_str(&generate_summary(cv));
    out.push_str(&generate_education(cv));
    out.push_str(&generate_experience(cv));
    out.push_str(&generate_certificates(cv));
    out.push_str(&generate_skills(cv));
    out.push_str("\\end{document}\n");

    out
}

pub fn generate_cover_letter_tex(cv: &CvRewrite) -> String {
    let mut out = String::with_capacity(2048);
    out.push_str("\\documentclass[11pt, a4paper]{curriculo}\n");
    out.push_str("\\geometry{left=1.4cm, top=.8cm, right=1.4cm, bottom=1.8cm, footskip=.5cm}\n");
    out.push_str("\\pagestyle{empty}\n");
    out.push_str("\\definecolor{cordeescolha}{HTML}{");
    out.push_str(&sanitize_hex(&cv.accent_color).unwrap_or_else(|| "2B0A3D".to_string()));
    out.push_str("}\n\\colorlet{awesome}{cordeescolha}\n");
    out.push_str("\\definecolor{graytext}{HTML}{5D5D5D}\n");
    out.push_str("\\definecolor{lighttext}{HTML}{999999}\n");
    out.push_str("\\setbool{acvSectionColorHighlight}{true}\n");
    out.push_str("\\renewcommand{\\acvHeaderSocialSep}{\\quad\\textbar\\quad}\n\n");

    append_personal_info(&mut out, cv);
    if !cv.photo_url.trim().is_empty() {
        out.push_str(&format!("\\photo{{{}}}\n", cv.photo_url.trim()));
    }

    let role = cv
        .positions
        .first()
        .map(String::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(match cv.language {
            Language::En => "Target Role",
            Language::Pt => "Cargo-alvo",
        });
    let (recipient, title_prefix, opening, closing, footer) = match cv.language {
        Language::En => (
            "Hiring Team",
            "Application for",
            "Dear Hiring Manager,",
            "Sincerely,",
            "Cover Letter",
        ),
        Language::Pt => (
            "Equipe de Recrutamento",
            "Candidatura para",
            "Prezada equipe de recrutamento,",
            "Atenciosamente,",
            "Carta de Apresentação",
        ),
    };
    // curriculo.cls ends the recipient address with a line break; a nonbreaking
    // space keeps that template command valid when no address was supplied.
    out.push_str(&format!("\n\\recipient{{{recipient}}}{{~}}\n"));
    out.push_str("\\letterdate{\\today}\n");
    out.push_str(&format!(
        "\\lettertitle{{{title_prefix} {}}}\n",
        latex_escape(&header_text(role))
    ));
    out.push_str(&format!("\\letteropening{{{opening}}}\n"));
    out.push_str(&format!("\\letterclosing{{{closing}}}\n\n"));
    out.push_str("\\begin{document}\n\\makecvheader[R]\n\\makecvfooter{\\today}{");
    out.push_str(&latex_escape(&header_text(&cv.name)));
    out.push_str(&format!("~~~·~~~{footer}}}{{}}\n\\makelettertitle\n\n"));
    out.push_str("\\begin{cvletter}\n");
    append_cover_letter_body(&mut out, &cv.cover_letter, cv.language);
    out.push_str("\\end{cvletter}\n\n\\makeletterclosing\n\\end{document}\n");
    out
}

fn append_cover_letter_body(out: &mut String, body: &str, language: Language) {
    let headings = match language {
        Language::En => ["About Me", "Why This Role", "What I Bring"],
        Language::Pt => ["Sobre Mim", "Por Que Esta Vaga", "O Que Ofereço"],
    };
    for (index, paragraph) in body.split("\n\n").enumerate() {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let heading = headings.get(index).copied().unwrap_or(match language {
            Language::En => "Additional Details",
            Language::Pt => "Detalhes Adicionais",
        });
        out.push_str(&format!(
            "\\lettersection{{{}}}\n{}\n",
            heading,
            latex_escape_bold(paragraph)
        ));
    }
}

fn append_personal_info(out: &mut String, cv: &CvRewrite) {
    let (first, last) = split_name(&header_text(&cv.name));
    out.push_str(&format!(
        "\\name{{{}}}{{{}}}\n",
        latex_escape(&first),
        latex_escape(&last)
    ));
    let position = cv
        .positions
        .iter()
        .map(|p| latex_escape(&header_text(p)))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(POSITION_SEP);
    if !position.is_empty() {
        out.push_str(&format!("\\position{{{position}}}\n"));
    }
    let c = &cv.contact;
    let mut has_social = false;
    if !c.location.trim().is_empty() {
        out.push_str(&format!(
            "\\address{{{}}}\n",
            latex_escape(&header_text(&c.location))
        ));
    }
    if !c.phone.trim().is_empty() {
        out.push_str(&format!(
            "\\mobile{{{}}}\n",
            latex_escape(&header_text(&c.phone))
        ));
    }
    if !c.email.trim().is_empty() {
        let email = header_text(&c.email).replace(r"\@", "@");
        out.push_str(&format!("\\email{{{}}}\n", latex_escape(&email)));
        has_social = true;
    }
    if !c.website.trim().is_empty() {
        let (_, icon) = url_platform(&header_url(&c.website));
        out.push_str(&format!("\\renewcommand{{\\acvHomepageIcon}}{{{icon}}}\n"));
        out.push_str(&format!(
            "\\homepage{{{}}}\n",
            latex_escape(&header_url(&c.website))
        ));
        has_social = true;
    }
    if !c.github.trim().is_empty() {
        out.push_str(&format!(
            "\\github{{{}}}\n",
            latex_escape(&strip_handle(&c.github, "github.com"))
        ));
        has_social = true;
    }
    if !c.gitlab.trim().is_empty() {
        out.push_str(&format!(
            "\\gitlab{{{}}}\n",
            latex_escape(&strip_handle(&c.gitlab, "gitlab.com"))
        ));
        has_social = true;
    }
    if !c.linkedin.trim().is_empty() {
        out.push_str(&format!(
            "\\linkedin{{{}}}\n",
            latex_escape(&strip_handle(&c.linkedin, "linkedin.com/in"))
        ));
        has_social = true;
    }
    if !has_social {
        out.push_str("\\extrainfo{~}\n");
    }
}

/// Validate a user-supplied hex color for `\definecolor{...}{HTML}{...}`.
/// Accepts `RRGGBB` or `#RRGGBB` (any case); returns the uppercase 6-digit form,
/// or None for anything else so the caller falls back to the template default.
/// This is the injection guard: only `[0-9A-F]{6}` ever reaches the TeX source.
fn sanitize_hex(raw: &str) -> Option<String> {
    let h = raw.trim().trim_start_matches('#');
    if h.len() == 6 && h.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(h.to_ascii_uppercase())
    } else {
        None
    }
}

fn generate_summary(cv: &CvRewrite) -> String {
    let summary = cv.summary.trim();
    if summary.is_empty() {
        return String::new();
    }
    format!(
        "\\cvsection{{{}}}\n\n\\begin{{cvparagraph}}\n{}\n\\end{{cvparagraph}}\n\n",
        latex_escape(section_titles(cv.language).summary),
        latex_escape_bold(summary),
    )
}

fn generate_education(cv: &CvRewrite) -> String {
    if cv.education.is_empty() {
        return String::new();
    }
    let mut s = format!(
        "\\cvsection{{{}}}\n\\begin{{cventries}}\n",
        latex_escape(section_titles(cv.language).education)
    );
    for e in &cv.education {
        s.push_str(&cventry(
            &e.degree,
            &e.institution,
            &e.location,
            &e.dates,
            &e.bullets,
        ));
    }
    s.push_str("\\end{cventries}\n\n");
    s
}

fn url_platform(url: &str) -> (&'static str, &'static str) {
    let host = reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .unwrap_or_default();
    for (domain, label, icon) in [
        ("github.com", "GitHub", "\\faGithub"),
        ("github.io", "GitHub", "\\faGithub"),
        ("gitlab.com", "GitLab", "\\faGitlab"),
        ("gitlab.io", "GitLab", "\\faGitlab"),
        ("behance.net", "Behance", "\\faBehance"),
        ("linkedin.com", "LinkedIn", "\\faLinkedin"),
    ] {
        if host == domain || host.ends_with(&format!(".{domain}")) {
            return (label, icon);
        }
    }
    ("Portfolio", "\\faGlobe")
}

fn generate_experience(cv: &CvRewrite) -> String {
    if cv.experience.is_empty() {
        return String::new();
    }
    let mut s = format!(
        "\\cvsection{{{}}}\n\\begin{{cventries}}\n",
        latex_escape(section_titles(cv.language).experience)
    );
    for e in &cv.experience {
        let location = if let Some(url) = normalized_http_url(&e.url) {
            let (label, icon) = url_platform(&url);
            format!(
                "\\href{{{}}}{{\\upshape {icon}\\enspace {label}\\,\\footnotesize\\faArrowUpRightFromSquare}}",
                latex_escape(&url)
            )
        } else {
            latex_escape(e.location.trim())
        };
        s.push_str(&cventry_raw_location(
            &e.title,
            &e.organization,
            &location,
            &e.dates,
            &e.bullets,
        ));
    }
    s.push_str("\\end{cventries}\n\n");
    s
}

fn generate_certificates(cv: &CvRewrite) -> String {
    let certificates: Vec<_> = cv
        .certificates
        .iter()
        .filter(|c| !c.name.trim().is_empty() || !c.issuer.trim().is_empty())
        .collect();
    if certificates.is_empty() {
        return String::new();
    }

    let mut s = format!(
        "\\cvsection{{{}}}\n\\begin{{cvhonors}}\n",
        latex_escape(section_titles(cv.language).certificates)
    );
    for c in certificates {
        let name = latex_link(&c.name, &c.credential_url);
        s.push_str(&format!(
            "  \\cvhonor\n    {{{name}}}\n    {{{}}}\n    {{}}\n    {{}}\n\n",
            latex_escape(c.issuer.trim()),
        ));
    }
    s.push_str("\\end{cvhonors}\n\n");
    s
}

fn generate_skills(cv: &CvRewrite) -> String {
    let groups: Vec<_> = cv
        .skills
        .iter()
        .filter(|g| !g.category.trim().is_empty() || !g.skills.trim().is_empty())
        .collect();
    if groups.is_empty() {
        return String::new();
    }
    let mut s = format!(
        "\\cvsection{{{}}}\n\\begin{{cvskills}}\n",
        latex_escape(section_titles(cv.language).skills)
    );
    for g in groups {
        s.push_str(&format!(
            "  \\cvskill\n    {{{}}}\n    {{{}}}\n\n",
            latex_escape_bold(g.category.trim()),
            latex_escape_bold(g.skills.trim()),
        ));
    }
    s.push_str("\\end{cvskills}\n\n");
    s
}

fn cventry_raw_location(a: &str, b: &str, c_raw: &str, d: &str, bullets: &[String]) -> String {
    let items: Vec<&str> = bullets
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let body = if items.is_empty() {
        String::new()
    } else {
        let mut inner = String::from("\n      \\begin{cvitems}\n");
        for it in items {
            inner.push_str(&format!("        \\item {{{}}}\n", latex_escape_bold(it)));
        }
        inner.push_str("      \\end{cvitems}\n    ");
        inner
    };
    format!(
        "  \\cventry\n    {{{}}}\n    {{{}}}\n    {{{}}}\n    {{{}}}\n    {{{}}}\n\n",
        latex_escape(a.trim()),
        latex_escape(b.trim()),
        c_raw.trim(),
        latex_escape(d.trim()),
        body,
    )
}

fn cventry(a: &str, b: &str, c: &str, d: &str, bullets: &[String]) -> String {
    cventry_raw_location(a, b, &latex_escape(c.trim()), d, bullets)
}

fn split_name(name: &str) -> (String, String) {
    let name = name.trim();
    match name.split_once(char::is_whitespace) {
        Some((first, rest)) => (first.trim().to_string(), rest.trim().to_string()),
        None => (name.to_string(), String::new()),
    }
}

fn header_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn header_url(value: &str) -> String {
    markdown_link_target(value)
        .map(header_text)
        .unwrap_or_else(|| header_text(value))
}

fn markdown_link_target(value: &str) -> Option<&str> {
    let start = value.find("](")? + 2;
    let end = value[start..].find(')')?;
    Some(&value[start..start + end])
}

fn strip_handle(value: &str, host_path: &str) -> String {
    let value = markdown_link_target(value).unwrap_or(value);
    let normalized = header_text(value);
    let v = normalized.trim_end_matches('/');
    let lower = v.to_ascii_lowercase();
    if let Some(idx) = lower.find(host_path) {
        return v[idx + host_path.len()..]
            .trim_start_matches('/')
            .trim_start_matches('@')
            .to_string();
    }
    v.trim_start_matches('@').to_string()
}

fn latex_link(label: &str, url: &str) -> String {
    let label = latex_escape(label.trim());
    let Some(url) = normalized_http_url(url) else {
        return label;
    };
    if label.is_empty() {
        return label;
    }
    format!("\\href{{{}}}{{{label}}}", latex_escape(&url))
}

fn is_http_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn normalized_http_url(value: &str) -> Option<String> {
    let candidate = markdown_link_target(value).unwrap_or(value);
    let candidate = candidate.trim();
    if candidate.chars().any(char::is_whitespace) {
        return None;
    }
    let parsed = reqwest::Url::parse(candidate).ok()?;
    (is_http_url(candidate) && parsed.host_str().is_some()).then(|| candidate.to_string())
}

pub fn latex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\textbackslash{}"),
            '&' => out.push_str("\\&"),
            '%' => out.push_str("\\%"),
            '$' => out.push_str("\\$"),
            '#' => out.push_str("\\#"),
            '_' => out.push_str("\\_"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '~' => out.push_str("\\textasciitilde{}"),
            '^' => out.push_str("\\textasciicircum{}"),
            _ => out.push(ch),
        }
    }
    out
}

pub fn latex_escape_bold(s: &str) -> String {
    super::bold::runs(s)
        .into_iter()
        .map(|run| {
            let text = latex_escape(&run.text);
            if run.bold {
                format!("\\textbf{{{text}}}")
            } else {
                text
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "../tests/cv_latex_tests.rs"]
mod tests;
