//! Binary entry point: sets the Windows subsystem, works around a Linux/NVIDIA
//! WebKitGTK DMABUF crash, then hands off to `hiremeops_lib::run()`.
//! Key: `main()` — the only function; process entry.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    hiremeops_lib::run()
}
