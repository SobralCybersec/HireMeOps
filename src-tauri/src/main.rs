// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux/Wayland + NVIDIA: WebKitGTK's DMABUF renderer asks the NVIDIA GBM
    // backend for buffer formats it doesn't provide, so GDK dies with
    // "Error 71 (Protocol error) dispatching to Wayland display" right after
    // the window is created. Forcing WebKit onto shared-memory buffers avoids
    // it. Only set when the user hasn't overridden it, so power users can opt
    // back into the fast path or pick their own workaround.
    // See: https://v2.tauri.app/develop/debug/linux-graphics/
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    hiremeops_lib::run()
}
