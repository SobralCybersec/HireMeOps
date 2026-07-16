import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useProfileStore } from "./stores/useProfileStore";
import { startEventBridge, stopEventBridge } from "./lib/eventBridge";
import { seedDevState } from "./lib/devMocks";
import "./App.css";

function App() {
  useEffect(() => {
    void useSettingsStore.getState().loadSettings();
    void useProfileStore.getState().loadProfiles();
    void startEventBridge();
    // Dev-only, off-Tauri: seed events + automation state for screenshots.
    seedDevState();
    // Tear the channel subscription down on unmount so StrictMode's
    // mount→unmount→remount (and HMR) can't leak a stale live listener.
    return () => {
      stopEventBridge();
    };
  }, []);

  return <RouterProvider router={router} />;
}

export default App;
