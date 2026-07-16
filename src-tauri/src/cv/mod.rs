//! Pure CV parsing core (Tauri-free, unit-tested) — mirrors `jobs/` and
//! `matching/`. Turns raw PDF/DOCX bytes into text + page count + detected
//! section headings, plus a stable content hash used for dedupe.

pub mod export;
pub mod parse;
pub mod sections;

// Public surface consumed by the Tauri command layer (wired next). Allowed
// until then so the interim tree stays warning-clean.
#[allow(unused_imports)]
pub use parse::{detect_kind, parse, DocKind, ParseError, ParsedDocument};

/// Bumped whenever parsing / section-detection logic changes. Persisted in
/// `cv_documents.parser_version` so a future re-parse pass can find stale rows.
pub const PARSER_VERSION: &str = "cv-parse-1";

/// SHA-256 of the raw file bytes, lower-hex. This is the stable dedupe key
/// persisted in `cv_documents.file_hash`.
///
/// Deliberately NOT `std::hash::DefaultHasher` (SipHash): its output is not
/// stable across Rust versions, which would silently poison a persisted key.
pub fn hash_bytes(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_known_sha256() {
        // Well-known SHA-256 of the ASCII string "hello".
        assert_eq!(
            hash_bytes(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn hash_differs_by_content() {
        assert_ne!(hash_bytes(b"a"), hash_bytes(b"b"));
    }
}
