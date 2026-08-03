/**
 * GlobalLivePreview — one shared Evidence-Viewer pane, mounted once at the app shell. A fixed FAB
 * toggles a floating panel that screencasts the driver's CURRENT automation session (handle=null →
 * `current_session`), so every automation is watchable from any page — not just LinkedIn apply.
 * BrowserPreview degrades to "no active automation session" when nothing is running.
 */
import PreviewViewer from "./PreviewViewer";
import { useLivePreviewStore } from "../stores/useLivePreviewStore";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function GlobalLivePreview() {
  const open = useLivePreviewStore((s) => s.open);
  const toggle = useLivePreviewStore((s) => s.toggle);

  // The screencast only exists in the desktop app; don't offer the pane in the plain-browser build.
  if (!inTauri) return null;

  return (
    <>
      {open && (
        <div className="glp-panel" role="dialog" aria-label="Live automation preview">
          <div className="glp-panel__head">
            <span className="glp-panel__dot" />
            <span className="glp-panel__title">Live Automation</span>
            <button
              type="button"
              className="glp-panel__close"
              onClick={() => toggle()}
              aria-label="Hide live preview"
            >
              ×
            </button>
          </div>
          {/* automationActive is always true while the pane is open — it attaches to whatever session
              is current; if none is running the inner canvas shows its idle/"no session" state. */}
          <PreviewViewer automationActive className="glp-panel__viewer" />
        </div>
      )}

      <button
        type="button"
        className={"glp-fab" + (open ? " glp-fab--active" : "")}
        onClick={() => toggle()}
        aria-pressed={open}
        title={open ? "Hide live automation preview" : "Watch the running automation"}
      >
        <span className="glp-fab__dot" />
        {open ? "Hide Live" : "Live"}
      </button>
    </>
  );
}

export default GlobalLivePreview;
