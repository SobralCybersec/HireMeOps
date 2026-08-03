//! First-run setup — provision what the automation worker needs, automatically.
//! Key: `install_dependencies` — verifies/auto-installs Node.js (winget on Windows,
//! pkexec+pkg-mgr on Linux), ensures the worker's Node deps, installs Chromium.
//! xelatex (CV PDF only) is left as a noted manual step — it's a multi-GB install.

fn tail(out: &[u8], err: &[u8]) -> String {
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(out),
        String::from_utf8_lossy(err)
    );
    combined
        .lines()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

/// True if `cmd arg` runs and exits 0 (used to probe for node/winget/pkexec).
fn probe(cmd: &str, arg: &str) -> bool {
    std::process::Command::new(cmd)
        .arg(arg)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a command to completion; Ok(()) on exit 0, else Err(tail of output).
fn run(bin: &str, args: &[&str]) -> Result<(), String> {
    let out = std::process::Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| format!("could not launch `{bin}`: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(tail(&out.stdout, &out.stderr))
    }
}

/// First present Linux package manager, in preference order.
fn linux_pkg_mgr() -> Option<&'static str> {
    ["apt-get", "dnf", "pacman"]
        .into_iter()
        .find(|&m| probe(m, "--version"))
        .map(|v| v as _)
}

/// Auto-install Node.js. Windows: winget (self-elevates). Linux: pkexec (graphical
/// PolicyKit prompt) + the native package manager. Returns Ok when the installer
/// ran; the caller re-probes `node` (PATH may need an app restart on Windows).
fn install_node() -> Result<(), String> {
    match std::env::consts::OS {
        "windows" => {
            if !probe("winget", "--version") {
                return Err("winget not available — install Node.js 20+ from \
                    https://nodejs.org (or update 'App Installer' from the \
                    Microsoft Store), then retry"
                    .into());
            }
            run(
                "winget",
                &[
                    "install",
                    "-e",
                    "--id",
                    "OpenJS.NodeJS.LTS",
                    "--silent",
                    "--accept-package-agreements",
                    "--accept-source-agreements",
                ],
            )
        }
        "linux" => {
            let mgr = linux_pkg_mgr().ok_or_else(|| {
                "no supported package manager (apt/dnf/pacman) — install Node.js \
                 20+ from https://nodejs.org, then retry"
                    .to_string()
            })?;
            if !probe("pkexec", "--version") {
                return Err(format!(
                    "graphical sudo (pkexec) not available — run \
                     `sudo {mgr} install nodejs npm` in a terminal, then retry"
                ));
            }
            // pkexec pops a PolicyKit password dialog and runs the install as root.
            let args: Vec<&str> = match mgr {
                "pacman" => vec!["pacman", "-S", "--noconfirm", "nodejs", "npm"],
                "dnf" => vec!["dnf", "install", "-y", "nodejs", "npm"],
                _ => vec!["apt-get", "install", "-y", "nodejs", "npm"],
            };
            run("pkexec", &args)
        }
        other => Err(format!(
            "auto-install not supported on {other} — install Node.js 20+ from https://nodejs.org"
        )),
    }
}

#[tauri::command]
pub async fn install_dependencies() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let mut report = String::new();

        // 1. Node.js — the worker runtime + every npm/npx call. Auto-install if
        //    missing; it CANNOT be used until the process PATH sees it (a fresh
        //    Windows install needs an app restart), so we re-probe and bail early.
        if probe("node", "--version") {
            let v = std::process::Command::new("node")
                .arg("--version")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            report.push_str(&format!("Node.js {v} ✓\n"));
        } else {
            report.push_str("Node.js not found — installing…\n");
            install_node().map_err(|e| format!("Couldn't auto-install Node.js: {e}"))?;
            if !probe("node", "--version") {
                return Err(format!(
                    "{report}Node.js was installed but isn't on PATH yet — reopen \
                     the app so PATH refreshes, then click Install again to finish."
                ));
            }
            report.push_str("Node.js installed ✓\n");
        }

        // 2. The worker's `patchright` npm package. Absent in a packaged install
        //    until this runs; a dev checkout already has node_modules, so skipped.
        if !std::path::Path::new("node_modules/patchright").exists() {
            report.push_str("Installing Node dependencies (patchright)…\n");
            run("npm", &["install", "--omit=dev", "--no-audit", "--no-fund"])
                .map_err(|e| format!("{report}npm install failed:\n{e}"))?;
            report.push_str("Node dependencies installed ✓\n");
        }

        // 3. The Chromium the worker drives (patchright's own bundled build — a
        //    SYSTEM Chrome is NOT required).
        report.push_str("Installing the automation browser (Chromium)…\n");
        run("npx", &["patchright", "install", "chromium"])
            .map_err(|e| format!("{report}Browser install failed:\n{e}"))?;
        report.push_str("Automation browser ready ✓\n");

        // LaTeX/xelatex (CV PDF export only) is a separate, larger install — the
        // frontend offers it behind its own button (see `install_latex`).
        report.push_str("\nAll set. (CV PDF export needs LaTeX — install it separately.)");
        Ok(report)
    })
    .await
    .map_err(|e| format!("install task panicked: {e}"))?
}

/// Install ONLY the LaTeX pieces our CV template (`curriculo.cls`) compiles with
/// — NOT the multi-GB full distro. The template uses xelatex + fontspec,
/// unicode-math, tcolorbox, fontawesome6, enumitem, fancyhdr, hyperref, xcolor,
/// … (fonts are bundled locally). On Windows, MiKTeX auto-fetches exactly the
/// used packages on first compile, so it's minimal by design. Separate from
/// `install_dependencies` because it's larger and only needed for PDF export.
#[tauri::command]
pub async fn install_latex() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        if probe("xelatex", "--version") {
            return Ok("xelatex is already installed ✓".to_string());
        }
        let mut report = String::from("Installing the LaTeX set the CV template needs…\n");
        match std::env::consts::OS {
            "windows" => {
                if !probe("winget", "--version") {
                    return Err("winget not available — install MiKTeX from \
                        https://miktex.org (it fetches only the packages used), then retry"
                        .into());
                }
                run(
                    "winget",
                    &[
                        "install",
                        "-e",
                        "--id",
                        "MiKTeX.MiKTeX",
                        "--silent",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                    ],
                )
                .map_err(|e| format!("{report}MiKTeX install failed:\n{e}"))?;
                // Let MiKTeX pull missing packages unattended on first compile.
                let _ = run("initexmf", &["--set-config-value", "[MPM]AutoInstall=1"]);
                report.push_str("MiKTeX installed — auto-fetches only the template's packages ✓\n");
            }
            "linux" => {
                let mgr = linux_pkg_mgr().ok_or_else(|| {
                    "no supported package manager — install `texlive-xetex` (+ latex-extra, \
                     fontawesome) manually"
                        .to_string()
                })?;
                if !probe("pkexec", "--version") {
                    return Err(format!(
                        "graphical sudo (pkexec) not available — run the texlive install for \
                         {mgr} in a terminal, then retry"
                    ));
                }
                // Only the collections curriculo.cls pulls in — NOT texlive-full.
                let pkgs: Vec<&str> = match mgr {
                    "pacman" => vec![
                        "pacman",
                        "-S",
                        "--noconfirm",
                        "texlive-xetex",
                        "texlive-latexextra",
                        "texlive-latexrecommended",
                        "texlive-fontsextra",
                        "texlive-fontsrecommended",
                        "texlive-mathscience",
                    ],
                    "dnf" => vec![
                        "dnf",
                        "install",
                        "-y",
                        "texlive-xetex",
                        "texlive-collection-latexextra",
                        "texlive-collection-fontsrecommended",
                        "texlive-collection-fontsextra",
                    ],
                    _ => vec![
                        "apt-get",
                        "install",
                        "-y",
                        "texlive-xetex",
                        "texlive-latex-extra",
                        "texlive-latex-recommended",
                        "texlive-fonts-recommended",
                        "texlive-fonts-extra",
                    ],
                };
                run("pkexec", &pkgs).map_err(|e| format!("{report}LaTeX install failed:\n{e}"))?;
                report.push_str("LaTeX (xelatex + CV-template packages) installed ✓\n");
            }
            other => return Err(format!("LaTeX auto-install not supported on {other}")),
        }
        if !probe("xelatex", "--version") {
            return Err(format!(
                "{report}xelatex isn't on PATH yet — reopen the app, then try CV PDF export."
            ));
        }
        Ok(format!("{report}xelatex ready ✓"))
    })
    .await
    .map_err(|e| format!("install task panicked: {e}"))?
}
