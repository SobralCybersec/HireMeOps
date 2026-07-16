import { Suspense, useRef } from "react";
import { Outlet } from "react-router-dom";
import { MissionHeader } from "./MissionHeader";
import { EventLogDrawer } from "./EventLogDrawer";
import { useUiStore } from "../stores/useUiStore";
import { useDragScroll } from "../lib/useDragScroll";

export function AppLayout() {
  const eventLogVisible = useUiStore((s) => s.eventLogVisible);
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // Phone-like click-and-drag panning across every scrollable pane in the
  // workspace. Mounted once here against `.app-main`; see useDragScroll.
  const mainRef = useRef<HTMLDivElement>(null);
  useDragScroll(mainRef);

  return (
    <div className="app-shell">
      {/* Skip link - first focusable element; jumps past the image-led masthead */}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {/* Image-led mission masthead: navigation, profile state, motion/theme controls, and E-STOP. */}
      <MissionHeader />

      {!isDesktopRuntime && (
        <div className="banner banner--warning" role="alert">
          Browser preview has no Rust backend. Run <code>pnpm tauri dev</code> for working actions.
        </div>
      )}

      {/* Main workspace - pages keep their own task-local headers. */}
      <div className="app-main" ref={mainRef}>
        <div className={eventLogVisible ? "app-body" : "app-body app-body--no-drawer"}>
          <main className="page-outlet" id="main-content" tabIndex={-1} aria-label="Page content">
            <Suspense
              fallback={
                <div className="page-loading" role="status" aria-live="polite">
                  Loading...
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
          {eventLogVisible && <EventLogDrawer />}
        </div>
      </div>
    </div>
  );
}
