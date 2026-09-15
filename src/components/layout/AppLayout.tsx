import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { TopNav } from "./TopNav";
import { OnboardingOverlay } from "./OnboardingOverlay";
import { AssistantChatModal } from "./AssistantChatModal";
import { useUiStore } from "../stores/useUiStore";

export function AppLayout() {
  const isDesktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const assistantOpen = useUiStore((s) => s.assistantOpen);
  const setAssistantOpen = useUiStore((s) => s.setAssistantOpen);

  return (
    <div className="app-shell">
      <OnboardingOverlay />
      {/* Skip link - first focusable element; jumps past the nav */}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <TopNav />
      <AssistantChatModal open={assistantOpen} onOpenChange={setAssistantOpen} />

      <div className="app-main">
        {!isDesktopRuntime && (
          <div className="banner banner--warning" role="alert">
            Browser preview has no Rust backend. Run <code>pnpm tauri dev</code> for working
            actions.
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
