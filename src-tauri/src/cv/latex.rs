//! Structured `CvRewrite` → `curriculo.cls` LaTeX source.
//! Key: `generate_resume_tex` — full compilable resume.tex from a rewrite.
//! Key: `latex_escape` / `latex_escape_bold` — TeX-special escaping (bold handles `**markdown**` spans).
//! Key: `cventry` — one `\cventry{...}` block for experience/education.
//! Key: `strip_handle` — reduce a github/linkedin URL to its bare handle.

use crate::ai::prompt::{CvRewrite, Language};

#[cfg(test)]
#[path = "latex_link_tests.rs"]
mod link_tests;

#[cfg(test)]
#[path = "bold_tests.rs"]
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
mod tests {
    use super::*;
    use crate::ai::prompt::CvContact;
    use crate::ai::prompt::{CvCertificate, CvEducationEntry, CvExperienceEntry, CvSkillGroup};

    fn sample() -> CvRewrite {
        CvRewrite {
            name: "Ana Sobral".to_string(),
            contact: CvContact {
                email: "ana@example.com".to_string(),
                phone: "(21) 99999-9999".to_string(),
                location: "Rio de Janeiro".to_string(),
                linkedin: "https://linkedin.com/in/anasobral".to_string(),
                github: "AnaGH".to_string(),
                gitlab: "https://gitlab.com/anasobral".to_string(),
                website: "https://ana.dev".to_string(),
            },
            positions: vec!["Backend Engineer".to_string(), "Rust Developer".to_string()],
            summary: "Pragmatic engineer & builder.".to_string(),
            skills: vec![CvSkillGroup {
                category: "Database & Cache".to_string(),
                skills: "PostgreSQL, Redis".to_string(),
            }],
            experience: vec![CvExperienceEntry {
                title: "Senior Engineer".to_string(),
                organization: "SobralCybersec".to_string(),
                location: "Remote".to_string(),
                dates: "2020—2025".to_string(),
                url: String::new(),
                bullets: vec!["Cut p99 latency by 40%.".to_string(), "  ".to_string()],
            }],
            education: vec![CvEducationEntry {
                degree: "BSc Computer Science".to_string(),
                institution: "Universidade Federal".to_string(),
                location: "Brazil".to_string(),
                dates: "2012—2016".to_string(),
                bullets: vec![],
            }],
            language: Language::En,
            ..Default::default()
        }
    }

    #[test]
    fn escapes_all_specials() {
        assert_eq!(latex_escape("a & b % c"), "a \\& b \\% c");
        assert_eq!(latex_escape("100%_#$"), "100\\%\\_\\#\\$");
        assert_eq!(latex_escape("{x}"), "\\{x\\}");
        assert_eq!(latex_escape("a\\b"), "a\\textbackslash{}b");
    }

    #[test]
    fn bold_markers_become_textbf_and_stay_escaped() {
        assert_eq!(
            latex_escape_bold("cut cost by **40% & rising**"),
            "cut cost by \\textbf{40\\% \\& rising}"
        );
        assert_eq!(
            latex_escape_bold(r"cut cost by \textbf{40% & rising}"),
            "cut cost by \\textbf{40\\% \\& rising}"
        );
        assert_eq!(
            latex_escape_bold(r"cut cost by \bf{40% & rising}"),
            "cut cost by \\textbf{40\\% \\& rising}"
        );
        assert_eq!(latex_escape_bold("plain 50%"), "plain 50\\%");
        let out = latex_escape_bold("a **b_c");
        assert_eq!(out, "a **b\\_c");
        assert!(!out.contains("\\textbf{"));
    }

    #[test]
    fn splits_name_into_two_groups() {
        assert_eq!(
            split_name("Ana Sobral da Silva"),
            ("Ana".into(), "Sobral da Silva".into())
        );
        assert_eq!(split_name("Cher"), ("Cher".into(), String::new()));
    }

    #[test]
    fn document_is_well_formed_and_escaped() {
        let tex = generate_resume_tex(&sample());
        assert!(tex.starts_with("\\documentclass[11pt, a4paper]{curriculo}"));
        assert!(tex.contains("bottom=1.0cm, footskip=0pt"));
        assert!(tex.contains("\\pagestyle{empty}"));
        assert!(tex.trim_end().ends_with("\\end{document}"));
        for env in [
            "document",
            "cvparagraph",
            "cventries",
            "cvskills",
            "cvitems",
        ] {
            assert_eq!(
                tex.matches(&format!("\\begin{{{env}}}")).count(),
                tex.matches(&format!("\\end{{{env}}}")).count(),
                "unbalanced {env}"
            );
        }
        assert!(!tex.contains("\\extrainfo{~}"));
        assert!(tex.contains("\\email{ana@example.com}"));
        assert!(tex.contains("\\mobile{(21) 99999-9999}"));
        assert!(tex.contains("\\address{Rio de Janeiro}"));
        assert!(tex.contains("\\homepage{https://ana.dev}"));
        assert!(tex.contains("\\github{AnaGH}"));
        assert!(tex.contains("\\gitlab{anasobral}"), "tex: {tex}");
        assert!(tex.contains("\\linkedin{anasobral}"), "tex: {tex}");
        assert!(tex.contains("\\name{Ana}{Sobral}"));
        assert!(tex.contains("\\cvskill\n    {Database \\& Cache}"));
        assert!(tex.contains("\\item {Cut p99 latency by 40\\%.}"));
        assert_eq!(tex.matches("\\item").count(), 1);
        assert!(tex.contains("Backend Engineer{\\enskip\\cdotp\\enskip}Rust Developer"));
    }

    #[test]
    fn empty_sections_are_omitted() {
        let tex = generate_resume_tex(&CvRewrite::default());
        assert!(!tex.contains("cventries"));
        assert!(!tex.contains("cvskills"));
        assert!(!tex.contains("cvparagraph"));
        assert!(tex.contains("\\begin{document}"));
        assert!(tex.contains("\\extrainfo{~}"));
    }

    #[test]
    fn certificates_are_optional_and_urls_are_clickable() {
        let mut cv = sample();
        assert!(!generate_resume_tex(&cv).contains("Certificates"));
        cv.certificates.push(CvCertificate {
            name: "Cloud Certificate".to_string(),
            issuer: "Issuer".to_string(),
            credential_id: "CERT-1".to_string(),
            date: "2025".to_string(),
            credential_url: "https://certs.example/CERT-1?a=1&b=2".to_string(),
        });
        let tex = generate_resume_tex(&cv);
        assert!(tex.contains("\\cvsection{Certificates}"));
        assert!(tex.contains("\\href{https://certs.example/CERT-1?a=1\\&b=2}{Cloud Certificate}"));
        assert!(tex.contains("{Issuer}"));
        assert!(tex.contains("\\cvhonor\n    {\\href{https://certs.example/CERT-1?a=1\\&b=2}{Cloud Certificate}}\n    {Issuer}\n    {}\n    {}"));
        assert!(!tex.contains("\n    {CERT-1}\n"));
        assert!(!tex.contains("\n    {2025}\n"));
    }

    #[test]
    fn experience_url_renders_github_icon() {
        let mut cv = sample();
        cv.experience[0].url = "https://github.com/user/project".to_string();
        let tex = generate_resume_tex(&cv);
        assert!(tex.contains("\\faGithub"), "should contain GitHub icon");
        assert!(tex.contains("GitHub"), "should contain GitHub label");
        assert!(
            tex.contains("\\faArrowUpRightFromSquare"),
            "should contain external-link arrow"
        );
        assert!(
            tex.contains("\\href{https://github.com/user/project}"),
            "should contain href link"
        );
    }

    #[test]
    fn experience_url_detects_platform() {
        assert_eq!(
            url_platform("https://github.com/user/project"),
            ("GitHub", "\\faGithub")
        );
        assert_eq!(
            url_platform("https://gitlab.com/user/project"),
            ("GitLab", "\\faGitlab")
        );
        assert_eq!(
            url_platform("https://behance.net/user"),
            ("Behance", "\\faBehance")
        );
        assert_eq!(
            url_platform("https://linkedin.com/in/user"),
            ("LinkedIn", "\\faLinkedin")
        );
        assert_eq!(
            url_platform("https://example.com/portfolio"),
            ("Portfolio", "\\faGlobe")
        );
        assert_eq!(
            url_platform("https://user.github.io/project"),
            ("GitHub", "\\faGithub")
        );
    }

    #[test]
    fn cover_letter_tex_uses_generated_body_and_cv_identity() {
        let mut cv = sample();
        cv.cover_letter =
            "I built **reliable systems**.\n\nI would welcome a conversation.".to_string();
        let tex = generate_cover_letter_tex(&cv);
        assert!(tex.starts_with("\\documentclass[11pt, a4paper]{curriculo}"));
        assert!(tex.contains("\\lettertitle{Application for Backend Engineer}"));
        assert!(tex.contains("\\begin{cvletter}"));
        assert!(tex.contains("\\lettersection{About Me}"));
        assert!(tex.contains("\\textbf{reliable systems}"));
        assert!(tex.contains("\\makeletterclosing"));
    }

    #[test]
    fn messy_header_values_compile_via_xelatex() {
        if std::process::Command::new("xelatex")
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("skipping: xelatex not available");
            return;
        }
        let cvtex = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cvtex");
        let mut cv = sample();
        cv.name = "Candidate Villas Boas".to_string();
        cv.contact = CvContact {
            email: r"candidate\@hotmail.com".to_string(),
            phone: "+55 19\n99956-9888".to_string(),
            location: "Rio Claro, São Paulo,\nBrasil".to_string(),
            linkedin: "[https://br.linkedin.com/in/candidate](https://br.linkedin.com/in/candidate)".to_string(),
            github: String::new(),
            gitlab: String::new(),
            website: "[https://www.behance.net/candidate](https://www.behance.net/candidate)\n\nGraphic Director".to_string(),
        };
        cv.positions = vec!["Art Director".to_string(), "Visual Designer".to_string()];
        cv.language = Language::Pt;
        cv.summary = "Graphic designer with experience in visual communication, campaigns, social media, branding, and print materials. I also study UX/UI Design, expanding practice in interfaces, prototyping, responsive design, usability, and user feedback analysis.".to_string();
        cv.experience[0].url = "[https://www.behance.net/gallery/123/PROJECT](https://www.behance.net/gallery/123/PROJECT)".to_string();
        cv.experience.push(CvExperienceEntry {
            title: "Visual Designer".to_string(),
            organization: "Personal portfolio project".to_string(),
            location: "Brazil".to_string(),
            dates: "Published in February 2026".to_string(),
            url: "[https://www.behance.net/gallery/456/CONCEPT](https://www.behance.net/gallery/456/CONCEPT)".to_string(),
            bullets: vec!["Built a conceptual key visual study in Adobe Photoshop.".to_string()],
        });
        cv.experience[0].bullets = vec![
            "Develop visual identities, social media pieces, and branding solutions.".to_string(),
            "Adapt concepts for print and digital materials according to context, format, and communication needs.".to_string(),
        ];
        cv.education[0].bullets = vec![
            "Training in project methodology, visual expression and communication, image and visual identity, graphic design, typography, branding, and information design.".to_string(),
        ];
        cv.certificates.push(CvCertificate {
            name: "Design Thinking".to_string(),
            issuer: "Online School".to_string(),
            credential_id: String::new(),
            date: String::new(),
            credential_url: String::new(),
        });
        let tex = generate_resume_tex(&cv);
        assert!(tex.contains("\\email{candidate@hotmail.com}"));
        assert!(tex.contains("\\homepage{https://www.behance.net/candidate}"));
        assert!(tex.contains("\\linkedin{candidate}"));
        assert!(tex.contains("\\href{https://www.behance.net/gallery/123/PROJECT}"));
        assert!(!tex.contains("](https://"));
        crate::cv::export::build_pdf_tex(&cv, &cv.cv_metadata(), &cvtex, None)
            .expect("contact values must compile via xelatex");
    }
}
