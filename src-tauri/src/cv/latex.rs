//! Structured `CvRewrite` → `curriculo.cls` LaTeX source.
//! Key: `generate_resume_tex` — full compilable resume.tex from a rewrite.
//! Key: `latex_escape` / `latex_escape_bold` — TeX-special escaping (bold handles `**markdown**` spans).
//! Key: `cventry` — one `\cventry{...}` block for experience/education.
//! Key: `strip_handle` — reduce a github/linkedin URL to its bare handle.

use crate::ai::prompt::{CvRewrite, Language};

struct SectionTitles {
    summary: &'static str,
    education: &'static str,
    experience: &'static str,
    skills: &'static str,
}

fn section_titles(lang: Language) -> SectionTitles {
    match lang {
        Language::Pt => SectionTitles {
            summary: "Perfil Profissional",
            education: "Educação",
            experience: "Experiência",
            skills: "Habilidades",
        },
        Language::En => SectionTitles {
            summary: "Professional Profile",
            education: "Education",
            experience: "Experience",
            skills: "Skills",
        },
    }
}

const POSITION_SEP: &str = "{\\enskip\\cdotp\\enskip}";

pub fn generate_resume_tex(cv: &CvRewrite) -> String {
    let mut out = String::with_capacity(2048);

    out.push_str("\\documentclass[11pt, a4paper]{curriculo}\n");
    out.push_str("\\geometry{left=1.4cm, top=.8cm, right=1.4cm, bottom=1.8cm, footskip=.5cm}\n");
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

    let (first, last) = split_name(&cv.name);
    out.push_str(&format!(
        "\\name{{{}}}{{{}}}\n",
        latex_escape(&first),
        latex_escape(&last)
    ));
    let position = cv
        .positions
        .iter()
        .map(|p| latex_escape(p.trim()))
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
            latex_escape(c.location.trim())
        ));
    }
    if !c.phone.trim().is_empty() {
        out.push_str(&format!("\\mobile{{{}}}\n", latex_escape(c.phone.trim())));
    }
    if !c.email.trim().is_empty() {
        out.push_str(&format!("\\email{{{}}}\n", c.email.trim()));
        has_social = true;
    }
    if !c.website.trim().is_empty() {
        out.push_str(&format!("\\homepage{{{}}}\n", c.website.trim()));
        has_social = true;
    }
    if !c.github.trim().is_empty() {
        out.push_str(&format!(
            "\\github{{{}}}\n",
            strip_handle(&c.github, "github.com")
        ));
        has_social = true;
    }
    if !c.linkedin.trim().is_empty() {
        out.push_str(&format!(
            "\\linkedin{{{}}}\n",
            strip_handle(&c.linkedin, "linkedin.com/in")
        ));
        has_social = true;
    }
    if !has_social {
        out.push_str("\\extrainfo{~}\n");
    }

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
    out.push_str(&generate_skills(cv));
    out.push_str("\\end{document}\n");

    out
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

fn generate_experience(cv: &CvRewrite) -> String {
    if cv.experience.is_empty() {
        return String::new();
    }
    let mut s = format!(
        "\\cvsection{{{}}}\n\\begin{{cventries}}\n",
        latex_escape(section_titles(cv.language).experience)
    );
    for e in &cv.experience {
        s.push_str(&cventry(
            &e.title,
            &e.organization,
            &e.location,
            &e.dates,
            &e.bullets,
        ));
    }
    s.push_str("\\end{cventries}\n\n");
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
            latex_escape(g.category.trim()),
            latex_escape(g.skills.trim()),
        ));
    }
    s.push_str("\\end{cvskills}\n\n");
    s
}

fn cventry(a: &str, b: &str, c: &str, d: &str, bullets: &[String]) -> String {
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
        latex_escape(c.trim()),
        latex_escape(d.trim()),
        body,
    )
}

fn split_name(name: &str) -> (String, String) {
    let name = name.trim();
    match name.split_once(char::is_whitespace) {
        Some((first, rest)) => (first.trim().to_string(), rest.trim().to_string()),
        None => (name.to_string(), String::new()),
    }
}

fn strip_handle(value: &str, host_path: &str) -> String {
    let v = value.trim().trim_end_matches('/');
    let lower = v.to_ascii_lowercase();
    if let Some(idx) = lower.find(host_path) {
        return v[idx + host_path.len()..]
            .trim_start_matches('/')
            .trim_start_matches('@')
            .to_string();
    }
    v.trim_start_matches('@').to_string()
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
    let mut out = String::with_capacity(s.len() + 16);
    let mut rest = s;
    loop {
        let Some(start) = rest.find("**") else {
            out.push_str(&latex_escape(rest));
            break;
        };
        out.push_str(&latex_escape(&rest[..start]));
        let after = &rest[start + 2..];
        match after.find("**") {
            Some(end) => {
                out.push_str("\\textbf{");
                out.push_str(&latex_escape(&after[..end]));
                out.push('}');
                rest = &after[end + 2..];
            }
            None => {
                out.push_str("**");
                out.push_str(&latex_escape(after));
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::prompt::CvContact;
    use crate::ai::prompt::{CvEducationEntry, CvExperienceEntry, CvSkillGroup};

    fn sample() -> CvRewrite {
        CvRewrite {
            name: "Ana Sobral".to_string(),
            contact: CvContact {
                email: "ana@example.com".to_string(),
                phone: "(21) 99999-9999".to_string(),
                location: "Rio de Janeiro".to_string(),
                linkedin: "https://linkedin.com/in/anasobral".to_string(),
                github: "AnaGH".to_string(),
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
}
