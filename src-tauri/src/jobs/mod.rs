//! Jobs module: canonical URL normalisation, deduplication, query building,
//! and email extraction from free text. Pure logic helpers used by
//! `commands::jobs`, no Tauri dependency, unit-testable standalone.
//! Key: `canonical_url::canonicalize()` — URL dedup/lock normalization.
//! Key: `dedupe::check()` — duplicate job detection by profile+platform+URL.
//! Key: `search::build_queries()` — LinkedIn/Google/hiring-posts query builders.
//! Key: `email::extract_email()` — real-browser-only free-text email scraper.

pub mod canonical_url;
pub mod dedupe;
pub mod search;

pub use canonical_url::canonicalize;
pub use dedupe::{check as check_dedupe, DedupeOutcome};
pub use search::{build_queries, SearchQueryInput};

#[cfg(feature = "real-browser")]
pub mod email;
#[cfg(feature = "real-browser")]
pub use email::extract_email;
