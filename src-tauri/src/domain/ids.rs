//! Typed string identifiers. Wrapping the raw `String` ids the domain passes around
//! makes swapping two same-typed args (e.g. `score_match(job_id, profile_id)`) a
//! compile error instead of a silent data bug.
//!
//! `#[serde(transparent)]` keeps the IPC/JSON wire format identical to a plain string,
//! so adopting these changes no frontend contract and no stored data. Bind to SQL via
//! `.as_str()`.

use serde::{Deserialize, Serialize};

/* Declares a `String` newtype id with the shared conversion/display glue. */
macro_rules! string_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl From<String> for $name {
            fn from(s: String) -> Self {
                Self(s)
            }
        }

        impl From<&str> for $name {
            fn from(s: &str) -> Self {
                Self(s.to_owned())
            }
        }
    };
}

string_id!(
    /** A `job_posts.id`. */
    JobId
);
string_id!(
    /** A `profiles.id`. */
    ProfileId
);
