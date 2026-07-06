//! Small shared helpers.

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Current UTC time as an ISO-8601 / RFC-3339 string (the canonical timestamp
/// format used across every table and event in the app).
pub fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// Generate a fresh v4 UUID string (used for all TEXT primary keys).
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
