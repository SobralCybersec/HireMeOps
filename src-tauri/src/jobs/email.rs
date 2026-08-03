//! Contact-email extraction from free text (job descriptions, Google snippets).
//! Key: `extract_email()` — scans for `@`, walks local/domain chars, validates the TLD.

pub fn extract_email(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b != b'@' {
            continue;
        }
        let mut local_start = i;
        while local_start > 0 && is_local_char(bytes[local_start - 1]) {
            local_start -= 1;
        }
        if local_start == i {
            continue;
        }
        let domain_start = i + 1;
        let mut domain_end = domain_start;
        while domain_end < bytes.len() && is_domain_char(bytes[domain_end]) {
            domain_end += 1;
        }
        if domain_end == domain_start {
            continue;
        }
        let candidate = &text[local_start..domain_end];
        let trimmed = candidate.trim_end_matches(['.', ',', ';', ')', '!', '?']);
        if let Some(at) = trimmed.rfind('@') {
            let domain = &trimmed[at + 1..];
            if let Some(dot) = domain.rfind('.') {
                let tld = &domain[dot + 1..];
                if tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_alphabetic()) {
                    return Some(trimmed.to_ascii_lowercase());
                }
            }
        }
    }
    None
}

fn is_local_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'+' | b'_' | b'-')
}

fn is_domain_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_brazilian_email() {
        assert_eq!(
            extract_email("Assunto: Vaga Dev. Envie para vagas@empresa.com.br"),
            Some("vagas@empresa.com.br".to_owned()),
        );
    }

    #[test]
    fn returns_none_when_no_email() {
        assert_eq!(
            extract_email("Nenhum email aqui, apenas texto normal."),
            None,
        );
    }
}
