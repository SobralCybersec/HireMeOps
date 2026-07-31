//! CV parsing module root: re-exports parse:: surface + shared hash/version constants.

pub mod export;
pub mod latex;
pub mod parse;
pub mod sections;

#[allow(unused_imports)]
pub use parse::{detect_kind, parse, DocKind, ParseError, ParsedDocument};

pub const PARSER_VERSION: &str = "cv-parse-1";

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
