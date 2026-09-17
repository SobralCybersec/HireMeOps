//! Heuristic section-heading detection over extracted CV text.
//! Key: `detect_sections` — line-by-line scan, dedup + Title-Case output.
//! Key: `CANONICAL` — recognised CV section names (matched even when not ALL-CAPS).
//! Key: `is_heading_shaped` / `is_all_caps` — the two heuristics gating a heading match.

const CANONICAL: &[&str] = &[
    "summary",
    "profile",
    "objective",
    "experience",
    "work experience",
    "employment",
    "employment history",
    "education",
    "skills",
    "technical skills",
    "projects",
    "open source",
    "certifications",
    "licenses",
    "languages",
    "awards",
    "honors",
    "publications",
    "interests",
    "volunteering",
    "references",
    "contact",
];

pub fn detect_sections(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim().trim_end_matches(':').trim();
        if line.is_empty() || line.chars().count() > 40 {
            continue;
        }
        if !is_heading_shaped(line) {
            continue;
        }
        let is_canonical = CANONICAL.contains(&line.to_lowercase().as_str());
        if !(is_canonical || is_all_caps(line)) {
            continue;
        }
        let title = title_case(line);
        if !out.contains(&title) {
            out.push(title);
        }
    }
    out
}

fn is_heading_shaped(line: &str) -> bool {
    let letters = line.chars().filter(|c| c.is_alphabetic()).count();
    let non_space = line.chars().filter(|c| !c.is_whitespace()).count();
    if non_space == 0 || letters * 2 < non_space {
        return false;
    }
    !line.contains(['.', ',', ';', '!', '?'])
}

fn is_all_caps(line: &str) -> bool {
    let mut has_alpha = false;
    for c in line.chars() {
        if c.is_alphabetic() {
            has_alpha = true;
            if c.is_lowercase() {
                return false;
            }
        }
    }
    has_alpha
}

fn title_case(line: &str) -> String {
    line.split_whitespace()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
#[path = "../tests/cv_sections_tests.rs"]
mod tests;
