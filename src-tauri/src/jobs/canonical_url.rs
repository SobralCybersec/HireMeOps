//! Canonical URL normalization for job deduplication and URL locking.

const TRACKING_EXACT: &[&str] = &[
    "gclid",
    "fbclid",
    "ref",
    "trk",
    "_gl",
    "msclkid",
    "igshid",
    "mc_eid",
    "oly_enc_id",
    "oly_anon_id",
    "_hsenc",
    "_hsmi",
];

fn is_tracking(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    if k.starts_with("utm_") {
        return true;
    }
    TRACKING_EXACT.contains(&k.as_str())
}

fn lowercase_scheme_host(s: &str) -> String {
    if let Some(sep) = s.find("://") {
        let (scheme, rest) = s.split_at(sep + 3);
        let (host, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        format!(
            "{}{}{}",
            scheme.to_ascii_lowercase(),
            host.to_ascii_lowercase(),
            path
        )
    } else {
        s.to_ascii_lowercase()
    }
}

/// Normalize a job URL for deduplication and locking:
/// lowercase scheme+host, strip tracking params, drop fragment,
/// remove trailing slash, sort remaining query params.
pub fn canonicalize(url: &str) -> String {
    // 1. Drop fragment.
    let no_frag = url.split_once('#').map(|(l, _)| l).unwrap_or(url);

    // 2. Split path vs query.
    let (path_raw, query_opt) = match no_frag.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (no_frag, None),
    };

    // 3. Lowercase scheme+host, strip trailing slash.
    let mut canon = lowercase_scheme_host(path_raw);
    if canon.len() > 1 && canon.ends_with('/') {
        canon.pop();
    }

    // 4. Filter tracking params, sort the rest.
    let query = match query_opt {
        None | Some("") => String::new(),
        Some(q) => {
            let mut params: Vec<(&str, &str)> = q
                .split('&')
                .filter_map(|seg| {
                    let (k, v) = seg.split_once('=').unwrap_or((seg, ""));
                    if is_tracking(k) {
                        None
                    } else {
                        Some((k, v))
                    }
                })
                .collect();
            if params.is_empty() {
                String::new()
            } else {
                params.sort_by_key(|(k, _)| *k);
                format!(
                    "?{}",
                    params
                        .iter()
                        .map(|(k, v)| format!("{}={}", k, v))
                        .collect::<Vec<_>>()
                        .join("&")
                )
            }
        }
    };

    format!("{}{}", canon, query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_utm_params() {
        let url = "https://jobs.example.com/post/123?utm_source=linkedin&utm_medium=social&id=42";
        assert_eq!(canonicalize(url), "https://jobs.example.com/post/123?id=42");
    }

    #[test]
    fn strips_gclid_fbclid_trk() {
        let url = "https://example.com/job?gclid=abc&fbclid=xyz&trk=pub&jobId=99";
        assert_eq!(canonicalize(url), "https://example.com/job?jobId=99");
    }

    #[test]
    fn drops_fragment() {
        assert_eq!(
            canonicalize("https://example.com/jobs/42#apply"),
            "https://example.com/jobs/42"
        );
    }

    #[test]
    fn strips_trailing_slash() {
        assert_eq!(
            canonicalize("https://example.com/jobs/"),
            "https://example.com/jobs"
        );
    }

    #[test]
    fn lowercases_scheme_and_host() {
        let got = canonicalize("HTTPS://LinkedIn.COM/jobs/view/123");
        assert_eq!(got, "https://linkedin.com/jobs/view/123");
    }

    #[test]
    fn preserves_path_case() {
        let got = canonicalize("https://Example.COM/Jobs/View/123");
        assert_eq!(got, "https://example.com/Jobs/View/123");
    }

    #[test]
    fn sorts_query_params() {
        assert_eq!(
            canonicalize("https://example.com/job?z=1&a=2&m=3"),
            "https://example.com/job?a=2&m=3&z=1"
        );
    }

    #[test]
    fn no_query_unchanged() {
        assert_eq!(
            canonicalize("https://example.com/jobs/view/123"),
            "https://example.com/jobs/view/123"
        );
    }

    #[test]
    fn all_tracking_stripped_leaves_no_question_mark() {
        let url = "https://example.com/job?utm_source=x&gclid=y";
        assert_eq!(canonicalize(url), "https://example.com/job");
    }
}
