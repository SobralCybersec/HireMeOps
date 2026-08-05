//! Docker environment probe for the optional containerized worker runtime.
//! Key: `docker_status` — reports whether the CLI is installed, the daemon is
//! reachable, and the worker image is built, so the UI can show an honest check.
//!
//! This ONLY reports. Whether the worker actually runs in Docker is decided at
//! spawn time in `browser::playwright` (gated on `HIREMEOPS_USE_DOCKER` + a live
//! daemon + the image) — see `docker_worker_enabled` there.

use serde::Serialize;
use tauri::State;

use crate::{storage, AppState};

/// Image tag the Dockerfile builds to and the spawn path looks for.
pub const WORKER_IMAGE: &str = "hiremeops-worker:latest";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    /// `docker` CLI is on PATH.
    pub installed: bool,
    /// The daemon answered `docker info` — the real "can we use it" gate.
    pub daemon_running: bool,
    /// Server version string when the daemon is up (e.g. "27.3.1"), else None.
    pub server_version: Option<String>,
    /// The worker image has been built locally.
    pub image_built: bool,
    /// `HIREMEOPS_USE_DOCKER=1` is set — the user opted the worker into the container.
    pub opt_in: bool,
    /// One-line human summary for the settings row.
    pub summary: String,
}

/// Run `docker <args>` and return trimmed stdout on exit 0. None on any failure
/// (not installed, daemon down, non-zero exit) — the caller only needs presence.
fn docker(args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("docker")
        .args(args)
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
    } else {
        None
    }
}

#[tauri::command]
pub async fn docker_status() -> Result<DockerStatus, String> {
    // `docker --version` = CLI present (no daemon contact). `docker info` = daemon
    // actually reachable — the correct probe, since `docker version` prints the
    // client block even when the daemon is down.
    let installed = docker(&["--version"]).is_some();
    let server_version = if installed {
        docker(&["info", "--format", "{{.ServerVersion}}"]).filter(|v| !v.is_empty())
    } else {
        None
    };
    let daemon_running = server_version.is_some();

    // `docker images -q <tag>` prints an image id iff the tag exists locally.
    let image_built = daemon_running
        && docker(&["images", "-q", WORKER_IMAGE])
            .map(|id| !id.is_empty())
            .unwrap_or(false);

    let opt_in = std::env::var("HIREMEOPS_USE_DOCKER").as_deref() == Ok("1");

    let summary = match (installed, daemon_running, image_built) {
        (false, _, _) => "Docker not installed — the worker runs on the host.".to_owned(),
        (true, false, _) => "Docker installed but the daemon isn't running — start Docker to use the container worker.".to_owned(),
        (true, true, false) => {
            "Docker is ready. Build the worker image (`npm run build:docker`) to enable the container runtime.".to_owned()
        }
        (true, true, true) if opt_in => "Container worker active (HIREMEOPS_USE_DOCKER=1).".to_owned(),
        (true, true, true) => {
            "Worker image ready. Set HIREMEOPS_USE_DOCKER=1 to run the worker in Docker.".to_owned()
        }
    };

    Ok(DockerStatus {
        installed,
        daemon_running,
        server_version,
        image_built,
        opt_in,
        summary,
    })
}

/// Toggle the Docker container runtime for the browser worker from the UI.
/// Persists the choice and applies it to the live process env the spawn gate
/// reads, so it takes effect on the next worker spawn without a restart. The
/// env var stays the source of truth (CI/headless runs set it directly).
#[tauri::command]
pub async fn set_docker_worker(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    storage::settings::set_docker_worker_opt_in(&state.db, enabled)
        .await
        .map_err(|e| e.to_string())?;

    // ponytail: process-wide env write. `docker_worker_enabled` only reads this
    // at worker spawn (rare), so the theoretical env data-race is immaterial.
    if enabled {
        std::env::set_var("HIREMEOPS_USE_DOCKER", "1");
    } else {
        std::env::remove_var("HIREMEOPS_USE_DOCKER");
    }
    Ok(())
}
