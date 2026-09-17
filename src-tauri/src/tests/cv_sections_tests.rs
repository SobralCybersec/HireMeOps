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
