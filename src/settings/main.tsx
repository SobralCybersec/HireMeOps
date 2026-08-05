import "./globals.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import ReactDOM from "react-dom/client";
import { IS_TAURI, USE_CUSTOM_WINDOW_CONTROLS } from "./platform";
import { SettingsApp } from "./SettingsApp";

// Mark window as borderless so globals.css paints the transparent chrome.
if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

ReactDOM.createRoot(
  document.getElementById("settings-root") as HTMLElement,
).render(<SettingsApp />);

// The Rust window builder creates the window hidden (visible: false) to avoid
// a flash before React has painted. We must call show() after mount.
// Two calls: 50 ms covers fast machines, 500 ms covers slow ones.
function showWindow() {
  if (!IS_TAURI) return;
  getCurrentWindow()
    .show()
    .catch((e: unknown) => console.error("settings show failed:", e));
}
setTimeout(showWindow, 50);
setTimeout(showWindow, 500);
