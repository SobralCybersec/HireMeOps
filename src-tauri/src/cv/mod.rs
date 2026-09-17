//! CV parsing module root: re-exports parse:: surface + shared hash/version constants.

pub(crate) mod bold;
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
#[path = "../tests/cv_mod_tests.rs"]
mod tests;
