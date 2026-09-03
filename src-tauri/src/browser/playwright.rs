//! Playwright-backed BrowserDriver implementation.
//! Key: PlaywrightDriver — owns the worker connection + parked-session state for the human-in-the-loop submit flow.
//! Key: WorkerConn — stdin/stdout JSON-lines RPC to the `automation/worker.js` Node child process.
//! Key: locate_worker_script — resolves worker.js relative to the binary, CARGO_MANIFEST_DIR, or cwd.
//! Key: confirm_submit_parked / reject_submit_parked — resume the parked Easy Apply session after human review.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Map, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::domain::automation::{
    BrowserDriver, EasyApplyInput, GoogleResult, GoogleSearchResult, JobCard, LinkedInPost,
    LinkedInPostsResult, PageState, SearchJobsInput, SearchJobsResult, SessionSpec,
};
use crate::domain::profile_sync::{SyncSection, SyncSectionResult};
use crate::domain::{DomainError, DomainResult};

#[path = "playwright_driver_apply.rs"]
mod driver_apply;
#[path = "playwright_driver_base.rs"]
mod driver_base;
#[path = "playwright_driver_search.rs"]
mod driver_search;
#[path = "playwright_driver_sync.rs"]
mod driver_sync;
#[path = "playwright_driver_trait.rs"]
mod driver_trait;
#[path = "playwright_worker.rs"]
mod worker_conn;

pub(crate) use driver_search::{CathoSearchOptions, InfojobsSearchOptions};
use worker_conn::WorkerConn;
pub use worker_conn::{AutoConnectProgress, LiveFrame};

struct ParkedInfo {
    handle: String,
    task_id: Option<String>,
    session_id: Option<String>,
}

pub struct PostSubmitMeta {
    pub screenshot_path: Option<String>,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
}

pub struct PlaywrightDriver {
    worker_script: PathBuf,
    /// Root holding every per-profile jar (`<data>/profiles`). Volume-mounted into
    /// the container at the same path when the Docker worker runtime is enabled.
    profiles_root: PathBuf,
    conn: Mutex<Option<Arc<WorkerConn>>>,
    screenshot_dir: PathBuf,
    parked: Mutex<Option<ParkedInfo>>,
    parked_indeed: Mutex<Option<String>>,
    login_session: Mutex<Option<String>>,
    current_session: Mutex<Option<String>>,
}

fn locate_worker_script() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let candidate = exe
            .parent()
            .map(|d| d.join("automation").join("worker.js"))
            .unwrap_or_default();
        if candidate.exists() {
            return candidate;
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(&manifest)
            .parent()
            .map(|r| r.join("automation").join("worker.js"))
            .unwrap_or_default();
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("automation/worker.js")
}
