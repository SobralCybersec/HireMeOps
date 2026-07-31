import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { TopNav } from "./TopNav";
import { OnboardingOverlay } from "./OnboardingOverlay";

export function AppLayout() {
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  return (
    <div className="app-shell app-shell--full">
      <OnboardingOverlay />
      {/* Skip link - first focusable element; jumps past the nav */}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <TopNav />

      <div className="app-main">
        {!isDesktopRuntime && (
          <div className="banner banner--warning" role="alert">
            Browser preview has no Rust backend. Run <code>pnpm tauri dev</code> for working actions.
          </div>
        )}
        <main className="page-outlet" id="main-content" tabIndex={-1} aria-label="Page content">
          <Suspense
            fallback={
              <div className="page-loading" role="status" aria-live="polite">
                Loading…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
