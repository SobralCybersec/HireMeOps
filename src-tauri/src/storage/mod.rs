//! Storage layer: filesystem path resolution, the SQLite pool + migrations,
//! optional shared PostgreSQL foundation, and typed repositories.
//! Key: `db` — SQLite pool creation + migration runner.
//! Key: `paths` — `AppPaths` resolution (portable vs installed layout).
//! Key: `settings` — `app_settings` key/value repository + `AppSettings` DTO.

pub mod db;
pub mod paths;
pub mod postgres;
pub mod settings;
