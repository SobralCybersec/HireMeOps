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
mod tests {
    use super::*;

    #[test]
    fn detects_all_caps_and_canonical_headings_in_order() {
        let text = "\
John Candidate
SUMMARY
Seasoned engineer with 10 years of experience.
Experience
Acme Corp — Staff Engineer, 2019 to now.
skills:
Rust, TypeScript, SQL
";
        let got = detect_sections(text);
        assert_eq!(got, vec!["Summary", "Experience", "Skills"]);
    }

    #[test]
    fn ignores_prose_and_long_lines() {
        let text = "\
This is an ordinary sentence, with commas.
A line that is far too long to plausibly be a heading in any resume layout.
Contact
";
        assert_eq!(detect_sections(text), vec!["Contact"]);
    }

    #[test]
    fn dedupes_repeated_headings() {
        let text = "SKILLS\na\nSkills\nb\n";
        assert_eq!(detect_sections(text), vec!["Skills"]);
    }

    #[test]
    fn empty_text_yields_no_sections() {
        assert!(detect_sections("").is_empty());
    }

    #[test]
    fn colon_stripped_before_canonical_check() {
        let text = "Skills:\nRust, Python\n";
        assert_eq!(detect_sections(text), vec!["Skills"]);
    }

    #[test]
    fn non_canonical_all_caps_is_detected() {
        let text = "PORTFOLIO\nsome detail\n";
        assert_eq!(detect_sections(text), vec!["Portfolio"]);
    }

    #[test]
    fn line_over_40_chars_is_ignored() {
        let long = "A".repeat(41);
        let text = format!("{long}\nSummary\n");
        let got = detect_sections(&text);
        assert_eq!(got, vec!["Summary"]);
    }

    #[test]
    fn sentence_punctuation_rejects_heading_candidate() {
        let text = "Hello, world.\nExperience\n";
        assert_eq!(detect_sections(text), vec!["Experience"]);
    }

    #[test]
    fn title_case_applied_to_all_caps_heading() {
        let text = "WORK EXPERIENCE\n";
        let got = detect_sections(text);
        assert_eq!(got, vec!["Work Experience"]);
    }
}
