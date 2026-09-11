use std::collections::HashSet;

use regex::Regex;
use reqwest::Url;

use crate::ai::prompt::{CvContact, CvExperienceEntry};

#[derive(Debug, Clone)]
struct SourceLink {
    url: String,
    context: String,
}

/// Fill empty contact fields from literal values present in source text.
pub(super) fn backfill_contact(src: &str, contact: &mut CvContact) {
    if contact.email.is_empty() {
        contact.email = extract_email(src).unwrap_or_default();
    }

    let links = extract_links(src);
    if contact.github.is_empty() {
        contact.github = first_profile_handle(&links, "github.com");
    }
    if contact.gitlab.is_empty() {
        contact.gitlab = first_profile_handle(&links, "gitlab.com");
    }
    if contact.linkedin.is_empty() {
        contact.linkedin = first_linkedin_handle(&links);
    }
    if contact.website.is_empty() {
        contact.website = links
            .iter()
            .find(|link| !is_profile_host(&link.url))
            .map(|link| link.url.clone())
            .unwrap_or_default();
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

/// Fill empty project/portfolio URLs from source lines that mention each entry.
/// AI output remains authoritative; this only recovers literal links it dropped.
pub(super) fn backfill_project_links(src: &str, entries: &mut [CvExperienceEntry]) {
    let links = extract_links(src)
        .into_iter()
        .filter(|link| is_project_link(&link.url))
        .collect::<Vec<_>>();
    let mut used = entries
        .iter()
        .filter_map(|entry| normalize_url(&entry.url))
        .collect::<HashSet<_>>();
    let single_fallback = entries.len() == 1 && links.len() == 1 && used.is_empty();

    for entry in entries
        .iter_mut()
        .filter(|entry| entry.url.trim().is_empty())
    {
        let Some(link) = links
            .iter()
            .filter(|link| !used.contains(&link.url))
            .filter_map(|link| {
                let score = link_score(entry, link);
                (score > 0).then_some((score, link))
            })
            .max_by_key(|(score, _)| *score)
            .map(|(_, link)| link)
            .or_else(|| single_fallback.then(|| &links[0]))
        else {
            continue;
        };
        entry.url = link.url.clone();
        used.insert(link.url.clone());
    }
}

fn extract_email(src: &str) -> Option<String> {
    for (at, _) in src.match_indices('@') {
        let domain_start = at + 1;
        let mut domain_end = src.len();
        for (offset, ch) in src[domain_start..].char_indices() {
            if ch.is_whitespace() || matches!(ch, ',' | ';' | '<' | '>' | '"' | '(' | ')') {
                domain_end = domain_start + offset;
                break;
            }
        }
        let domain = src[domain_start..domain_end]
            .trim()
            .trim_end_matches(['.', ',', ';', ')', '?', '>']);
        if domain.len() <= 2 || !domain.contains('.') || domain.ends_with('.') {
            continue;
        }
        let mut local_start = at;
        for (index, ch) in src[..at].char_indices().rev() {
            if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '%' | '+' | '-') {
                local_start = index;
            } else {
                break;
            }
        }
        if local_start < at {
            return Some(format!("{}@{}", &src[local_start..at], domain));
        }
    }
    None
}

fn extract_links(src: &str) -> Vec<SourceLink> {
    let pattern = Regex::new(
        r#"(?i)(?:https?://|www\.)[^\s<>\[\]"']+|(?:(?:github|gitlab|linkedin|behance|dribbble|vimeo)\.com/[^\s<>\[\]"']+)"#,
    )
    .expect("link regex");
    let mut seen = HashSet::new();
    let mut links = Vec::new();
    for line in src.lines() {
        for found in pattern.find_iter(line) {
            let Some(url) = normalize_url(found.as_str()) else {
                continue;
            };
            if seen.insert(url.clone()) {
                links.push(SourceLink {
                    url,
                    context: line.to_string(),
                });
            }
        }
    }
    links
}

fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '}']);
    let lower = trimmed.to_ascii_lowercase();
    let candidate = if lower.starts_with("http://") || lower.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = Url::parse(&candidate).ok()?;
    matches!(parsed.scheme(), "http" | "https")
        .then(|| parsed.host_str().map(|_| candidate))
        .flatten()
}

fn host_matches(url: &str, domain: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_ascii_lowercase()))
        .is_some_and(|host| host == domain || host.ends_with(&format!(".{domain}")))
}

fn is_profile_host(url: &str) -> bool {
    ["github.com", "gitlab.com", "linkedin.com"]
        .iter()
        .any(|domain| host_matches(url, domain))
}

fn first_profile_handle(links: &[SourceLink], domain: &str) -> String {
    links
        .iter()
        .find(|link| host_matches(&link.url, domain))
        .and_then(|link| {
            Url::parse(&link.url)
                .ok()?
                .path_segments()?
                .find(|segment| !segment.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn first_linkedin_handle(links: &[SourceLink]) -> String {
    links
        .iter()
        .find(|link| host_matches(&link.url, "linkedin.com"))
        .and_then(|link| {
            let parsed = Url::parse(&link.url).ok()?;
            let mut segments = parsed.path_segments()?;
            while let Some(segment) = segments.next() {
                if segment.eq_ignore_ascii_case("in") || segment.eq_ignore_ascii_case("pub") {
                    return segments.next().map(str::to_string);
                }
            }
            None
        })
        .unwrap_or_default()
}

fn is_project_link(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let segments = parsed
        .path_segments()
        .map(|segments| segments.filter(|segment| !segment.is_empty()).count())
        .unwrap_or(0);
    if host_matches(url, "linkedin.com") {
        return false;
    }
    if host_matches(url, "github.com") || host_matches(url, "gitlab.com") {
        return segments >= 2;
    }
    segments > 0
}

fn link_score(entry: &CvExperienceEntry, link: &SourceLink) -> usize {
    let title = entry.title.trim().to_ascii_lowercase();
    let organization = entry.organization.trim().to_ascii_lowercase();
    let haystack = format!("{} {}", link.context, link.url).to_ascii_lowercase();
    let exact_title = !title.is_empty() && haystack.contains(&title);
    let title_tokens = title
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| token.len() >= 3 && *token != "project")
        .filter(|token| haystack.contains(token))
        .count();
    let org_match = !organization.is_empty() && haystack.contains(&organization);
    exact_title as usize * 100 + title_tokens * 10 + org_match as usize * 5
}
