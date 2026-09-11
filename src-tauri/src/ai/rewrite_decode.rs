use super::{extract_json_object, strip_trailing_commas, CvRewrite};

pub(super) fn decode(raw: &str) -> Option<CvRewrite> {
    let object = strip_trailing_commas(extract_json_object(raw)?);
    serde_json::from_str(&repair_email_escape(&object)).ok()
}

// Some model responses escape @ as Markdown, which is invalid in JSON.
// Consume escape pairs together so valid \\ and all other JSON escapes survive.
fn repair_email_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        let next = chars.next();
        if next != Some('@') {
            out.push(ch);
        }
        if let Some(next) = next {
            out.push(next);
        }
    }
    out
}

// Repair the summary-only fallback persisted by older parsers, before cleaning
// Markdown links (which would otherwise damage the embedded JSON).
pub(super) fn recover_summary(mut stored: CvRewrite) -> CvRewrite {
    if !stored.name.is_empty()
        || !stored.positions.is_empty()
        || !stored.skills.is_empty()
        || !stored.experience.is_empty()
        || !stored.education.is_empty()
        || !stored.certificates.is_empty()
    {
        return stored;
    }
    let Some(mut recovered) = decode(&stored.summary).filter(|cv| !cv.name.trim().is_empty())
    else {
        return stored;
    };
    recovered.language = stored.language;
    recovered.cover_letter = stored.cover_letter;
    recovered.accent_color = stored.accent_color;
    recovered.photo_url = stored.photo_url;
    for (value, fallback) in [
        (&mut recovered.contact.email, &mut stored.contact.email),
        (&mut recovered.contact.phone, &mut stored.contact.phone),
        (
            &mut recovered.contact.location,
            &mut stored.contact.location,
        ),
        (
            &mut recovered.contact.linkedin,
            &mut stored.contact.linkedin,
        ),
        (&mut recovered.contact.github, &mut stored.contact.github),
        (&mut recovered.contact.gitlab, &mut stored.contact.gitlab),
        (&mut recovered.contact.website, &mut stored.contact.website),
    ] {
        if value.is_empty() {
            *value = std::mem::take(fallback);
        }
    }
    recovered
}
