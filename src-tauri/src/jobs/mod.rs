//! Jobs module — canonical URL normalisation, deduplication, query building.
//!
//! These are pure logic helpers used by `commands::jobs`; they carry no Tauri
//! dependency so they can be unit-tested without spinning up the app.

pub mod canonical_url;
pub mod dedupe;
pub mod search;

pub use canonical_url::canonicalize;
pub use dedupe::{check as check_dedupe, DedupeOutcome};
pub use search::{build_queries, SearchQueryInput};
