/// Fill empty contact fields from literal values present in source text.
pub(super) fn backfill_contact(src: &str, contact: &mut crate::ai::prompt::CvContact) {
    let take = |s: &str, start: usize, end: usize| {
        let token = s[start..end]
            .trim()
            .trim_end_matches(['/', '.', ',', ';', ')', '?', '>']);
        if token.contains(char::is_whitespace) {
            String::new()
        } else {
            token.to_string()
        }
    };

    if contact.email.is_empty() {
        for (at, _) in src.match_indices('@') {
            let domain_start = at + 1;
            let mut domain_end = src.len();
            for (offset, c) in src[domain_start..].char_indices() {
                if c.is_whitespace() || matches!(c, ',' | ';' | '<' | '>' | '"' | '(' | ')') {
                    domain_end = domain_start + offset;
                    break;
                }
            }

            let domain = take(src, domain_start, domain_end);
            if domain.len() <= 2 || !domain.contains('.') || domain.ends_with('.') {
                continue;
            }

            let mut local_start = at;
            for (idx, c) in src[..at].char_indices().rev() {
                if c.is_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-') {
                    local_start = idx;
                } else {
                    break;
                }
            }

            if local_start < at {
                contact.email = format!("{}@{}", &src[local_start..at], domain);
                break;
            }
        }
    }

    for (needle, slot) in [
        ("github.com/", &mut contact.github),
        ("gitlab.com/", &mut contact.gitlab),
        ("linkedin.com/in/", &mut contact.linkedin),
    ] {
        if !slot.is_empty() {
            continue;
        }

        for (start, _) in src.match_indices(needle) {
            let value_start = start + needle.len();
            let mut value_end = src.len();
            for (offset, c) in src[value_start..].char_indices() {
                if c.is_whitespace() || matches!(c, '/' | '\\' | '?' | '#' | ',' | ';' | ')' | '"')
                {
                    value_end = value_start + offset;
                    break;
                }
            }

            let token = take(src, value_start, value_end);
            if !token.is_empty() {
                *slot = token;
                break;
            }
        }
    }

    if contact.phone.is_empty() {
        let mut scratch: Vec<char> = Vec::new();
        let mut digit_count = 0;
        for c in src.chars().chain(std::iter::once('\0')) {
            let keep = c.is_ascii_digit() || matches!(c, '+' | '(' | ')' | '.' | '-' | ' ');
            if keep {
                scratch.push(c);
                if c.is_ascii_digit() {
                    digit_count += 1;
                }
            } else {
                if digit_count >= 10 && scratch.len() <= 24 {
                    contact.phone = scratch.iter().collect::<String>().trim().to_string();
                    break;
                }
                scratch.clear();
                digit_count = 0;
            }
        }
    }
}
