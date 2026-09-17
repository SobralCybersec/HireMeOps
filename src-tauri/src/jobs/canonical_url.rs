//! Canonical URL normalization for job deduplication and URL locking.
//! Key: `canonicalize()` — lowercases scheme+host, strips tracking params, drops fragment, sorts query.
//! Key: `TRACKING_EXACT` / `is_tracking()` — non-`utm_` tracking-param denylist.

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

pub fn canonicalize(url: &str) -> String {
    let no_frag = url.split_once('#').map(|(l, _)| l).unwrap_or(url);

    let (path_raw, query_opt) = match no_frag.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (no_frag, None),
    };

    let mut canon = lowercase_scheme_host(path_raw);
    if canon.len() > 1 && canon.ends_with('/') {
        canon.pop();
    }

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
#[path = "../tests/jobs_canonical_url_tests.rs"]
mod tests;
